/**
 * DeepDreamActivities — grouped Temporal activity service (Story 13.11).
 *
 * Per Story 13.0 sign-off A.2: ALL deep-dream activities are methods on a
 * SINGLE `@Injectable()` service, NOT 12 separate classes. Mirrors the
 * pattern Story 13.10 established for `LightDreamActivities`.
 *
 * # 12 wire-frozen activity names (MC3 — see Dev Notes §B / AC #4):
 *   1. deep.gather_inputs
 *   2. deep.phase1_light_sleep
 *   3. deep.score_candidates
 *   4. deep.phase2_rem_sleep
 *   5. deep.phase3_deep_sleep
 *   6. deep.health_check
 *   7. deep.health_fix
 *   8. deep.write_files
 *   9. deep.commit_and_pr
 *   10. deep.align_memu
 *   11. deep.invalidate_cache
 *   12. deep.mark_dream_outcome (TS-only enhancement — mirrors 13.10's pattern)
 *
 * # Module-boundary discipline (architecture.md §1.4 principle 8)
 *   The service injects ONLY:
 *     - Shared services (GitOpsService, DeepAgentFactory, PromptCacheService) — direct
 *     - Symbol-token-based domain interfaces (DREAM_REPOSITORY, DREAM_PHASE_REPOSITORY,
 *       FILE_MANIFEST_REPOSITORY, MEMU_API) — direct
 *     - `CommandBus` (NestJS CQRS, global) — for cross-module command dispatch
 *     - `AppConfigService`, `Logger` — global
 *   It does NOT inject any class from `src/modules/{conversation, memory,
 *   context, vault, config}/...`. Cross-module work
 *   (`InvalidateContextCacheCommand`) goes through `CommandBus.execute(...)`.
 *
 * # Q3 deviation (RESOLVED 2026-05-08): triple-collection
 *   `writeFiles` collects `(path, content, action)` triples on the
 *   `WriteFilesResult.vault_writes` field; `commitAndPr` writes them on
 *   the new branch via `gitOps.writeFiles(...)`. Mirrors 13.10 Q12. The
 *   triple-collection is performed AFTER the Q14 explicit `topics`-drop.
 *
 * # Q4 deviation (RESOLVED 2026-05-08): atomic gather_inputs transaction
 *   `gatherInputs` collapses Python's sequential ops into one TypeORM
 *   transaction with a 60s defensive dedup check. Mirrors 13.10 Q4.
 *
 * # Q8 RESOLVED: file-based align_memu idempotency
 *   `alignMemu` writes a one-line entry to `.backups/memu_align_idempotency.log`
 *   keyed by `dream-{dream_id}` (Python `services/deep_dream.py:298+`). MC5
 *   byte-equivalence requires this file path.
 *
 * # Q9 RESOLVED: Health Fix has NO writeFile tool
 *   `runHealthFix` builds the Health Fix agent with read-only base 7 tools
 *   only; the agent emits `HealthFixAction` records describing intent.
 *   Vault mutations stay in the Phase 3 triple-collection flow.
 *
 * # Q10 inherited Python bug (RESOLVED 2026-05-08): topics-drop
 *   `writeFiles` does `delete vault_updates.topics` at the activity boundary
 *   per Q14 — Python's `consolidation_to_dict` silently drops topics, and
 *   MC5 byte-equivalence requires we mirror that. Documented as inherited
 *   Python bug; flagged for retro fix in Story 13.18.
 *
 * # Q13 RESOLVED: IMemuApi.memorize already exists
 *   Story 13.4 Amendment 1 shipped `memorize(messages, opts?)` with the
 *   needed signature. NO interface extension.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { DreamSchema } from 'src/shared/postgres/schema/dream.schema';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';

// Cross-module command imports — explicit cross-module CONTRACTS per
// application-design.md §1.4 pattern 2.
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';

import { buildPhase1Agent } from '../../../agents/deep-phase1.agent';
import { buildPhase2Agent } from '../../../agents/deep-phase2.agent';
import { buildPhase3Agent } from '../../../agents/deep-phase3.agent';
import { buildHealthFixAgent } from '../../../agents/health-fix.agent';
import { type VaultToolDeps } from '../../../agents/tools/vault-tools';
import {
  ConsolidationOutputSchema,
  type ConsolidationOutput,
  type VaultUpdates,
  type VaultWriteTriple,
} from '../../../agents/schemas/consolidation-output.schema';
import { LightSleepOutputSchema, type LightSleepOutput } from '../../../agents/schemas/light-sleep-output.schema';
import { REMSleepOutputSchema, type REMSleepOutput } from '../../../agents/schemas/rem-sleep-output.schema';
import { type HealthReport } from '../../../agents/schemas/health-report.schema';
import { HealthFixOutputSchema } from '../../../agents/schemas/health-fix-output.schema';
import { calculateCandidateScore } from '../../../scoring/calculate-candidate-score';
import { runHealthChecks } from '../../../health/run-health-checks';
import { autoFixHealthIssues } from '../../../health/auto-fix-health-issues';
import type {
  AlignMemuInput,
  CommitAndPRResult,
  ConsolidationResult,
  DeepCommitAndPRInput,
  GatherInputsResult,
  HealthCheckInput,
  HealthFixInput,
  HealthFixResult,
  HealthReportResult,
  InvalidateCacheInput,
  LightSleepResult,
  MarkDeepDreamOutcomeInput,
  Phase1Input,
  Phase2Input,
  Phase3Input,
  REMSleepResult,
  ScoredCandidatesResult,
  ScoringInput,
  WriteFilesInput,
  WriteFilesResult,
  DeepDreamPayload,
} from '../../types/deep-dream.types';

const HEALTH_FIX_MAX_ITERATIONS = 3;
const PHASE2_DAILY_LOG_WINDOW_DAYS = 7;
const PHASE2_VAULT_INDEX_FOLDERS = ['decisions', 'patterns', 'concepts', 'connections', 'lessons', 'projects'] as const;
const IDEMPOTENCY_LOG_PATH = '.backups/memu_align_idempotency.log';
const MEMORY_SECTIONS_FOR_MEMU = ['Strong Patterns', 'Decisions', 'Facts'] as const;
const SEXTY_SECONDS_MS = 60_000;

@Injectable()
export class DeepDreamActivities {
  private readonly logger = new Logger(DeepDreamActivities.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly gitOps: GitOpsService,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    @Inject(FILE_MANIFEST_REPOSITORY) private readonly manifestRepo: IFileManifestRepository,
    @InjectDataSource(DBConnections.INTERNAL) private readonly dataSource: DataSource,
    private readonly commandBus: CommandBus,
    private readonly config: AppConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Activity 1: gatherInputs (wire `deep.gather_inputs`)
  //
  // Q4 deviation: single TypeORM transaction (Dream row insert + dedup check).
  // Filesystem reads (MEMORY.md, dailys/{date}.md, SOUL.md) happen outside
  // the DB transaction (FS not transactable). Backup writes happen outside
  // too — they're best-effort and tolerated to fail.
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.gather_inputs')
  async gatherInputs(payload: DeepDreamPayload): Promise<GatherInputsResult> {
    const targetDate = payload.target_date;
    const sourceDateIso = payload.source_date_iso ?? targetDate;

    let dreamId: number;
    try {
      dreamId = await this.dataSource.transaction(async (manager) => {
        const dreamRepo = manager.getRepository(DreamSchema);
        // Q4.b dedup: if a deep dream was created within the last 60s for
        // this target_date, return the existing dream id.
        const sixtySecondsAgo = new Date(Date.now() - SEXTY_SECONDS_MS);
        const existing = await dreamRepo
          .createQueryBuilder('d')
          .where('d.type = :type', { type: 'deep' })
          .andWhere('d.created_at >= :cutoff', { cutoff: sixtySecondsAgo })
          .orderBy('d.created_at', 'DESC')
          .limit(1)
          .getOne();
        if (existing !== null) {
          return existing.id;
        }
        const dream = dreamRepo.create({
          type: 'deep',
          trigger: payload.trigger ?? 'auto',
          status: 'processing',
          startedAt: new Date(),
        } satisfies Partial<Dream>);
        const saved = await dreamRepo.save(dream);
        return saved.id;
      });
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_GATHER_INPUTS_FAILED, `gatherInputs DB op failed: ${(err as Error).message}`);
    }

    // FS reads — defensive, never throw.
    const vaultRoot = this.config.vaultPath;
    const memoryMd = (await safeReadVault(vaultRoot, 'MEMORY.md')) ?? '';
    const dailyLog = (await safeReadVault(vaultRoot, `dailys/${sourceDateIso}.md`)) ?? '';
    const soulMd = (await safeReadVault(vaultRoot, 'SOUL.md')) ?? '';

    // Backups (best-effort).
    if (memoryMd !== '') {
      await safeWriteVault(vaultRoot, `.backups/MEMORY.md.${sourceDateIso}.bak`, memoryMd);
    }
    if (dailyLog !== '') {
      await safeWriteVault(vaultRoot, `.backups/dailys-${sourceDateIso}.bak`, dailyLog);
    }

    // MemU snapshot — graceful fallback to empty list on MemU failure.
    let memuMemories: Array<Record<string, unknown>> = [];
    try {
      const result = await this.memuApi.retrieve(`deep-dream:${sourceDateIso}`);
      memuMemories = result.memories.map((m) => ({ ...m })) as unknown as Array<Record<string, unknown>>;
    } catch (err) {
      this.logger.warn({
        message: 'deep dream gather_inputs memu retrieve failed — continuing with empty list',
        event: 'deepDream.gatherInputs.memuFailed',
        dreamId,
        error: (err as Error).message,
      });
    }

    this.logger.log({
      message: 'deep dream gather_inputs completed',
      event: 'deepDream.gatherInputs.completed',
      dreamId,
      memuMemoriesCount: memuMemories.length,
      memoryMdLines: memoryMd.split('\n').length,
      dailyLogLines: dailyLog.split('\n').length,
      sourceDateIso,
    });

    return {
      dream_id: dreamId,
      memu_memories: memuMemories,
      memory_md: memoryMd,
      daily_log: dailyLog,
      soul_md: soulMd,
      source_date_iso: sourceDateIso,
    };
  }

  // ---------------------------------------------------------------------------
  // Activity 2: runPhase1LightSleep (wire `deep.phase1_light_sleep`)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Activity 3: scoreCandidates (wire `deep.score_candidates`)
  //
  // Pure deterministic. NO LLM, NO DB, NO FS, NO telemetry. Mirrors Python
  // `score_candidates.py:9-22` byte-for-byte (modulo 4-decimal rounding).
  // Hard-codes `days_since_reinforced=0` and `in_active_project=true` per
  // Python lines 16-17.
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.score_candidates')
  async scoreCandidates(inp: ScoringInput): Promise<ScoredCandidatesResult> {
    try {
      const weights = this.config.scoringWeights;
      const decayRate = this.config.scoringDecayRate;
      const scored = inp.candidates_json.map((candidate) => {
        const reinforcement = typeof candidate['reinforcement_count'] === 'number' ? candidate['reinforcement_count'] : 0;
        const sourceSessions = Array.isArray(candidate['source_sessions']) ? candidate['source_sessions'] : [];
        const contradiction = candidate['contradiction_flag'] === true;
        const score = calculateCandidateScore(
          {
            reinforcement_count: reinforcement,
            days_since_reinforced: 0, // hard-coded per Python
            in_active_project: true, // hard-coded per Python
            has_contradiction: contradiction,
            context_count: sourceSessions.length,
          },
          { weights, decay_rate: decayRate },
        );
        return { ...candidate, score: Math.round(score * 10000) / 10000 };
      });
      this.logger.log({
        message: 'deep dream score_candidates completed',
        event: 'deepDream.scoreCandidates.completed',
        dreamId: inp.dream_id,
        scoredCount: scored.length,
      });
      return { scored };
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_SCORING_FAILED, `scoreCandidates failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 4: runPhase2RemSleep (wire `deep.phase2_rem_sleep`)
  //
  // Internal try/catch soft-fail per Python `phase2_rem_sleep.py:26-87`.
  // Returns `{ output_json: null }` on any exception. The workflow does NOT
  // catch — relies on the activity-level soft-fail.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Activity 5: runPhase3DeepSleep (wire `deep.phase3_deep_sleep`)
  // ---------------------------------------------------------------------------
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

    // Build the consolidation_json that downstream activities will consume.
    // We pass the schema-validated object directly per Q14 — no
    // `consolidation_to_dict` helper port. The Q10 topics-drop happens at
    // the writeFiles boundary, NOT here (preserve emission for Phase 3
    // telemetry parity).
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

    // The deepagents factory wrapper does not expose token usage right now
    // (Story 13.10 Finding 4 deferred). We surface nulls until Story 13.10.1
    // wires it. messages_json is also empty for now — Health Fix's
    // `messageHistory` continuation works against an empty list (deepagents
    // re-runs the agent with the new prompt only, which is acceptable for
    // dream parity until full message-history serialization lands).
    return {
      consolidation_json: consolidationJson,
      messages_json: [],
      usage_input_tokens: null,
      usage_output_tokens: null,
      usage_total_tokens: null,
      usage_tool_calls: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Activity 6: runHealthCheck (wire `deep.health_check`)
  //
  // Pure deterministic — NO LLM. NO telemetry per Python.
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.health_check')
  async runHealthCheck(inp: HealthCheckInput): Promise<HealthReportResult> {
    const report = await runHealthChecks(this.config.vaultPath, inp.knowledge_gap_names);
    this.logger.log({
      message: 'deep dream health_check completed',
      event: 'deepDream.healthCheck.completed',
      dreamId: inp.dream_id,
      totalIssues: report.total_issues,
      orphanCount: report.orphan_notes.length,
      staleCount: report.stale_notes.length,
      missingFrontmatterCount: report.missing_frontmatter.length,
      contradictionsCount: report.unresolved_contradictions.length,
      memoryOverflow: report.memory_overflow,
      missingBacklinksCount: report.missing_backlinks.length,
      unclassifiedLessonsCount: report.unclassified_lessons.length,
      brokenWikilinksCount: report.broken_wikilinks.length,
    });
    return {
      report_json: report as unknown as Record<string, unknown>,
      total_issues: report.total_issues,
    };
  }

  // ---------------------------------------------------------------------------
  // Activity 7: runHealthFix (wire `deep.health_fix`)
  //
  // Bounded 3-iteration loop INSIDE the activity. Returns 'clean' / 'fixed'
  // / 'incomplete'. The workflow flips `is_partial = true` on 'incomplete'.
  // ---------------------------------------------------------------------------
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
      // 1. Auto-fix Python-side issues (idempotent).
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

      // 2. Re-run health checks.
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

      // 3. All clean?
      if (healthReport.total_issues === 0) {
        return { status: 'clean', report_json: healthReport as unknown as Record<string, unknown>, total_issues_remaining: 0 };
      }

      // 4. No history? Stop — agent can't make progress.
      if (messageHistory.length === 0) {
        break;
      }

      // 5. Iteration cap.
      if (iteration > HEALTH_FIX_MAX_ITERATIONS) {
        return {
          status: 'incomplete',
          report_json: healthReport as unknown as Record<string, unknown>,
          total_issues_remaining: healthReport.total_issues,
        };
      }

      // 6. Filter to LLM-scoped issues.
      const llmScoped = filterLlmScope(healthReport);
      if (llmScoped.total_issues === 0) {
        return { status: 'fixed', report_json: healthReport as unknown as Record<string, unknown>, total_issues_remaining: 0 };
      }

      // 7. Run LLM agent with messageHistory.
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

  // ---------------------------------------------------------------------------
  // Activity 8: writeFiles (wire `deep.write_files`)
  //
  // Q3 deviation: we do NOT write vault files to disk here. Instead we
  // collect (path, content, action) triples in `vault_writes` and let
  // `commitAndPr` write them on the new branch. MEMORY.md backup IS
  // written here (mirrors Python — backup files live in `.backups/` outside
  // the dream-PR commit). file_manifest update happens here (DB op).
  //
  // Q10 / Q14: explicit `delete vault_updates.topics` before iterating.
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.write_files')
  async writeFiles(inp: WriteFilesInput): Promise<WriteFilesResult> {
    try {
      const consolidationRaw = inp.consolidation_json;
      // Validate we actually have a memory_md — Python raises ValueError on empty.
      const memoryMd = typeof consolidationRaw['memory_md'] === 'string' ? consolidationRaw['memory_md'] : '';
      if (memoryMd.trim() === '') {
        throw new InternalException(ErrorCode.DEEP_DREAM_WRITE_FILES_FAILED, 'consolidation memory_md is empty');
      }
      const dailySummary = typeof consolidationRaw['daily_summary'] === 'string' ? consolidationRaw['daily_summary'] : '';
      if (dailySummary.trim() === '') {
        throw new InternalException(ErrorCode.DEEP_DREAM_WRITE_FILES_FAILED, 'consolidation daily_summary is empty');
      }

      const filesModified: Array<{ path: string; action: string }> = [];
      const vaultWrites: VaultWriteTriple[] = [];

      // 1. Backup current MEMORY.md to topics/memory-backup-{date}.md (DISK,
      //    mirrors Python `services/deep_dream.py:175-185`). Backup writes
      //    are NOT part of the PR — they're vault-state on disk that the
      //    next gather_inputs sees.
      const sourceDateIso = inp.source_date_iso;
      const currentMemory = (await safeReadVault(this.config.vaultPath, 'MEMORY.md')) ?? '';
      const backupRel = `topics/memory-backup-${sourceDateIso}.md`;
      await safeWriteVault(this.config.vaultPath, backupRel, currentMemory);
      filesModified.push({ path: 'MEMORY.md', action: 'rewrite' });
      filesModified.push({ path: backupRel, action: 'create' });

      // 2. MEMORY.md write — Q3 deviation: collect a triple, don't write to disk.
      vaultWrites.push({ path: 'MEMORY.md', content: memoryMd, action: 'update' });

      // 3. Vault folder updates — Q10/Q14: explicit topics-drop.
      const vaultUpdatesRaw = (consolidationRaw['vault_updates'] as VaultUpdates | undefined) ?? null;
      if (vaultUpdatesRaw !== null) {
        // Q14: pass Zod-parsed object directly; explicit topics-drop at
        // activity boundary so byte-equivalence with Python's
        // consolidation_to_dict matches.
        const vaultUpdates: Omit<VaultUpdates, 'topics'> = {
          decisions: vaultUpdatesRaw.decisions ?? [],
          projects: vaultUpdatesRaw.projects ?? [],
          patterns: vaultUpdatesRaw.patterns ?? [],
          templates: vaultUpdatesRaw.templates ?? [],
          concepts: vaultUpdatesRaw.concepts ?? [],
          connections: vaultUpdatesRaw.connections ?? [],
          lessons: vaultUpdatesRaw.lessons ?? [],
        };
        for (const folder of Object.keys(vaultUpdates) as Array<keyof typeof vaultUpdates>) {
          const entries = vaultUpdates[folder];
          for (const entry of entries) {
            const relPath = `${folder}/${entry.filename}`;
            // Build file body with frontmatter header for `create`.
            const body = entry.action === 'create' ? buildVaultFileWithFrontmatter(folder, entry, sourceDateIso) : entry.content;
            vaultWrites.push({ path: relPath, content: body, action: entry.action });
            filesModified.push({ path: relPath, action: entry.action });
          }
        }
      }

      // 4. Update file_manifest table (DB op). Defensive — manifest update
      //    failure shouldn't block the dream.
      try {
        for (const fm of filesModified) {
          await this.manifestRepo.upsertEntry({
            filePath: fm.path,
            contentHash: '', // Manifest hash recomputed on next /memory/files/manifest GET.
            updatedAt: new Date(),
          });
        }
      } catch (err) {
        this.logger.warn({ message: 'manifest upsert failed', event: 'deepDream.writeFiles.manifestFailed', error: (err as Error).message });
      }

      this.logger.log({
        message: 'deep dream write_files completed',
        event: 'deepDream.writeFiles.completed',
        dreamId: inp.dream_id,
        filesModifiedCount: filesModified.length,
      });

      return { files_modified: filesModified, vault_writes: vaultWrites };
    } catch (err) {
      if (err instanceof InternalException) throw err;
      throw new InternalException(ErrorCode.DEEP_DREAM_WRITE_FILES_FAILED, `writeFiles failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 9: commitAndPr (wire `deep.commit_and_pr`)
  //
  // Q3 deviation: writes the (path, content) triples on the new branch via
  // gitOps.writeFiles(...). PR body mirrors Python's silent 3-of-5 stat
  // rendering for byte-equivalence (see Dev Notes §K, Q15 from 13.10).
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.commit_and_pr')
  async commitAndPr(inp: DeepCommitAndPRInput): Promise<CommitAndPRResult> {
    const branch = `dream/deep-${inp.target_date_iso}`;
    if (inp.vault_writes.length === 0 && inp.files_modified.length === 0) {
      return { git_branch: branch, git_pr_url: '', git_pr_status: 'no_files' };
    }

    const commitMsg = `dream(deep): consolidate ${inp.target_date_iso}`;
    const prBody = buildDeepPRBody(inp);

    try {
      await this.gitOps.pullLatestMain();
      await this.gitOps.createBranch(branch);
      // Q3 deviation: write the triples on the new branch (working tree
      // empty after createBranch reset; no race).
      const fileChanges = inp.vault_writes.map((t) => ({ path: t.path, content: t.content }));
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
        autoMerge: false,
      });

      this.logger.log({
        message: 'deep dream commit_and_pr completed',
        event: 'deepDream.commitAndPr.completed',
        dreamId: inp.dream_id,
        prUrl: result.url,
        status: 'created',
      });
      return { git_branch: branch, git_pr_url: result.url, git_pr_status: 'created' };
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_COMMIT_AND_PR_FAILED, `commitAndPr failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 10: alignMemu (wire `deep.align_memu`)
  //
  // File-based idempotency log per Q8. Per-entry MemU calls (not bulk).
  // Per-entry try/except tolerates partial failures.
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.align_memu')
  async alignMemu(inp: AlignMemuInput): Promise<void> {
    const vaultRoot = this.config.vaultPath;
    try {
      // Idempotency check.
      const existing = (await safeReadVault(vaultRoot, IDEMPOTENCY_LOG_PATH)) ?? '';
      if (existing.split('\n').includes(inp.idempotency_key)) {
        this.logger.log({
          message: 'deep dream align_memu skipped — idempotent',
          event: 'deepDream.alignMemu.skipped.idempotent',
          dreamId: inp.dream_id,
          idempotencyKey: inp.idempotency_key,
        });
        return;
      }

      const entries = extractMemoryEntries(inp.memory_md);
      let synced = 0;
      let errors = 0;
      for (const entry of entries) {
        const messages = [
          {
            role: 'user',
            content: `[${entry.type}] ${entry.content} (source: deep_dream, date: ${inp.source_date_iso}, type: consolidated_memory)`,
          },
        ];
        try {
          await this.memuApi.memorize(messages);
          synced += 1;
        } catch (err) {
          errors += 1;
          this.logger.warn({
            message: 'deep dream align_memu item failed',
            event: 'deepDream.alignMemu.itemFailed',
            dreamId: inp.dream_id,
            entryType: entry.type,
            error: (err as Error).message,
          });
        }
      }

      // Append idempotency key.
      const newContent = (existing.endsWith('\n') ? existing : existing.length > 0 ? `${existing}\n` : '') + `${inp.idempotency_key}\n`;
      await safeWriteVault(vaultRoot, IDEMPOTENCY_LOG_PATH, newContent);

      this.logger.log({
        message: 'deep dream align_memu completed',
        event: 'deepDream.alignMemu.completed',
        dreamId: inp.dream_id,
        itemsSynced: synced,
        errors,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_ALIGN_MEMU_FAILED, `alignMemu failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 11: invalidateContextCache (wire `deep.invalidate_cache`)
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.invalidate_cache')
  async invalidateContextCache(inp: InvalidateCacheInput): Promise<void> {
    await this.commandBus.execute(new InvalidateContextCacheCommand({ reason: 'deep-dream-completed', timestamp: new Date() }));
    this.logger.log({
      message: 'deep dream invalidate context cache dispatched',
      event: 'deepDream.invalidateContextCache.dispatched',
      dreamId: inp.dream_id,
    });
  }

  // ---------------------------------------------------------------------------
  // Activity 12: markDeepDreamOutcome (wire `deep.mark_dream_outcome`) — TS-only
  // ---------------------------------------------------------------------------
  @TemporalActivity('deep.mark_dream_outcome')
  async markDeepDreamOutcome(inp: MarkDeepDreamOutcomeInput): Promise<void> {
    await this.dreamRepo.updateDreamOutcome(inp.dream_id, inp.outcome, 'completed');
    this.logger.log({
      message: 'deep dream outcome marked',
      event: 'deepDream.markDeepDreamOutcome.completed',
      dreamId: inp.dream_id,
      outcome: inp.outcome,
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 2 helpers — daily-log + vault-index pre-loading
  // ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

async function safeReadVault(vaultRoot: string, relPath: string): Promise<string | null> {
  const resolved = safeResolveVaultPath(vaultRoot, relPath);
  if (resolved === null) return null;
  try {
    return await fs.readFile(resolved, 'utf-8');
  } catch {
    return null;
  }
}

async function safeWriteVault(vaultRoot: string, relPath: string, content: string): Promise<void> {
  const resolved = safeResolveVaultPath(vaultRoot, relPath);
  if (resolved === null) return;
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  } catch {
    // best-effort
  }
}

/**
 * Mirrors Python `_extract_memory_entries` — only `## Strong Patterns`,
 * `## Decisions`, `## Facts` sections; one entry per `- ` bullet.
 */
