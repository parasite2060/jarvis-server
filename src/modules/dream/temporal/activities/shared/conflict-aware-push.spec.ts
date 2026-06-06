import { conflictAwarePush } from './conflict-aware-push';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import type { GitOpsService } from 'src/shared/git/git-ops.service';
import type { AppConfigService } from 'src/shared/config/config.service';
import type { ConflictResolverHandle } from './build-conflict-resolver';
import type { ConflictResolutionAudit } from 'src/shared/git/conflict/resolve-conflict';

jest.mock('src/shared/git/read-auto-merge', () => ({
  readConflictConfig: jest.fn(),
  readAutoMergeFromVault: jest.fn(),
}));

import { readConflictConfig, readAutoMergeFromVault } from 'src/shared/git/read-auto-merge';

const mockReadConflictConfig = readConflictConfig as jest.MockedFunction<typeof readConflictConfig>;
const mockReadAutoMergeFromVault = readAutoMergeFromVault as jest.MockedFunction<typeof readAutoMergeFromVault>;

const audit: ConflictResolutionAudit = {
  path: 'dailys/2026-06-05.md',
  base: 'base',
  dream: 'dream',
  main: 'main',
  resolvedContent: 'resolved',
  reasoning: 'merged sensibly',
};

describe('conflictAwarePush', () => {
  let mockGitOps: DeepMocked<GitOpsService>;
  let mockConfig: DeepMocked<AppConfigService>;

  const makeHandle = (audits: ConflictResolutionAudit[]): ConflictResolverHandle => ({
    resolver: jest.fn(),
    audits,
  });

  beforeEach(() => {
    mockGitOps = createMock<GitOpsService>();
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'vaultPath', { configurable: true, get: () => '/vault' });
    mockReadConflictConfig.mockResolvedValue({
      aiConflictResolution: true,
      allowGlobs: ['dailys/*'],
      protectedFiles: ['MEMORY.md'],
      autoMergeResolved: false,
    });
    mockReadAutoMergeFromVault.mockResolvedValue(true);
    jest.clearAllMocks();
  });

  describe('no-audit path (no conflict resolved)', () => {
    it('pushes the branch exactly once with the resolver', async () => {
      const handle = makeHandle([]);

      await conflictAwarePush({
        gitOps: mockGitOps,
        config: mockConfig,
        branch: 'dream/light-x',
        auditCommitPrefix: 'dream(light):',
        resolverHandle: handle,
      });

      expect(mockGitOps.push).toHaveBeenCalledTimes(1);
      expect(mockGitOps.push).toHaveBeenCalledWith('dream/light-x', handle.resolver);
    });

    it('does not write or commit an audit file', async () => {
      const handle = makeHandle([]);

      await conflictAwarePush({
        gitOps: mockGitOps,
        config: mockConfig,
        branch: 'dream/light-x',
        auditCommitPrefix: 'dream(light):',
        resolverHandle: handle,
      });

      expect(mockGitOps.writeFiles).not.toHaveBeenCalled();
      expect(mockGitOps.commit).not.toHaveBeenCalled();
    });

    it('resolves autoMerge from readAutoMergeFromVault', async () => {
      const handle = makeHandle([]);

      const result = await conflictAwarePush({
        gitOps: mockGitOps,
        config: mockConfig,
        branch: 'dream/light-x',
        auditCommitPrefix: 'dream(light):',
        resolverHandle: handle,
      });

      expect(mockReadAutoMergeFromVault).toHaveBeenCalledWith('/vault');
      expect(result.autoMerge).toBe(true);
      expect(result.audits).toEqual([]);
    });
  });

  describe('audit path (conflict was AI-resolved)', () => {
    it('pushes twice — once with resolver, once for the audit commit', async () => {
      const handle = makeHandle([audit]);

      await conflictAwarePush({
        gitOps: mockGitOps,
        config: mockConfig,
        branch: 'dream/deep-2026-06-05',
        auditCommitPrefix: 'dream(deep):',
        resolverHandle: handle,
      });

      expect(mockGitOps.push).toHaveBeenCalledTimes(2);
      expect(mockGitOps.push).toHaveBeenNthCalledWith(1, 'dream/deep-2026-06-05', handle.resolver);
      expect(mockGitOps.push).toHaveBeenNthCalledWith(2, 'dream/deep-2026-06-05');
    });

    it('writes and commits the audit file with the given prefix', async () => {
      const handle = makeHandle([audit]);

      await conflictAwarePush({
        gitOps: mockGitOps,
        config: mockConfig,
        branch: 'dream/deep-2026-06-05',
        auditCommitPrefix: 'dream(deep):',
        resolverHandle: handle,
      });

      expect(mockGitOps.writeFiles).toHaveBeenCalledTimes(1);
      const commitCall = mockGitOps.commit.mock.calls[0]!;
      expect(commitCall[0]).toBe('dream(deep): conflict-resolution audit');
      expect(commitCall[1]).toEqual(['conflict_resolutions/dream-deep-2026-06-05.md']);
    });

    it('resolves autoMerge from autoMergeResolved, not readAutoMergeFromVault', async () => {
      const handle = makeHandle([audit]);

      const result = await conflictAwarePush({
        gitOps: mockGitOps,
        config: mockConfig,
        branch: 'dream/deep-2026-06-05',
        auditCommitPrefix: 'dream(deep):',
        resolverHandle: handle,
      });

      expect(result.autoMerge).toBe(false);
      expect(mockReadAutoMergeFromVault).not.toHaveBeenCalled();
      expect(result.audits).toEqual([audit]);
    });
  });
});
