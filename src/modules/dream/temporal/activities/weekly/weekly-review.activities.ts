/**
 * WeeklyReviewActivities — grouped Temporal activity service (Story 13.12).
 *
 * Per Story 13.0 sign-off A.2: ALL weekly-review activities are methods on
 * a SINGLE `@Injectable()` service. Mirrors the pattern Stories 13.10
 * (`LightDreamActivities`) and 13.11 (`DeepDreamActivities`) established.
 *
 * # 7 wire-frozen activity names (MC3 — see story Dev Notes §B / AC #4):
 *   1. weekly.gather_dailys
 *   2. weekly.gather_indexes
 *   3. weekly.run_weekly_review_agent
 *   4. weekly.write_review_file
 *   5. weekly.commit_and_pr
 *   6. weekly.invalidate_cache (TS-only enhancement — Q3)
 *   7. weekly.mark_dream_outcome (TS-only enhancement — Q8)
 *
 * # Module-boundary discipline (architecture.md §1.4 principle 8)
 *   The service injects ONLY:
 *     - Shared services (GitOpsService, DeepAgentFactory, PromptCacheService) — direct
 *     - Symbol-token-based domain interfaces (DREAM_REPOSITORY,
 *       DREAM_PHASE_REPOSITORY, MEMU_API) — direct
 *     - `CommandBus` (NestJS CQRS, global) — for cross-module command dispatch
 *     - `AppConfigService`, `Logger` — global
 *   It does NOT inject any class from `src/modules/{conversation, memory,
 *   context, vault, config}/...`. Cross-module work
 *   (`InvalidateContextCacheCommand`) goes through `CommandBus.execute(...)`.
 *
 * # Q3 deviation (RESOLVED 2026-05-08): triple-collection in writeReviewFile
 *   `writeReviewFile` collects `(path, content, action)` triples on the
 *   `WriteReviewResult.vault_writes` field; `commitAndPr` writes them on
 *   the new branch via `gitOps.writeFiles(...)`. Mirrors 13.10 Q12 / 13.11 Q3.
 *   Python's atomic temp+rename is replaced by branch-scoped writes — no
 *   race with `git checkout -B`'s working-tree reset.
 *
 * # Q3 cross-module addition (RESOLVED 2026-05-08): invalidateContextCache
 *   Python's weekly pipeline does NOT invalidate the context cache (no
 *   `invalidate_cache.py` in `app/activities/weekly/`). The TS port adds
 *   the activity for parity with light/deep dreams; defensive correctness
 *   improvement since the cache may include vault snapshots that touch
 *   `reviews/`.
 *
 * # Q4 fix (RESOLVED 2026-05-08): readVaultIndex tool registered
 *   Python's `weekly_review_agent.md` mentions `read_vault_index(folder)`
 *   but the Python agent doesn't register it (drift). The TS port REGISTERS
 *   the tool (deps-dict-backed lookup of pre-loaded `vault_indexes`).
 *
 * # Q5 RESOLVED 2026-05-08: empty-week non-retryable
 *   `gatherDailys` raises `ApplicationFailure.nonRetryable(...)` if
 *   `daily_logs` is empty. Mirrors Python `gather_dailys.py:41-44`. Workflow
 *   propagates the failure; Dream row stays at `'processing'` (Python-canonical
 *   inherited bug; flagged for retro fix in Story 13.18).
 *
 * # Q6 deviation (RESOLVED 2026-05-08): atomic transaction + dedup in gather_dailys
 *   Single TypeORM transaction with 60s defensive dedup check
 *   (`findRecentWeeklyReviewForWeek`). Mirrors 13.10 Q4 + 13.11 Q4 pattern.
 *
 * # Q8 RESOLVED 2026-05-08: markWeeklyReviewOutcome enhancement
 *   7th activity introduced as a TS-only enhancement, mirroring 13.10's
 *   `markDreamOutcome` and 13.11's `markDeepDreamOutcome`. Python's weekly
 *   workflow does NOT update `dream.outcome` post-activities — same Python
 *   bug we deliberately fix.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
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

import { buildWeeklyReviewAgent } from '../../../agents/weekly-review.agent';
import { type VaultToolDeps } from '../../../agents/tools/vault-tools';
import { WeeklyReviewOutputSchema, type WeeklyReviewOutput } from '../../../agents/schemas/weekly-review-output.schema';
import { weekIso as computeWeekIso } from '../../workflows/iso-week';
import type {
  AgentInput,
  AgentResult,
  CommitAndPRResult,
  GatherDailysResult,
  GatherIndexesInput,
  GatherIndexesResult,
  InvalidateCacheInput,
  MarkWeeklyReviewOutcomeInput,
  WeeklyCommitAndPRInput,
  WeeklyReviewPayload,
  WriteReviewInput,
  WriteReviewResult,
} from '../../types/weekly-review.types';

// Vault folder list used by gather_indexes (mirrors Python
// `gather_indexes.py:8-15`). Frozen 6 folders; templates is excluded
// deliberately (matches Python).
const VAULT_INDEX_FOLDERS = ['decisions', 'patterns', 'concepts', 'connections', 'lessons', 'projects'] as const;

// 7-day rolling window from `week_start` Monday (mirrors Python
// `gather_dailys.py:34` `range(7)`).
const DAILY_LOG_WINDOW_DAYS = 7;

// 60s defensive dedup window (mirrors 13.10 Q4 / 13.11 Q4 pattern).
const SIXTY_SECONDS_MS = 60_000;

@Injectable()
export class WeeklyReviewActivities {
  private readonly logger = new Logger(WeeklyReviewActivities.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly gitOps: GitOpsService,
    private readonly agentFactory: DeepAgentFactory,
    private readonly promptCache: PromptCacheService,
    @Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository,
    @Inject(DREAM_PHASE_REPOSITORY) private readonly dreamPhaseRepo: IDreamPhaseRepository,
    @InjectDataSource(DBConnections.INTERNAL) private readonly dataSource: DataSource,
    private readonly commandBus: CommandBus,
    private readonly config: AppConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Activity 1: gatherDailys (wire `weekly.gather_dailys`)
  //
  // Q5: empty week → ApplicationFailure(non-retryable). Q6: atomic
  // transaction + 60s defensive dedup.
  // ---------------------------------------------------------------------------
  @TemporalActivity('weekly.gather_dailys')
  async gatherDailys(payload: WeeklyReviewPayload): Promise<GatherDailysResult> {
    const weekStart = payload.week_start;
    const trigger = payload.trigger ?? 'auto';

    const dreamId = await this.dataSource.transaction(async (manager) => {
      const dreamRepo = manager.getRepository(DreamSchema);
      // Q6 dedup: if a weekly review was created within the last 60s for
      // this week_start, return the existing dream id (Temporal retry
      // idempotency). We match by type='weekly_review' and `created_at`
      // within window — input_summary is left null per Python parity.
      const sixtySecondsAgo = new Date(Date.now() - SIXTY_SECONDS_MS);
      const existing = await dreamRepo
        .createQueryBuilder('d')
        .where('d.type = :type', { type: 'weekly_review' })
        .andWhere('d.created_at >= :cutoff', { cutoff: sixtySecondsAgo })
        .orderBy('d.created_at', 'DESC')
        .limit(1)
        .getOne();
      if (existing !== null) {
        return existing.id;
      }
      const dream = dreamRepo.create({
        type: 'weekly_review',
        trigger,
        status: 'processing',
        startedAt: new Date(),
      } satisfies Partial<Dream>);
      const saved = await dreamRepo.save(dream);
      return saved.id;
    });

    // FS reads — load 7 daily logs starting from week_start Monday.
    const dailyLogs: Record<string, string> = {};
    const startDate = new Date(`${weekStart}T00:00:00Z`);
    if (Number.isNaN(startDate.getTime())) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_GATHER_DAILYS_EMPTY_WEEK, `Invalid week_start ISO date: ${weekStart}`);
    }
    for (let i = 0; i < DAILY_LOG_WINDOW_DAYS; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const content = await safeReadVault(this.config.vaultPath, `dailys/${iso}.md`);
      if (content !== null && content.length > 0) {
        dailyLogs[iso] = content;
      }
    }

    if (Object.keys(dailyLogs).length === 0) {
      this.logger.warn({
        message: 'weekly review gather_dailys empty week',
        event: 'weeklyReview.gatherDailys.emptyWeek',
        dreamId,
        weekStart,
      });
      // Q5: mirror Python's non-retryable raise. Workflow propagates the
      // failure; Dream row stays at 'processing' (Python-canonical bug).
      throw ApplicationFailure.nonRetryable(`No daily logs found for week starting ${weekStart}`, 'WEEKLY_REVIEW_EMPTY_WEEK');
    }

    this.logger.log({
      message: 'weekly review gather_dailys completed',
      event: 'weeklyReview.gatherDailys.completed',
      dreamId,
      weekStart,
      dailyCount: Object.keys(dailyLogs).length,
    });

    return { dream_id: dreamId, week_start: weekStart, daily_logs: dailyLogs };
  }

  // ---------------------------------------------------------------------------
  // Activity 2: gatherIndexes (wire `weekly.gather_indexes`)
  //
  // Pure read; idempotent. Reads 6 folder _index.md files + _guide.md.
  // No `dream_phases` telemetry per Python parity.
  // ---------------------------------------------------------------------------
  @TemporalActivity('weekly.gather_indexes')
  async gatherIndexes(inp: GatherIndexesInput): Promise<GatherIndexesResult> {
    try {
      const vaultIndexes: Record<string, string> = {};
      for (const folder of VAULT_INDEX_FOLDERS) {
        const content = await safeReadVault(this.config.vaultPath, `${folder}/_index.md`);
        if (content !== null && content.length > 0) {
          vaultIndexes[folder] = content;
        }
      }
      const vaultGuide = (await safeReadVault(this.config.vaultPath, '_guide.md')) ?? '';

      this.logger.log({
        message: 'weekly review gather_indexes completed',
        event: 'weeklyReview.gatherIndexes.completed',
        dreamId: inp.dream_id,
        indexCount: Object.keys(vaultIndexes).length,
        guideLength: vaultGuide.length,
      });

      return { vault_indexes: vaultIndexes, vault_guide: vaultGuide };
    } catch (err) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_GATHER_INDEXES_FAILED, `gatherIndexes failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 3: runWeeklyReviewAgent (wire `weekly.run_weekly_review_agent`)
  //
  // Builds the weekly-review agent, runs it, writes `dream_phases` row
  // (phase='weekly_review') per Story 11.2 invariant.
  // ---------------------------------------------------------------------------
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

    // The deepagents factory wrapper does not currently expose token usage
    // (Story 13.10 Finding 4 / 13.11 deferred). Surface nulls until the
    // wrapper enhancement lands alongside fixture recording (13.12.1).
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

  // ---------------------------------------------------------------------------
  // Activity 4: writeReviewFile (wire `weekly.write_review_file`)
  //
  // Q3 deviation: collects (path, content, action) triple — does NOT write
  // to disk. `commitAndPr` writes on the new branch.
  // ---------------------------------------------------------------------------
  @TemporalActivity('weekly.write_review_file')
  async writeReviewFile(inp: WriteReviewInput): Promise<WriteReviewResult> {
    try {
      const weekIso = computeWeekIso(inp.week_start);
      const reviewPath = `reviews/${weekIso}.md`;
      const frontmatter = buildReviewFrontmatter(inp.week_start, weekIso);
      const fullContent = frontmatter + inp.review_content;

      this.logger.log({
        message: 'weekly review write_review_file completed',
        event: 'weeklyReview.writeReviewFile.completed',
        dreamId: inp.dream_id,
        reviewPath,
      });

      return {
        review_path: reviewPath,
        files_modified: [{ path: reviewPath, action: 'create' }],
        vault_writes: [{ path: reviewPath, content: fullContent, action: 'create' }],
      };
    } catch (err) {
      if (err instanceof InternalException) throw err;
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_WRITE_FILE_FAILED, `writeReviewFile failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 5: commitAndPr (wire `weekly.commit_and_pr`)
  //
  // Q3 deviation: writes the (path, content) triples on the new branch via
  // gitOps.writeFiles(...). Branch `dream/review-{week_iso}`. PR body
  // mirrors Python `commit_and_pr.py:67-73` byte-for-byte.
  // ---------------------------------------------------------------------------
  @TemporalActivity('weekly.commit_and_pr')
  async commitAndPr(inp: WeeklyCommitAndPRInput): Promise<CommitAndPRResult> {
    const branch = `dream/review-${inp.week_iso}`;
    if (inp.vault_writes.length === 0 && inp.files_modified.length === 0) {
      return { git_branch: branch, git_pr_url: '', git_pr_status: 'no_files' };
    }

    const commitMsg = `dream(weekly): review ${inp.week_iso}`;
    const prBody = buildWeeklyReviewPRBody(inp);

    try {
      await this.gitOps.pullLatestMain();
      await this.gitOps.createBranch(branch);
      // Q3 deviation: write triples on the new branch (working tree empty
      // after createBranch reset; no race).
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
        autoMerge: false, // dream-config auto-merge wired in 13.13/13.14
      });

      this.logger.log({
        message: 'weekly review commit_and_pr completed',
        event: 'weeklyReview.commitAndPr.completed',
        dreamId: inp.dream_id,
        prUrl: result.url,
        status: 'created',
      });
      return { git_branch: branch, git_pr_url: result.url, git_pr_status: 'created' };
    } catch (err) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_COMMIT_AND_PR_FAILED, `commitAndPr failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 6: invalidateContextCache (wire `weekly.invalidate_cache`) — TS-only
  //
  // Q3 RESOLVED: Python's weekly pipeline does NOT invalidate the cache.
  // The TS port adds the activity for parity with light/deep dreams.
  // ---------------------------------------------------------------------------
  @TemporalActivity('weekly.invalidate_cache')
  async invalidateContextCache(inp: InvalidateCacheInput): Promise<void> {
    try {
      await this.commandBus.execute(new InvalidateContextCacheCommand({ reason: 'weekly-review-completed', timestamp: new Date() }));
      this.logger.log({
        message: 'weekly review invalidate context cache dispatched',
        event: 'weeklyReview.invalidateContextCache.dispatched',
        dreamId: inp.dream_id,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_INVALIDATE_CACHE_FAILED, `invalidateContextCache failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Activity 7: markWeeklyReviewOutcome (wire `weekly.mark_dream_outcome`) — TS-only
  //
  // Q8 RESOLVED: Python's weekly workflow does NOT update dream.outcome.
  // ---------------------------------------------------------------------------
  @TemporalActivity('weekly.mark_dream_outcome')
  async markWeeklyReviewOutcome(inp: MarkWeeklyReviewOutcomeInput): Promise<void> {
    try {
      await this.dreamRepo.updateDreamOutcome(inp.dream_id, inp.outcome, 'completed');
      this.logger.log({
        message: 'weekly review outcome marked',
        event: 'weeklyReview.markWeeklyReviewOutcome.completed',
        dreamId: inp.dream_id,
        outcome: inp.outcome,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_OUTCOME_UPDATE_FAILED, `markWeeklyReviewOutcome failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

// Suppress unused-import lint for `path` — kept for parity with deep-dream
// activities helper layout; reuse when atomic write returns to TS port (it
// won't — Q3 triple-collection deviation eliminates direct disk writes).
void path;

/**
 * Mirrors Python `write_review_file.py:21-29` byte-for-byte. The trailing
 * newline after `---` matches Python's f-string output exactly (the
 * `review_content` body is appended directly after).
 */
function buildReviewFrontmatter(weekStartIso: string, weekIso: string): string {
  return ['---', 'type: review', 'tags: [review, weekly]', `created: ${weekStartIso}`, `week: ${weekIso}`, '---', ''].join('\n');
}

/**
 * Mirrors Python `commit_and_pr.py:67-73` byte-for-byte:
 *   ## Weekly Review
 *
 *   **Dream ID:** {dream_id}
 *   **Week:** {week_iso}
 *
 *   ### Changed Files
 *   - `path`
 */
function buildWeeklyReviewPRBody(inp: WeeklyCommitAndPRInput): string {
  const fileLines = inp.files_modified.map((fm) => `- \`${fm.path}\``).join('\n');
  return ['## Weekly Review', '', `**Dream ID:** ${inp.dream_id}`, `**Week:** ${inp.week_iso}`, '', '### Changed Files', fileLines].join('\n');
}
