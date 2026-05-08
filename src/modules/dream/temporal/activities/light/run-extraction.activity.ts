import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { buildLightExtractionAgent, type DreamDeps } from '../../../agents/light-extraction.agent';
import { emptySessionLog, type SessionLogEntry } from '../../../agents/extraction-summary.schema';
import { type VaultToolDeps } from '../../../agents/vault-tools';
import type { ExtractionAgentOutput, ExtractionInput } from '../../workflows/light-dream.workflow';
import { SHORT_SESSION_THRESHOLD, buildExtractionRunPrompt, buildExtractionToolFactories, countUserMessages } from './helpers';

@Injectable()
export class RunExtractionActivity {
  private readonly logger = new Logger(RunExtractionActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('light.run_extraction')
  async runExtraction(inp: ExtractionInput): Promise<ExtractionAgentOutput> {
    const startedAt = new Date();
    const userMessageCount = countUserMessages(inp.parsed_text);

    if (userMessageCount < SHORT_SESSION_THRESHOLD) {
      this.logger.log({
        message: 'light dream extraction skipped — short session',
        event: 'lightDream.extraction.skipped.shortSession',
        userMessages: userMessageCount,
        dreamId: inp.dream_id,
      });
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'extraction',
        status: 'completed',
        outputJson: { no_extract: true } as Record<string, unknown>,
        inputTokens: 0,
        toolCalls: 0,
        startedAt,
        completedAt: new Date(),
      });
      return { summary: 'Session too short', no_extract: true, session_log_json: emptySessionLog() };
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const deps: DreamDeps = {
      session_id: inp.session_id,
      session_context: '',
      session_decisions: [],
      session_lessons: [],
      session_failed_lessons: [],
      session_action_items: [],
      session_key_exchanges: [],
      session_concepts: [],
      session_connections: [],
      memories: [],
      today_iso: todayIso,
    };

    const toolDeps: VaultToolDeps = { vaultPath: this.config.vaultPath, memuApi: this.memuApi };
    const baseToolFactories = buildExtractionToolFactories(toolDeps);

    const agent = buildLightExtractionAgent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('light-extraction'),
      deps,
      baseToolFactories,
      usageLimits: {
        totalTokens: this.config.lightExtractionLimits.maxTokens,
        toolCalls: this.config.lightExtractionLimits.maxIterations,
      },
    });

    const runPrompt = buildExtractionRunPrompt(inp, userMessageCount);

    let agentOutput: { summary: string; no_extract: boolean; session_log: SessionLogEntry };
    try {
      agentOutput = await agent.invoke(runPrompt);
    } catch (err) {
      this.logger.error({
        message: 'light dream extraction failed',
        event: 'lightDream.extraction.failed',
        dreamId: inp.dream_id,
        error: (err as Error).message,
      });
      await this.dreamPhaseRepo.recordPhase({
        dreamId: inp.dream_id,
        phase: 'extraction',
        status: 'failed',
        startedAt,
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      });
      throw new InternalException(ErrorCode.LIGHT_DREAM_EXTRACTION_AGENT_FAILED, `Extraction agent failed: ${(err as Error).message}`);
    }

    const finalSessionLog: SessionLogEntry = {
      context: deps.session_context,
      key_exchanges: deps.session_key_exchanges,
      decisions_made: deps.session_decisions,
      lessons_learned: deps.session_lessons,
      failed_lessons: deps.session_failed_lessons,
      action_items: deps.session_action_items,
      concepts: deps.session_concepts,
      connections: deps.session_connections,
      memories: deps.memories,
    };

    await this.dreamPhaseRepo.recordPhase({
      dreamId: inp.dream_id,
      phase: 'extraction',
      status: 'completed',
      outputJson: finalSessionLog as unknown as Record<string, unknown>,
      startedAt,
      completedAt: new Date(),
    });

    this.logger.log({
      message: 'light dream extraction completed',
      event: 'lightDream.extraction.completed',
      dreamId: inp.dream_id,
      durationMs: Date.now() - startedAt.getTime(),
    });

    return {
      summary: agentOutput.summary,
      no_extract: agentOutput.no_extract,
      session_log_json: finalSessionLog,
    };
  }
}