function extractMemoryEntries(memoryMd: string): Array<{ type: string; content: string }> {
  const entries: Array<{ type: string; content: string }> = [];
  let currentSection: string | null = null;
  for (const line of memoryMd.split('\n')) {
    const stripped = line.trim();
    if ((MEMORY_SECTIONS_FOR_MEMU as readonly string[]).includes(stripped.replace(/^## /, ''))) {
      currentSection = stripped.replace(/^## /, '');
      continue;
    }
    if (stripped.startsWith('## ')) {
      currentSection = null;
      continue;
    }
    if (currentSection !== null && stripped.startsWith('- ')) {
      const content = stripped.slice(2).trim();
      if (content.length > 0) {
        entries.push({ type: currentSection, content });
      }
    }
  }
  return entries;
}

function buildPhase1RunPrompt(inp: Phase1Input): string {
  return [
    "Inventory, deduplicate, and score today's memories.",
    'Use queryMemuMemories() for MemU data.',
    '',
    '## Current MEMORY.md',
    inp.memory_md.length === 0 ? '(empty)' : inp.memory_md,
    '',
    "## Today's Daily Log",
    inp.daily_log.length === 0 ? '(empty)' : inp.daily_log,
  ].join('\n');
}

function buildPhase2RunPrompt(phase1Text: string, vaultIndexText: string): string {
  return [
    'Analyze cross-session patterns and detect themes, connections, gaps.',
    'Use readDailyLog(date_str) to read specific daily logs.',
    '',
    '## Phase 1 Candidates',
    phase1Text.length === 0 ? 'No Phase 1 candidates.' : phase1Text,
    '',
    '## Vault Indexes',
    vaultIndexText.length === 0 ? 'No vault indexes available.' : vaultIndexText,
  ].join('\n');
}

function buildPhase3RunPrompt(inp: Phase3Input, vaultGuide: string): string {
  const sections = [
    'Consolidate memories. Produce updated MEMORY.md, daily summary, and vault updates.',
    '',
    inp.phase1_summary,
    '',
    inp.phase2_summary,
    '',
    `## Current MEMORY.md\n${inp.memory_md.length === 0 ? '(empty)' : inp.memory_md}`,
    '',
    `## Today's Daily Log\n${inp.daily_log.length === 0 ? '(empty)' : inp.daily_log}`,
  ];
  if (vaultGuide.length > 0) {
    sections.push('');
    sections.push('## Vault Guide (file templates & structure)');
    sections.push(vaultGuide);
  }
  return sections.join('\n');
}

/**
 * Q5 RESOLVED: re-creates Python's lost `_format_phase1_for_phase2`
 * (`.pyc`-only). Per design doc §6.2 + Story 13.11 spec:
 *   `[i] (category) content [score=X.XX, reinforced=N] [CONTRADICTION]`
 * Phase 2 prompt explains the format.
 */
export function formatPhase1ForPhase2(candidates: Array<Record<string, unknown>>, scoredJson: Array<Record<string, unknown>>): string {
  const scoreMap = new Map<string, number>();
  for (const s of scoredJson) {
    const content = typeof s['content'] === 'string' ? s['content'] : '';
    const score = typeof s['score'] === 'number' ? s['score'] : 0;
    scoreMap.set(content, score);
  }
  const lines: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const content = typeof c['content'] === 'string' ? c['content'] : '';
    const category = typeof c['category'] === 'string' ? c['category'] : '';
    const reinforced = typeof c['reinforcement_count'] === 'number' ? c['reinforcement_count'] : 0;
    const score = (scoreMap.get(content) ?? 0).toFixed(2);
    const contradiction = c['contradiction_flag'] === true ? ' [CONTRADICTION]' : '';
    lines.push(`[${i + 1}] (${category}) ${content} [score=${score}, reinforced=${reinforced}]${contradiction}`);
  }
  return lines.join('\n');
}

/**
 * Q5 RESOLVED: re-creates Python's lost `_format_vault_indexes`. Per design
 * doc §6.2: `### {folder}/\n{contents}\n\n` per folder.
 */
export function formatVaultIndexes(vaultIndexes: Record<string, string>): string {
  const lines: string[] = [];
  for (const folder of Object.keys(vaultIndexes)) {
    lines.push(`### ${folder}/`);
    lines.push(vaultIndexes[folder] ?? '');
    lines.push('');
  }
  return lines.join('\n');
}

function buildVaultFileWithFrontmatter(
  folder: string,
  entry: { filename: string; title: string; summary: string; content: string; tags: string[] },
  sourceDateIso: string,
): string {
  const fm = [
    '---',
    `type: ${typeForFolder(folder)}`,
    'status: draft',
    `tags: [${entry.tags.map((t) => `"${t}"`).join(', ')}]`,
    `summary: "${entry.summary.replace(/"/g, '\\"')}"`,
    `created: ${sourceDateIso}`,
    `updated: ${sourceDateIso}`,
    `last_reviewed: ${sourceDateIso}`,
    'reinforcement_count: 0',
    'confidence: low',
    '---',
    '',
  ].join('\n');
  return `${fm}# ${entry.title}\n\n${entry.content}`;
}

function typeForFolder(folder: string): string {
  const map: Record<string, string> = {
    decisions: 'decision',
    patterns: 'pattern',
    projects: 'project',
    templates: 'template',
    concepts: 'concept',
    connections: 'connection',
    lessons: 'lesson',
    references: 'reference',
    reviews: 'review',
    topics: 'topic',
  };
  return map[folder] ?? 'note';
}

function countVaultUpdateEntries(updates: VaultUpdates): number {
  return (
    updates.decisions.length +
    updates.projects.length +
    updates.patterns.length +
    updates.templates.length +
    updates.concepts.length +
    updates.connections.length +
    updates.lessons.length +
    updates.topics.length
  );
}

function emptyHealthReport(): HealthReport {
  return {
    orphan_notes: [],
    stale_notes: [],
    missing_frontmatter: [],
    unresolved_contradictions: [],
    memory_overflow: false,
    knowledge_gaps: [],
    missing_backlinks: [],
    unclassified_lessons: [],
    broken_wikilinks: [],
    total_issues: 0,
  };
}

function filterLlmScope(report: HealthReport): HealthReport {
  const total = report.unresolved_contradictions.length + report.knowledge_gaps.length + report.unclassified_lessons.length;
  return {
    orphan_notes: [],
    stale_notes: [...report.stale_notes],
    missing_frontmatter: [],
    unresolved_contradictions: [...report.unresolved_contradictions],
    memory_overflow: report.memory_overflow,
    knowledge_gaps: [...report.knowledge_gaps],
    missing_backlinks: [],
    unclassified_lessons: [...report.unclassified_lessons],
    broken_wikilinks: [],
    total_issues: total,
  };
}

function formatLlmHealthSummary(scoped: HealthReport): string {
  const lines: string[] = [];
  for (const e of scoped.unresolved_contradictions) lines.push(`- Unresolved contradiction: ${e}`);
  for (const e of scoped.knowledge_gaps) lines.push(`- Knowledge gap: ${e}`);
  for (const e of scoped.unclassified_lessons) lines.push(`- Unclassified lesson: ${e}`);
  return [
    'The health check found LLM-scope issues after your consolidation.',
    'Return one HealthFixAction per issue in the HealthFixOutput:',
    '',
    ...lines,
  ].join('\n');
}

function buildDeepPRBody(inp: DeepCommitAndPRInput): string {
  const stats = inp.stats;
  const memProcessed = pickNumber(stats, 'total_memories_processed');
  const dups = pickNumber(stats, 'duplicates_removed');
  const contradictions = pickNumber(stats, 'contradictions_resolved');
  const filesList = inp.files_modified.map((fm) => `- \`${fm.path}\``).join('\n');
  return [
    '## Dream Deep Consolidation',
    '',
    `**Dream ID:** ${inp.dream_id}`,
    `**Date:** ${inp.target_date_iso}`,
    '',
    '### Stats',
    `- Memories processed: ${memProcessed}`,
    `- Duplicates removed: ${dups}`,
    `- Contradictions resolved: ${contradictions}`,
    '',
    '### Changed Files',
    filesList,
  ].join('\n');
}

function pickNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}
