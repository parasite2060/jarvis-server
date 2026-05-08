import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { buildPhase1Agent } from '../../../agents/deep-phase1.agent';
import { type VaultToolDeps } from '../../../agents/vault-tools';
import { LightSleepOutputSchema, type LightSleepOutput } from '../../../agents/light-sleep-output.schema';
import type { LightSleepResult, Phase1Input } from '../../workflows/deep-dream.workflow';
import { buildPhase1RunPrompt } from './helpers';

@Injectable()
export class RunPhase1LightSleepActivity {
  private readonly logger = new Logger(RunPhase1LightSleepActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('deep.phase1_light_sleep')
  async runPhase1LightSleep(inp: Phase1Input): Promise<LightSleepResult> {
    const startedAt = new Date();
    const toolDeps: VaultToolDeps = { vaultPath: this.config.vaultPath, memuApi: this.memuApi };
    const agent = buildPhase1Agent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('deep-dream-phase1-light-sleep'),
      toolDeps,
      memuMemories: inp.memu_memories,
      usageLimits: { totalTokens: this.config.deepPhase1Limits.maxTokens, toolCalls: this.config.deepPhase1Limits.maxIterations },
    });

    const runPrompt = buildPhase1RunPrompt(inp);
    let output: LightSleepOutput;
    try {
      output = await agent.invoke(runPrompt);
    } catch (err) {
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'phase1_light_sleep',
        status: 'failed',
        startedAt,
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      });
      throw new InternalException(ErrorCode.DEEP_DREAM_PHASE1_AGENT_FAILED, `Phase 1 agent failed: ${(err as Error).message}`);
    }

    let validated: LightSleepOutput;
    try {
      validated = LightSleepOutputSchema.parse(output);
    } catch (err) {
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'phase1_light_sleep',
        status: 'failed',
        startedAt,
        completedAt: new Date(),
        errorMessage: `Output invalid: ${(err as Error).message}`,
      });
      throw new InternalException(ErrorCode.DEEP_DREAM_PHASE1_OUTPUT_INVALID, `Phase 1 output schema invalid: ${(err as Error).message}`);
    }

    await this.dreamPhaseRepo.recordPhase({
      dreamId: inp.dream_id,
      phase: 'phase1_light_sleep',
      status: 'completed',
      runPrompt,
      outputJson: validated as unknown as Record<string, unknown>,
      startedAt,
      completedAt: new Date(),
    });

    this.logger.log({
      message: 'deep dream phase1 completed',
      event: 'deepDream.phase1.completed',
      dreamId: inp.dream_id,
      candidatesCount: validated.candidates.length,
      durationMs: Date.now() - startedAt.getTime(),
    });

    return {
      candidates_json: validated.candidates as unknown as Array<Record<string, unknown>>,
      duplicates_removed: validated.duplicates_removed,
      contradictions_found: validated.contradictions_found,
    };
  }
}
