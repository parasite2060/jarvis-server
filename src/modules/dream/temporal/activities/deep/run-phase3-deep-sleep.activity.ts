import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { buildPhase3Agent } from '../../../agents/deep-phase3.agent';
import { type VaultToolDeps } from '../../../agents/vault-tools';
import { ConsolidationOutputSchema, type ConsolidationOutput } from '../../../agents/consolidation-output.schema';
import type { ConsolidationResult, Phase3Input } from '../../workflows/deep-dream.workflow';
import { buildPhase3RunPrompt, countVaultUpdateEntries, safeReadVault } from './helpers';

@Injectable()
export class RunPhase3DeepSleepActivity {
  private readonly logger = new Logger(RunPhase3DeepSleepActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('deep.phase3_deep_sleep')
  async runPhase3DeepSleep(inp: Phase3Input): Promise<ConsolidationResult> {
    const startedAt = new Date();
    const vaultGuide = (await safeReadVault(this.config.vaultPath, '_guide.md')) ?? '';
    const toolDeps: VaultToolDeps = { vaultPath: this.config.vaultPath, memuApi: this.memuApi };
    const agent = buildPhase3Agent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('deep-dream-phase3-consolidate'),
      toolDeps,
      memuMemories: inp.memu_memories,
      vaultRoot: this.config.vaultPath,
      usageLimits: { totalTokens: this.config.deepPhase3Limits.maxTokens, toolCalls: this.config.deepPhase3Limits.maxIterations },
    });

    const runPrompt = buildPhase3RunPrompt(inp, vaultGuide);
    let output: ConsolidationOutput;
    try {
      const raw = await agent.invoke(runPrompt);
      output = ConsolidationOutputSchema.parse(raw);
    } catch (err) {
      const isZodErr = (err as Error).message.includes('Output invalid') || (err as Error).name === 'ZodError';
      const code = isZodErr ? ErrorCode.DEEP_DREAM_PHASE3_OUTPUT_INVALID : ErrorCode.DEEP_DREAM_PHASE3_AGENT_FAILED;
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'phase3_deep_sleep',
        status: 'failed',
        startedAt,
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      });
      throw new InternalException(code, `Phase 3 failed: ${(err as Error).message}`);
    }

    const consolidationJson = output as unknown as Record<string, unknown>;

    await this.dreamPhaseRepo.recordPhase({
      dreamId: inp.dream_id,
      phase: 'phase3_deep_sleep',
      status: 'completed',
      runPrompt,
      outputJson: consolidationJson,
      startedAt,
      completedAt: new Date(),
    });

    this.logger.log({
      message: 'deep dream phase3 completed',
      event: 'deepDream.phase3.completed',
      dreamId: inp.dream_id,
      memoryMdLines: output.memory_md.split('\n').length,
      vaultUpdatesCount: countVaultUpdateEntries(output.vault_updates),
      durationMs: Date.now() - startedAt.getTime(),
    });

    return {
      consolidation_json: consolidationJson,
      messages_json: [],
      usage_input_tokens: null,
      usage_output_tokens: null,
      usage_total_tokens: null,
      usage_tool_calls: null,
    };
  }
}
