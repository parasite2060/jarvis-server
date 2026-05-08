import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { buildPhase2Agent } from '../../../agents/deep-phase2.agent';
import { type VaultToolDeps } from '../../../agents/vault-tools';
import { REMSleepOutputSchema, type REMSleepOutput } from '../../../agents/rem-sleep-output.schema';
import type { Phase2Input, REMSleepResult } from '../../workflows/deep-dream.workflow';
import {
  PHASE2_DAILY_LOG_WINDOW_DAYS,
  PHASE2_VAULT_INDEX_FOLDERS,
  buildPhase2RunPrompt,
  formatPhase1ForPhase2,
  formatVaultIndexes,
  safeReadVault,
} from './helpers';

@Injectable()
export class RunPhase2RemSleepActivity {
  private readonly logger = new Logger(RunPhase2RemSleepActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('deep.phase2_rem_sleep')
  async runPhase2RemSleep(inp: Phase2Input): Promise<REMSleepResult> {
    const startedAt = new Date();
    try {
      const sourceDateIso = inp.source_date_iso;
      const dailyLogs = await this.loadPhase2DailyLogs(sourceDateIso);
      const vaultIndexes = await this.loadPhase2VaultIndexes();

      const phase1Text = formatPhase1ForPhase2(inp.candidates_json, inp.scored_json);
      const vaultIndexText = formatVaultIndexes(vaultIndexes);

      const toolDeps: VaultToolDeps = { vaultPath: this.config.vaultPath, memuApi: this.memuApi };
      const agent = buildPhase2Agent(this.agentFactory, {
        systemPrompt: this.promptCache.getPrompt('deep-dream-phase2-rem-sleep'),
        toolDeps,
        dailyLogs,
        usageLimits: { totalTokens: this.config.deepPhase2Limits.maxTokens, toolCalls: this.config.deepPhase2Limits.maxIterations },
      });
      const runPrompt = buildPhase2RunPrompt(phase1Text, vaultIndexText);
      const rawOutput = await agent.invoke(runPrompt);
      const validated: REMSleepOutput = REMSleepOutputSchema.parse(rawOutput);

      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'phase2_rem_sleep',
        status: 'completed',
        runPrompt: phase1Text.slice(0, 500),
        outputJson: validated as unknown as Record<string, unknown>,
        startedAt,
        completedAt: new Date(),
      });

      this.logger.log({
        message: 'deep dream phase2 completed',
        event: 'deepDream.phase2.completed',
        dreamId: inp.dream_id,
        themesCount: validated.themes.length,
        connectionsCount: validated.new_connections.length,
        gapsCount: validated.gaps.length,
      });

      return { output_json: validated as unknown as Record<string, unknown> };
    } catch (err) {
      this.logger.warn({
        message: 'deep dream phase2 soft-failed',
        event: 'deepDream.phase2.softFailed',
        dreamId: inp.dream_id,
        error: (err as Error).message,
      });
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'phase2_rem_sleep',
        status: 'failed',
        startedAt,
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      });
      return { output_json: null };
    }
  }

  private async loadPhase2DailyLogs(sourceDateIso: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const startDate = new Date(`${sourceDateIso}T00:00:00Z`);
    if (Number.isNaN(startDate.getTime())) return out;
    for (let i = 0; i < PHASE2_DAILY_LOG_WINDOW_DAYS; i++) {
      const d = new Date(startDate.getTime() - i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const content = await safeReadVault(this.config.vaultPath, `dailys/${iso}.md`);
      if (content !== null && content.length > 0) {
        out[iso] = content;
      }
    }
    return out;
  }

  private async loadPhase2VaultIndexes(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const folder of PHASE2_VAULT_INDEX_FOLDERS) {
      const content = await safeReadVault(this.config.vaultPath, `${folder}/_index.md`);
      if (content !== null && content.length > 0) {
        out[folder] = content;
      }
    }
    return out;
  }
}
