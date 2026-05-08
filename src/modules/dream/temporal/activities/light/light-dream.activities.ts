/**
 * LightDreamActivities — grouped Temporal activity service (Story 13.10).
 *
 * Per Story 13.0 sign-off A.2: ALL light-dream activities are methods on a
 * SINGLE `@Injectable()` service, NOT 7 (or 8) separate classes. This file
 * is the single landing zone for the 8 wire-name-frozen activities the
 * `LightDream` workflow proxies.
 *
 * # Module-boundary discipline (architecture.md §1.4 principle 8)
 *   The service injects ONLY:
 *     - Shared services (GitOpsService, DeepAgentFactory, PromptCacheService) — direct
 *     - Symbol-token-based domain repositories (CONVERSATION_REPOSITORY etc.) — direct
 *     - `CommandBus` (NestJS CQRS, global) — for cross-module command dispatch
 *     - `AppConfigService`, `Logger` — global
 *   It does NOT inject any class from `src/modules/{conversation, memory, context, vault, config}/...`.
 *   Cross-module work (`InvalidateContextCacheCommand`) goes through `CommandBus.execute(...)`.
 *
 * # Q12 deviation (RESOLVED 2026-05-08): triple-collection
 *   The record agent's `writeFile` / `updateReinforcement` / `flagContradiction`
 *   tools collect `(path, content, action)` triples into
 *   `recordDeps.recordOutput.session_log_writes`. The `commitAndPr` activity
 *   writes them on the new branch via `gitOps.writeFiles(...)`. This deviates
 *   from Python (which writes during agent execution and then has Python's
 *   `git checkout -B` reset the working tree — a fragility bug). Observable
 *   behaviour identical; internal mechanism cleaner.
 *
 * # Q4 deviation (RESOLVED 2026-05-08): single transaction
 *   `loadTranscript` collapses Python's three DB sessions (read transcript /
 *   insert dream / link transcript) into one TypeORM transaction via
 *   `dataSource.transaction(...)`. Atomic; orphan-free on retry.
 *
 * # Q13 deviation (RESOLVED 2026-05-08): markDreamOutcome
 *   8th activity introduced as a TS-only enhancement. Python's workflow does
 *   NOT update `dream.outcome` post-activities (verified by team-lead via
 *   grep), leaving outcome at whatever load_transcript set ('processing') —
 *   a Python bug. The TS port fixes it.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApplicationFailure } from '@temporalio/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { TranscriptSchema } from 'src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from 'src/shared/postgres/schema/dream.schema';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

// Cross-module command imports — explicit cross-module CONTRACTS per
// application-design.md §1.4 pattern 2. These are the ONLY allowed
// cross-module imports for this service.
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';

import { buildLightExtractionAgent, type DreamDeps, type ExtractionToolFactories } from '../../../agents/light-extraction.agent';
import { buildLightRecordAgent, type RecordDeps, type RecordToolFactories } from '../../../agents/light-record.agent';
import { emptySessionLog, type SessionLogEntry } from '../../../agents/schemas/extraction-summary.schema';
import {
  fileInfoTool,
  grepTool,
  listFilesTool,
  memuCategoriesTool,
  memuSearchTool,
  readFileTool,
  readFrontmatterTool,
  type VaultToolDeps,
} from '../../../agents/tools/vault-tools';
import type {
  CommitAndPRInput,
  CommitAndPRResult,
  ExtractionAgentOutput,
  ExtractionInput,
  InvalidateCacheInput,
  LoadTranscriptInput,
  LoadTranscriptResult,
  MarkDreamOutcomeInput,
  PersistSessionLogInput,
  RecordAgentOutput,
  RecordInput,
  UpdatePositionInput,
} from '../../types/light-dream.types';

/**
 * Mirrors Python `_count_user_messages` (`dream_agent.py:487-514`). Counts
 * lines matching `^\s*(\[[^\]]+\]\s*)?User:` — optional ISO timestamp prefix.
 */
function countUserMessages(parsedText: string): number {
  const matches = parsedText.match(/^\s*(\[[^\]]+\]\s*)?User:/gm);
  return matches?.length ?? 0;
}

const SHORT_SESSION_THRESHOLD = 3;

