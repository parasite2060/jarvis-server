import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { buildWeeklyReviewAgent } from '../../../agents/weekly-review.agent';
import { type VaultToolDeps } from '../../../agents/vault-tools';
import { WeeklyReviewOutputSchema, type WeeklyReviewOutput } from '../../../agents/weekly-review-output.schema';
import { weekIso as computeWeekIso } from '../../workflows/iso-week';
import type { AgentInput, AgentResult } from '../../workflows/weekly-review.workflow';

@Injectable()
export class RunWeeklyReviewAgentActivity {
  private readonly logger = new Logger(RunWeeklyReviewAgentActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('weekly.run_weekly_review_agent')
  async runWeeklyReviewAgent(inp: AgentInput): Promise<AgentResult> {
    const startedAt = new Date();
    const weekIso = computeWeekIso(inp.week_start);
    const runPrompt = this.buildAgentRunPrompt(inp.vault_guide);

    const toolDeps: VaultToolDeps = { vaultPath: this.config.vaultPath, memuApi: this.memuApi };
    const agent = buildWeeklyReviewAgent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('weekly-review'),
      toolDeps,
      dailyLogs: inp.daily_logs,
      vaultIndexes: inp.vault_indexes,
      usageLimits: {
        totalTokens: this.config.weeklyReviewLimits.maxTokens,
        toolCalls: this.config.weeklyReviewLimits.maxIterations,
      },
    });

    let raw: WeeklyReviewOutput;
    try {
      raw = await agent.invoke(runPrompt);
    } catch (err) {
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'weekly_review',
        status: 'failed',
        runPrompt,
        startedAt,
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      });
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_AGENT_FAILED, `Weekly review agent failed: ${(err as Error).message}`);
    }

    let validated: WeeklyReviewOutput;
    try {
      validated = WeeklyReviewOutputSchema.parse(raw);
    } catch (err) {
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'weekly_review',
        status: 'failed',
        runPrompt,
        startedAt,
        completedAt: new Date(),
        errorMessage: `Output invalid: ${(err as Error).message}`,
      });
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_OUTPUT_INVALID, `Weekly review output schema invalid: ${(err as Error).message}`);
    }

    await this.dreamPhaseRepo.recordPhase({
      dreamId: inp.dream_id,
      phase: 'weekly_review',
      status: 'completed',
      runPrompt,
      outputJson: validated as unknown as Record<string, unknown>,
      startedAt,
      completedAt: new Date(),
    });

    const durationMs = Date.now() - startedAt.getTime();
    this.logger.log({
      message: 'weekly review run_agent completed',
      event: 'weeklyReview.runAgent.completed',
      dreamId: inp.dream_id,
      weekIso,
      themesCount: validated.week_themes.length,
      staleCount: validated.stale_action_items.length,
      durationMs,
    });

    if (validated.review_content === '') {
      this.logger.warn({
        message: 'weekly review agent returned empty review_content',
        event: 'weeklyReview.runAgent.emptyReview',
        dreamId: inp.dream_id,
      });
    }

    return {
      review_content: validated.review_content,
      week_themes: validated.week_themes,
      stale_action_items: validated.stale_action_items,
      project_updates: validated.project_updates,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      tool_calls: null,
    };
  }

  /**
   * Mirrors Python `dream_agent.py:1286-1296` template. If `vault_guide` is
   * empty, the second section is omitted.
   */
  private buildAgentRunPrompt(vaultGuide: string): string {
    const lines: string[] = [
      'Synthesize the past 7 days of daily logs into a weekly review. Read all daily logs and vault indexes before producing output.',
    ];
    if (vaultGuide.length > 0) {
      lines.push('');
      lines.push('## Vault Guide (review format)');
      lines.push(vaultGuide);
    }
    return lines.join('\n');
  }
}
