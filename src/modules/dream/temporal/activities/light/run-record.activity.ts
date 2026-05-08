import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { buildLightRecordAgent, type RecordDeps } from '../../../agents/light-record.agent';
import { type VaultToolDeps } from '../../../agents/vault-tools';
import type { RecordAgentOutput, RecordInput } from '../../workflows/light-dream.workflow';
import { buildRecordRunPrompt, buildRecordToolFactories } from './helpers';

@Injectable()
export class RunRecordActivity {
  private readonly logger = new Logger(RunRecordActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('light.run_record')
  async runRecord(inp: RecordInput): Promise<RecordAgentOutput> {
    const startedAt = new Date();
    const todayIso = new Date().toISOString().slice(0, 10);
    const recordDeps: RecordDeps = {
      session_id: inp.session_id,
      recordOutput: { session_log_writes: [] },
      today_iso: todayIso,
    };

    const toolDeps: VaultToolDeps = { vaultPath: this.config.vaultPath, memuApi: this.memuApi };
    const baseToolFactories = buildRecordToolFactories(toolDeps);
    const agent = buildLightRecordAgent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('light-record'),
      deps: recordDeps,
      baseToolFactories,
      usageLimits: {
        totalTokens: this.config.lightRecordLimits.maxTokens,
        toolCalls: this.config.lightRecordLimits.maxIterations,
      },
    });

    const runPrompt = buildRecordRunPrompt(inp);

    let agentOutput: { files: Array<{ path: string; action: string }>; summary: string };
    try {
      agentOutput = await agent.invoke(runPrompt);
    } catch (err) {
      this.logger.warn({
        message: 'light dream record failed (will be soft-fail-handled by workflow)',
        event: 'lightDream.record.failed',
        dreamId: inp.dream_id,
        error: (err as Error).message,
      });
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'record',
        status: 'failed',
        startedAt,
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      });
      throw new InternalException(ErrorCode.LIGHT_DREAM_RECORD_AGENT_FAILED, `Record agent failed: ${(err as Error).message}`);
    }

    const files = recordDeps.recordOutput.session_log_writes.map((triple) => ({
      path: triple.path,
      action: triple.action as 'create' | 'append' | 'update' | 'skip',
    }));
    const filesModified = recordDeps.recordOutput.session_log_writes.map((t) => t.path);

    await this.dreamPhaseRepo.recordPhase({
      dreamId: inp.dream_id,
      phase: 'record',
      status: 'completed',
      outputJson: { files, summary: agentOutput.summary } as Record<string, unknown>,
      startedAt,
      completedAt: new Date(),
    });

    this.logger.log({
      message: 'light dream record completed',
      event: 'lightDream.record.completed',
      dreamId: inp.dream_id,
      filesModified: filesModified.length,
      durationMs: Date.now() - startedAt.getTime(),
    });

    return {
      session_log_writes: recordDeps.recordOutput.session_log_writes,
      files_modified: filesModified,
      files,
      summary: agentOutput.summary,
    };
  }
}