@Injectable()
export class LightDreamActivities {
  private readonly logger = new Logger(LightDreamActivities.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly gitOps: GitOpsService,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversationRepo: IConversationRepository,
    @Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    @InjectDataSource(DBConnections.INTERNAL) private readonly dataSource: DataSource,
    private readonly commandBus: CommandBus,
    private readonly config: AppConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Activity 1: loadTranscript (wire `light.load_transcript`)
  //
  // Q4 deviation: single TypeORM transaction collapsing Python's three sessions.
  // Q4.b defensive dedup: findRecentDreamForTranscript(60s) before insert.
  // ---------------------------------------------------------------------------
  @TemporalActivity('light.load_transcript')
  async loadTranscript(inp: LoadTranscriptInput): Promise<LoadTranscriptResult> {
    return this.dataSource.transaction(async (manager) => {
      const transcriptRepo = manager.getRepository(TranscriptSchema);
      const dreamRepo = manager.getRepository(DreamSchema);
      const transcript = await transcriptRepo.findOne({ where: { id: inp.transcript_id } });
      if (transcript === null) {
        throw new InternalException(ErrorCode.LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND, `Transcript ${inp.transcript_id} not found`);
      }

      // Q4.b dedup: if a light dream was created within the last 60s for this
      // transcript, return the existing dream id (Temporal retry idempotency).
      const sixtySecondsAgo = new Date(Date.now() - 60_000);
      const existing = await dreamRepo
        .createQueryBuilder('d')
        .where('d.transcript_id = :tid', { tid: inp.transcript_id })
        .andWhere('d.type = :type', { type: 'light' })
        .andWhere('d.created_at >= :cutoff', { cutoff: sixtySecondsAgo })
        .orderBy('d.created_at', 'DESC')
        .limit(1)
        .getOne();

      let dreamId: number;
      if (existing !== null) {
        dreamId = existing.id;
      } else {
        const dream = dreamRepo.create({
          type: 'light',
          trigger: 'auto',
          status: 'processing',
          transcriptId: inp.transcript_id,
          startedAt: new Date(),
        } satisfies Partial<Dream>);
        const saved = await dreamRepo.save(dream);
        dreamId = saved.id;
        // Link transcript.light_dream_id (mirrors Python session #3).
        await transcriptRepo.update({ id: inp.transcript_id }, { lightDreamId: dreamId } satisfies Partial<Conversation>);
      }

      this.logger.log({
        message: 'light dream load_transcript completed',
        event: 'lightDream.loadTranscript.completed',
        dreamId,
        transcriptId: inp.transcript_id,
        sessionId: inp.session_id,
      });

      return {
        dream_id: dreamId,
        parsed_text: transcript.parsedText ?? transcript.rawContent ?? '',
        project: transcript.project ?? null,
        token_count: transcript.tokenCount ?? null,
        created_at_iso: transcript.createdAt?.toISOString() ?? null,
        segment_end_line: transcript.segmentEndLine ?? 0,
        is_continuation: transcript.isContinuation ?? false,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Activity 2: runExtraction (wire `light.run_extraction`)
  //
  // Short-session skip per AC #11: userMessageCount < 3 → no_extract: true.
  // Post-run assembly per AC #9: deps → finalSessionLog overwrites agent output.
  // Telemetry: dream_phases row written on success AND failure.
  // ---------------------------------------------------------------------------
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

    const baseToolFactories = this.buildExtractionToolFactories();

    const agent = buildLightExtractionAgent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('light-extraction'),
      deps,
      baseToolFactories,
      usageLimits: {
        totalTokens: this.config.lightExtractionLimits.maxTokens,
        toolCalls: this.config.lightExtractionLimits.maxIterations,
      },
    });

    const runPrompt = this.buildExtractionRunPrompt(inp, userMessageCount);

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

    // Post-run assembly (AC #9 / Python lines 591-602): overwrite agent's
    // session_log with deterministic deps-driven assembly. The LLM's own
    // session_log field is DISCARDED.
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

  // ---------------------------------------------------------------------------
  // Activity 3: runRecord (wire `light.run_record`)
  //
  // Q12 = (c): record agent's writeFile collects triples; commitAndPr writes them.
  // Soft-fail (workflow level, not here): if this throws after retries, the
  // workflow's try/catch marks dream.outcome = 'partial'.
  // ---------------------------------------------------------------------------
  @TemporalActivity('light.run_record')
  async runRecord(inp: RecordInput): Promise<RecordAgentOutput> {
    const startedAt = new Date();
    const todayIso = new Date().toISOString().slice(0, 10);
    const recordDeps: RecordDeps = {
      session_id: inp.session_id,
      recordOutput: { session_log_writes: [] },
      today_iso: todayIso,
    };

    const baseToolFactories = this.buildRecordToolFactories();
    const agent = buildLightRecordAgent(this.agentFactory, {
      systemPrompt: this.promptCache.getPrompt('light-record'),
      deps: recordDeps,
      baseToolFactories,
      usageLimits: {
        totalTokens: this.config.lightRecordLimits.maxTokens,
        toolCalls: this.config.lightRecordLimits.maxIterations,
      },
    });

    const runPrompt = this.buildRecordRunPrompt(inp);

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

    // Post-run files = the triples we collected (authoritative provenance for commitAndPr).
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

  // ---------------------------------------------------------------------------
  // Activity 4: persistSessionLog (wire `light.persist_session_log`)
  // ---------------------------------------------------------------------------
  @TemporalActivity('light.persist_session_log')
  async persistSessionLog(inp: PersistSessionLogInput): Promise<void> {
    try {
      await this.dreamRepo.persistSessionLog(inp.dream_id, inp.session_log_json as unknown as Record<string, unknown>);
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_PERSIST_SESSION_LOG_FAILED, `persistSessionLog failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 5: updateTranscriptPosition (wire `light.update_transcript_position`)
  // ---------------------------------------------------------------------------
  @TemporalActivity('light.update_transcript_position')
  async updateTranscriptPosition(inp: UpdatePositionInput): Promise<void> {
    try {
      await this.conversationRepo.updatePosition(inp.transcript_id, 'processed', inp.segment_end_line);
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_UPDATE_POSITION_FAILED, `updatePosition failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 6: invalidateContextCache (wire `light.invalidate_cache`)
  //
  // Q5 = A (RESOLVED): hard-fail with retry per Python max_attempts=5.
  // ---------------------------------------------------------------------------
  @TemporalActivity('light.invalidate_cache')
  async invalidateContextCache(inp: InvalidateCacheInput): Promise<void> {
    try {
      await this.commandBus.execute(new InvalidateContextCacheCommand({ reason: 'light-dream-completed', timestamp: new Date() }));
      this.logger.log({
        message: 'light dream invalidate context cache dispatched',
        event: 'lightDream.invalidateContextCache.dispatched',
        dreamId: inp.dream_id,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_INVALIDATE_CACHE_FAILED, `invalidateContextCache failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 7: commitAndPr (wire `light.commit_and_pr`)
  //
  // Q7 RESOLVED: branch = `dream/light-${session_id}` (matches Python).
  // Q12 = (c): writes (path, content, action) triples on the new branch.
  // ---------------------------------------------------------------------------
  @TemporalActivity('light.commit_and_pr')
  async commitAndPr(inp: CommitAndPRInput): Promise<CommitAndPRResult> {
    if (inp.session_log_writes.length === 0) {
      return { git_branch: '', git_pr_url: null, git_pr_status: 'no_changes' };
    }

    const branch = `dream/light-${inp.session_id}`;
    const commitMsg = `dream(light): extract session ${inp.source_date_iso}`;
    const prBody = this.buildPRBody(inp);

    try {
      await this.gitOps.pullLatestMain();
      await this.gitOps.createBranch(branch);
      // Q12 = (c) — write (path, content) pairs ON the new branch (working tree
      // empty after createBranch reset; no race).
      const fileChanges = inp.session_log_writes.map((t) => ({ path: t.path, content: t.content }));
      await this.gitOps.writeFiles(fileChanges);
      await this.gitOps.commit(
        commitMsg,
        fileChanges.map((f) => f.path),
      );
      await this.gitOps.push(branch);
      const result = await this.gitOps.createPullRequest({
        branch,
        title: commitMsg,
        body: prBody,
        autoMerge: false, // dream-config auto-merge wired in 13.13/13.14
      });

      this.logger.log({
        message: 'light dream commit_and_pr completed',
        event: 'lightDream.commitAndPr.completed',
        dreamId: inp.dream_id,
        prUrl: result.url,
        status: 'created',
      });

      return { git_branch: branch, git_pr_url: result.url, git_pr_status: 'created' };
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_COMMIT_AND_PR_FAILED, `commitAndPr failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 8: markDreamOutcome (wire `light.mark_dream_outcome`)
  //
  // Q13 RESOLVED: TS-only enhancement. Python's workflow does not update
  // dream.outcome — a Python bug we deliberately fix here.
  // ---------------------------------------------------------------------------
  @TemporalActivity('light.mark_dream_outcome')
  async markDreamOutcome(inp: MarkDreamOutcomeInput): Promise<void> {
    await this.dreamRepo.updateDreamOutcome(inp.dream_id, inp.outcome, 'completed');
    this.logger.log({
      message: 'light dream outcome marked',
      event: 'lightDream.markDreamOutcome.completed',
      dreamId: inp.dream_id,
      outcome: inp.outcome,
    });
  }

  // ---------------------------------------------------------------------------
  // Helper: extraction tool factories — full implementations per Adjustment 1
  // (RESOLVED 2026-05-08). Each factory delegates to the shared `vault-tools`
  // module which enforces vault-relative path resolution via
  // `safeResolveVaultPath` (Story 13.6/13.7 shared util) and caps grep at
  // 100 matches per Python. The factory captures the deps closure once so
  // tool calls are zero-allocation past construction.
  // ---------------------------------------------------------------------------
  private buildExtractionToolFactories(): ExtractionToolFactories {
    const deps: VaultToolDeps = {
      vaultPath: this.config.vaultPath,
      memuApi: this.memuApi,
    };
    return {
      readFile: (input) => readFileTool(deps, input),
      grep: (input) => grepTool(deps, input),
      listFiles: (input) => listFilesTool(deps, input),
      fileInfo: (input) => fileInfoTool(deps, input),
      readFrontmatter: (input) => readFrontmatterTool(deps, input),
      memuSearch: (input) => memuSearchTool(deps, input),
      memuCategories: () => memuCategoriesTool(),
    };
  }

  private buildRecordToolFactories(): RecordToolFactories {
    // Record agent reuses the same vault-read tool factories as extraction.
    return this.buildExtractionToolFactories();
  }

  private buildExtractionRunPrompt(inp: ExtractionInput, userMessageCount: number): string {
    return [
      'Extract session insights from the transcript.',
      'Use store* tools for structured session log.',
      'Use storeSessionMemory() only for general patterns, preferences, facts, corrections.',
      '',
      '## Session Metadata',
      `Session ID: ${inp.session_id}`,
      `Project: ${inp.project ?? 'unknown'}`,
      `Token count: ${inp.token_count ?? 'unknown'}`,
      `Transcript lines: ${userMessageCount} user messages`,
      `Transcript file: ${inp.transcript_file ?? '(injected directly)'}`,
      '',
      '## Current MEMORY.md (what the vault already knows)',
      '(empty)',
      '',
      'Skip extracting insights that are already in Strong Patterns above.',
      'Focus on NEW decisions, lessons, and concepts not yet captured.',
    ].join('\n');
  }

  private buildRecordRunPrompt(inp: RecordInput): string {
    const lines: string[] = [
      'Record the session to the daily log and track reinforcement signals.',
      '',
      `Session ID: ${inp.session_id}`,
      `Session start time: ${inp.session_start_iso || 'unknown'}`,
      '',
    ];
    if (inp.is_continuation) {
      lines.push(
        '## CONTINUATION MODE',
        'This is a CONTINUATION of an existing session (user closed and resumed).',
        `Find the session block with \`<!-- session_id: ${inp.session_id} -->\` in the daily log.`,
        'APPEND new information to that existing block — do NOT create a new ### Session heading.',
        `Add a \`**Continued at [HH:MM]**:\` marker before new content in each section.`,
        `Substitute the \`Session start time:\` value above for \`[HH:MM]\` (use \`00:00\` if the value is \`unknown\`).`,
        '',
      );
    }
    lines.push('## Session Log');
    lines.push(this.formatSessionLog(inp.session_log_json, inp.summary));
    lines.push(
      '',
      'Write the session block to dailys/. Use readFrontmatter(path) for reinforcement checks.',
      'Use memuSearch(query) to find matching vault files for reinforcement.',
    );
    return lines.join('\n');
  }

  private formatSessionLog(log: SessionLogEntry, summary: string): string {
    return JSON.stringify({ summary, ...log }, null, 2);
  }

  private buildPRBody(inp: CommitAndPRInput): string {
    const filesList = inp.files_modified.map((p) => `- \`${p}\``).join('\n');
    return [
      '## Dream Light Extract',
      '',
      `**Dream ID:** ${inp.dream_id}`,
      `**Session:** ${inp.session_id}`,
      `**Date:** ${inp.source_date_iso}`,
      '',
      '### Summary',
      inp.extraction_summary.slice(0, 200),
      '',
      '### Changed Files',
      filesList,
      '',
      `**Files modified:** ${inp.files_modified.length}`,
    ].join('\n');
  }

  /** Surface for unit tests to verify ApplicationFailure propagation if needed. */
  /* istanbul ignore next */
  static get ApplicationFailureRef(): typeof ApplicationFailure {
    return ApplicationFailure;
  }
}
