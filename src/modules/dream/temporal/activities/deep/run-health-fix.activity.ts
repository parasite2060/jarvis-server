import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { buildHealthFixAgent } from '../../../agents/health-fix.agent';
import { type VaultToolDeps } from '../../../agents/vault-tools';
import { type HealthReport } from '../../../agents/health-report.schema';
import { HealthFixOutputSchema } from '../../../agents/health-fix-output.schema';
import type { HealthFixInput, HealthFixResult } from '../../workflows/deep-dream.workflow';
import { HEALTH_FIX_MAX_ITERATIONS, emptyHealthReport, filterLlmScope, formatLlmHealthSummary } from './helpers';
import { autoFixHealthIssues, runHealthChecks } from './_health-helpers';

@Injectable()
export class RunHealthFixActivity {
  private readonly logger = new Logger(RunHealthFixActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('deep.health_fix')
  async runHealthFix(inp: HealthFixInput): Promise<HealthFixResult> {
    const toolDeps: VaultToolDeps = { vaultPath: this.config.vaultPath, memuApi: this.memuApi };
    const agent = buildHealthFixAgent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('deep-dream-health-fix'),
      toolDeps,
      usageLimits: { totalTokens: this.config.healthFixLimits.maxTokens, toolCalls: this.config.healthFixLimits.maxIterations },
    });

    const messageHistory = inp.consolidation_messages_json;
    let healthReport: HealthReport | null = null;
    let iteration = 1;

    while (true) {
      try {
        await autoFixHealthIssues(this.config.vaultPath, healthReport ?? emptyHealthReport());
      } catch (err) {
        this.logger.warn({
          message: 'auto-fix iteration failed',
          event: 'deepDream.healthFix.autoFixFailed',
          iteration,
          error: (err as Error).message,
        });
      }

      try {
        healthReport = await runHealthChecks(this.config.vaultPath, inp.knowledge_gap_names);
      } catch (err) {
        this.logger.warn({
          message: 'health-check failed inside loop',
          event: 'deepDream.healthFix.healthCheckFailed',
          iteration,
          error: (err as Error).message,
        });
        break;
      }

      if (healthReport.total_issues === 0) {
        return { status: 'clean', report_json: healthReport as unknown as Record<string, unknown>, total_issues_remaining: 0 };
      }

      if (messageHistory.length === 0) {
        break;
      }

      if (iteration > HEALTH_FIX_MAX_ITERATIONS) {
        return {
          status: 'incomplete',
          report_json: healthReport as unknown as Record<string, unknown>,
          total_issues_remaining: healthReport.total_issues,
        };
      }

      const llmScoped = filterLlmScope(healthReport);
      if (llmScoped.total_issues === 0) {
        return { status: 'fixed', report_json: healthReport as unknown as Record<string, unknown>, total_issues_remaining: 0 };
      }

      const startedAt = new Date();
      const summary = formatLlmHealthSummary(llmScoped);
      this.logger.log({
        message: 'deep dream health-fix iteration started',
        event: 'deepDream.healthFix.iteration.start',
        dreamId: inp.dream_id,
        iteration,
        llmScopedIssues: llmScoped.total_issues,
      });
      try {
        const fixOutput = await agent.invoke(summary, { messageHistory });
        const validated = HealthFixOutputSchema.parse(fixOutput);
        await this.dreamPhaseRepo.recordPhase({
          dreamId: inp.dream_id,
          phase: 'health_fix',
          status: 'completed',
          runPrompt: summary,
          outputJson: validated as unknown as Record<string, unknown>,
          startedAt,
          completedAt: new Date(),
        });
        this.logger.log({
          message: 'deep dream health-fix iteration completed',
          event: 'deepDream.healthFix.iteration.completed',
          dreamId: inp.dream_id,
          iteration,
          status: 'completed',
        });
      } catch (err) {
        await this.dreamPhaseRepo.recordPhase({
          dreamId: inp.dream_id,
          phase: 'health_fix',
          status: 'failed',
          startedAt,
          completedAt: new Date(),
          errorMessage: (err as Error).message,
        });
        this.logger.warn({
          message: 'deep dream health-fix LLM iteration failed',
          event: 'deepDream.healthFix.iteration.failed',
          dreamId: inp.dream_id,
          iteration,
          error: (err as Error).message,
        });
      }

      iteration += 1;
    }

    const finalReport = healthReport ?? emptyHealthReport();
    this.logger.warn({
      message: 'deep dream health-fix exhausted',
      event: 'deepDream.healthFix.exhausted',
      dreamId: inp.dream_id,
      totalIssuesRemaining: finalReport.total_issues,
    });
    return {
      status: 'incomplete',
      report_json: finalReport as unknown as Record<string, unknown>,
      total_issues_remaining: finalReport.total_issues,
    };
  }
}
