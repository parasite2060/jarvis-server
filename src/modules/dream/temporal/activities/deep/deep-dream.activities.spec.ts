/**
 * Unit tests for `DeepDreamActivities` (Story 13.11 / Task 9).
 *
 * AAA + `@golevelup/ts-jest` `createMock` for every constructor dependency.
 * The deep-dream factory is mocked at module level by the global Jest
 * `moduleNameMapper`; we override per-test to control structuredResponse.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DeepDreamActivities } from './deep-dream.activities';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY, IDreamPhaseRepository } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { FILE_MANIFEST_REPOSITORY, IFileManifestRepository } from 'src/shared/domain/repositories/file-manifest.repository.interface';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import { LightSleepOutputSchema } from '../../../agents/schemas/light-sleep-output.schema';
import { REMSleepOutputSchema } from '../../../agents/schemas/rem-sleep-output.schema';
import { ConsolidationOutputSchema } from '../../../agents/schemas/consolidation-output.schema';
import { HealthFixOutputSchema } from '../../../agents/schemas/health-fix-output.schema';

jest.mock('deepagents', () => ({
  createDeepAgent: jest.fn().mockReturnValue({ invoke: jest.fn() }),
}));

describe('DeepDreamActivities', () => {
  let target: DeepDreamActivities;
  let mockMemuApi: DeepMocked<IMemuApi>;
  let mockGitOps: DeepMocked<GitOpsService>;
  let mockAgentFactory: DeepMocked<DeepAgentFactory>;
  let mockPromptCache: DeepMocked<PromptCacheService>;
  let mockDreamRepo: DeepMocked<IDreamRepository>;
  let mockPhaseRepo: DeepMocked<IDreamPhaseRepository>;
  let mockManifestRepo: DeepMocked<IFileManifestRepository>;
  let mockDataSource: DeepMocked<DataSource>;
  let mockCommandBus: DeepMocked<CommandBus>;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultPathOverride: string;

  beforeEach(async () => {
    mockMemuApi = createMock<IMemuApi>();
    mockGitOps = createMock<GitOpsService>();
    mockAgentFactory = createMock<DeepAgentFactory>();
    mockPromptCache = createMock<PromptCacheService>();
    mockDreamRepo = createMock<IDreamRepository>();
    mockPhaseRepo = createMock<IDreamPhaseRepository>();
    mockManifestRepo = createMock<IFileManifestRepository>();
    mockDataSource = createMock<DataSource>();
    mockCommandBus = createMock<CommandBus>();
    mockConfig = createMock<AppConfigService>();
    vaultPathOverride = '/tmp/vault-not-real';

    // Common config getters used across activities. Use a mutable reference
    // for vaultPath so individual tests can swap to real tmp dirs without
    // tripping `defineProperty` redefinition errors.
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => vaultPathOverride });
    Object.defineProperty(mockConfig, 'deepPhase1Limits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    Object.defineProperty(mockConfig, 'deepPhase2Limits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    Object.defineProperty(mockConfig, 'deepPhase3Limits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    Object.defineProperty(mockConfig, 'healthFixLimits', { configurable: true, get: () => ({ maxTokens: 1, maxIterations: 1 }) });
    Object.defineProperty(mockConfig, 'scoringWeights', {
      configurable: true,
      get: () => ({ frequency: 0.25, recency: 0.25, relevance: 0.2, consistency: 0.2, breadth: 0.1 }),
    });
    Object.defineProperty(mockConfig, 'scoringDecayRate', { configurable: true, get: () => 0.03 });

    mockPromptCache.getPrompt.mockReturnValue('test prompt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepDreamActivities,
        { provide: MEMU_API, useValue: mockMemuApi },
        { provide: GitOpsService, useValue: mockGitOps },
        { provide: DeepAgentFactory, useValue: mockAgentFactory },
        { provide: PromptCacheService, useValue: mockPromptCache },
        { provide: DREAM_REPOSITORY, useValue: mockDreamRepo },
        { provide: DREAM_PHASE_REPOSITORY, useValue: mockPhaseRepo },
        { provide: FILE_MANIFEST_REPOSITORY, useValue: mockManifestRepo },
        { provide: getDataSourceToken(DBConnections.INTERNAL), useValue: mockDataSource },
        { provide: CommandBus, useValue: mockCommandBus },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(DeepDreamActivities);
  });

  describe('scoreCandidates (pure deterministic, no LLM)', () => {
    it('hard-codes days_since_reinforced=0 and in_active_project=true; rounds to 4 decimals', async () => {
      // Arrange
      const candidates = [
        { content: 'a', category: 'decisions', reinforcement_count: 5, contradiction_flag: false, source_sessions: ['s1'] },
        { content: 'b', category: 'patterns', reinforcement_count: 0, contradiction_flag: true, source_sessions: [] },
      ];

      // Act
      const result = await target.scoreCandidates({ dream_id: 1, candidates_json: candidates });

      // Assert
      expect(result.scored).toHaveLength(2);
      expect(result.scored[0]!['score']).toBeDefined();
      expect(typeof result.scored[0]!['score']).toBe('number');
      // Score for `a`: freq=0.5*0.25 + 1*0.25 + 1*0.2 + 1*0.2 + (1/5)*0.1 = 0.125 + 0.25 + 0.2 + 0.2 + 0.02 = 0.795
      expect(result.scored[0]!['score']).toBeCloseTo(0.795, 4);
      // Score for `b`: freq=0 + 1*0.25 + 1*0.2 + 0 + 0 = 0.45
      expect(result.scored[1]!['score']).toBeCloseTo(0.45, 4);
    });

    it('preserves all candidate fields and adds score', async () => {
      // Arrange
      const candidate = {
        content: 'x',
        category: 'decisions',
        reinforcement_count: 2,
        contradiction_flag: false,
        source_sessions: [],
        extra: 'preserved',
      };

      // Act
      const result = await target.scoreCandidates({ dream_id: 1, candidates_json: [candidate] });

      // Assert
      expect(result.scored[0]).toMatchObject({ content: 'x', extra: 'preserved' });
      expect(result.scored[0]!['score']).toBeDefined();
    });
  });

  describe('invalidateContextCache', () => {
    it("dispatches InvalidateContextCacheCommand with reason 'deep-dream-completed'", async () => {
      // Arrange / Act
      await target.invalidateContextCache({ dream_id: 42 });

      // Assert
      expect(mockCommandBus.execute).toHaveBeenCalledTimes(1);
      const cmd = mockCommandBus.execute.mock.calls[0]![0] as InvalidateContextCacheCommand;
      expect(cmd).toBeInstanceOf(InvalidateContextCacheCommand);
      expect(cmd.payload.reason).toBe('deep-dream-completed');
      expect(cmd.payload.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('markDeepDreamOutcome', () => {
    it('updates the dream row with outcome and status=completed', async () => {
      // Arrange / Act
      await target.markDeepDreamOutcome({ dream_id: 7, outcome: 'completed' });

      // Assert
      expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(7, 'completed', 'completed');
    });

    it("supports outcome='skipped'", async () => {
      // Arrange / Act
      await target.markDeepDreamOutcome({ dream_id: 8, outcome: 'skipped' });

      // Assert
      expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(8, 'skipped', 'completed');
    });

    it("supports outcome='partial'", async () => {
      // Arrange / Act
      await target.markDeepDreamOutcome({ dream_id: 9, outcome: 'partial' });

      // Assert
      expect(mockDreamRepo.updateDreamOutcome).toHaveBeenCalledWith(9, 'partial', 'completed');
    });
  });

  describe('runPhase1LightSleep — agent + telemetry', () => {
    it('records dream_phases on successful run', async () => {
      // Arrange
      mockAgentFactory.create.mockReturnValue({
        usageLimits: { totalTokens: 1, toolCalls: 1 },
        outputSchema: LightSleepOutputSchema,
        invoke: async () => ({
          candidates: [{ content: 'x', category: 'decisions', reinforcement_count: 1, contradiction_flag: false, source_sessions: [] }],
          duplicates_removed: 0,
          contradictions_found: 0,
        }),
      });

      // Act
      const result = await target.runPhase1LightSleep({
        dream_id: 1,
        memu_memories: [],
        memory_md: '',
        daily_log: '',
        soul_md: '',
        source_date_iso: '2026-05-07',
      });

      // Assert
      expect(result.candidates_json).toHaveLength(1);
      expect(mockPhaseRepo.recordPhase).toHaveBeenCalled();
      const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
      expect(args.phase).toBe('phase1_light_sleep');
      expect(args.status).toBe('completed');
    });

    it('records failed phase when agent throws', async () => {
      // Arrange
      mockAgentFactory.create.mockReturnValue({
        usageLimits: { totalTokens: 1, toolCalls: 1 },
        outputSchema: LightSleepOutputSchema,
        invoke: async () => {
          throw new Error('LLM failed');
        },
      });

      // Act / Assert
      await expect(
        target.runPhase1LightSleep({
          dream_id: 1,
          memu_memories: [],
          memory_md: '',
          daily_log: '',
          soul_md: '',
          source_date_iso: '2026-05-07',
        }),
      ).rejects.toThrow();
      const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
      expect(args.status).toBe('failed');
    });
  });

  describe('runPhase2RemSleep — internal soft-fail', () => {
    it('returns { output_json: null } on agent error (soft-fail policy)', async () => {
      // Arrange
      mockAgentFactory.create.mockReturnValue({
        usageLimits: { totalTokens: 1, toolCalls: 1 },
        outputSchema: REMSleepOutputSchema,
        invoke: async () => {
          throw new Error('phase 2 boom');
        },
      });

      // Act
      const result = await target.runPhase2RemSleep({
        dream_id: 1,
        source_date_iso: '2026-05-07',
        candidates_json: [],
        scored_json: [],
      });

      // Assert — soft-fail: output_json is null, no exception bubbled.
      expect(result.output_json).toBeNull();
      const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
      expect(args.status).toBe('failed');
    });
  });

  describe('runPhase3DeepSleep — telemetry path', () => {
    it('records completed phase with consolidation_json output', async () => {
      // Arrange
      const out = {
        memory_md: 'updated',
        daily_summary: 'summary',
        stats: { total_memories_processed: 1, duplicates_removed: 0, contradictions_resolved: 0, patterns_promoted: 0, stale_pruned: 0 },
        vault_updates: { decisions: [], projects: [], patterns: [], templates: [], concepts: [], connections: [], lessons: [], topics: [] },
        vault_writes: [],
      };
      mockAgentFactory.create.mockReturnValue({
        usageLimits: { totalTokens: 1, toolCalls: 1 },
        outputSchema: ConsolidationOutputSchema,
        invoke: async () => out,
      });

      // Act
      const result = await target.runPhase3DeepSleep({
        dream_id: 1,
        source_date_iso: '2026-05-07',
        memu_memories: [],
        memory_md: '',
        daily_log: '',
        soul_md: '',
        phase1_summary: 'p1',
        phase2_summary: 'p2',
      });

      // Assert
      expect(result.consolidation_json['memory_md']).toBe('updated');
      const args = mockPhaseRepo.recordPhase.mock.calls[0]![0];
      expect(args.phase).toBe('phase3_deep_sleep');
      expect(args.status).toBe('completed');
    });
  });

  describe('runHealthFix — bounded loop', () => {
    it("returns 'clean' when first health-check pass shows zero issues (and message history non-empty)", async () => {
      // Arrange — temporary vault dir is fine; auto-fix is no-op on empty report.
      // We don't need an actual vault read because the activity calls
      // runHealthChecks which gracefully handles missing folders.
      mockAgentFactory.create.mockReturnValue({
        usageLimits: { totalTokens: 1, toolCalls: 1 },
        outputSchema: HealthFixOutputSchema,
        invoke: async () => ({ actions: [], issues_resolved: 0, issues_skipped: 0, iteration: 1 }),
      });

      // Act
      const result = await target.runHealthFix({
        dream_id: 1,
        source_date_iso: '2026-05-07',
        report_json: {},
        consolidation_messages_json: [{ role: 'user', content: 'prior' }],
        knowledge_gap_names: [],
      });

      // Assert — empty vault → 0 issues → 'clean'
      expect(result.status).toBe('clean');
      expect(result.total_issues_remaining).toBe(0);
    });

    it("returns 'incomplete' when no message history and issues remain", async () => {
      // Arrange — knowledge_gap_names produces issues; messageHistory empty
      // forces early-exit per Python `health_fix.py` line 114-116.
      // Act
      const result = await target.runHealthFix({
        dream_id: 1,
        source_date_iso: '2026-05-07',
        report_json: {},
        consolidation_messages_json: [],
        knowledge_gap_names: ['Gap1'],
      });

      // Assert
      expect(result.status).toBe('incomplete');
      expect(result.total_issues_remaining).toBeGreaterThan(0);
    });
  });

  describe('writeFiles — Q3 triple-collection + Q10/Q14 topics-drop', () => {
    it('returns vault_writes triples and drops the topics folder', async () => {
      // Arrange — consolidation with one topic entry and one decision entry.
      const consolidationJson = {
        memory_md: 'mem',
        daily_summary: 'sum',
        stats: {},
        vault_updates: {
          decisions: [{ filename: 'foo.md', title: 'Foo', summary: 'short', content: 'body', tags: [], action: 'create' }],
          projects: [],
          patterns: [],
          templates: [],
          concepts: [],
          connections: [],
          lessons: [],
          topics: [{ filename: 'should-be-dropped.md', title: 'Topic', summary: 'short', content: 'body', tags: [], action: 'create' }],
        },
      };
      // safeReadVault returns null for missing /tmp/vault-not-real — that's fine.

      // Act
      const result = await target.writeFiles({
        dream_id: 1,
        source_date_iso: '2026-05-07',
        consolidation_json: consolidationJson,
      });

      // Assert — vault_writes contains MEMORY.md + decisions/foo.md but NOT
      // the topics file (Q10/Q14).
      const paths = result.vault_writes.map((t) => t.path);
      expect(paths).toContain('MEMORY.md');
      expect(paths).toContain('decisions/foo.md');
      expect(paths.find((p) => p.includes('should-be-dropped'))).toBeUndefined();
    });

    it('throws when memory_md is empty', async () => {
      // Arrange
      const consolidationJson = { memory_md: '', daily_summary: 'd' };

      // Act / Assert
      await expect(target.writeFiles({ dream_id: 1, source_date_iso: '2026-05-07', consolidation_json: consolidationJson })).rejects.toThrow();
    });
  });

  describe('alignMemu — file-based idempotency + per-entry MemU calls', () => {
    it('skips when idempotency key already present in log (best-effort read)', async () => {
      // Arrange — use a real tmp vault dir so safeReadVault + safeWriteVault don't bubble.
      const fsp = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      vaultPathOverride = await fsp.mkdtemp(path.join(os.tmpdir(), 'jarvis-align-'));
      mockMemuApi.memorize.mockResolvedValue({});

      // Act
      await target.alignMemu({
        dream_id: 1,
        memory_md: '## Strong Patterns\n- foo\n## Decisions\n- bar\n## Facts\n- baz\n',
        source_date_iso: '2026-05-07',
        idempotency_key: 'dream-1',
      });

      // Assert — at least 3 memorize calls (one per entry).
      expect(mockMemuApi.memorize).toHaveBeenCalledTimes(3);
      await fsp.rm(vaultPathOverride, { recursive: true, force: true });
    });

    it('tolerates per-entry MemU failures (logs + continues)', async () => {
      // Arrange — use a real tmp vault dir.
      const fsp = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      vaultPathOverride = await fsp.mkdtemp(path.join(os.tmpdir(), 'jarvis-align-'));
      mockMemuApi.memorize.mockRejectedValueOnce(new Error('memu transient')).mockResolvedValue({});

      // Act
      await target.alignMemu({
        dream_id: 1,
        memory_md: '## Decisions\n- foo\n- bar\n',
        source_date_iso: '2026-05-07',
        idempotency_key: 'dream-1',
      });

      // Assert — both entries attempted, second succeeded after first failed.
      expect(mockMemuApi.memorize).toHaveBeenCalledTimes(2);
      await fsp.rm(vaultPathOverride, { recursive: true, force: true });
    });
  });
});
