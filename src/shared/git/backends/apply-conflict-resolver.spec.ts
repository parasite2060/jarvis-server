/**
 * Unit specs for `applyConflictResolverOrThrow`.
 *
 * Shared rebase-conflict handling used by both git backends. Uses a fake
 * SimpleGit (jest.fn for raw/rebase) — no real git binary.
 */
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import type { SimpleGit } from 'simple-git';
import { GitOpsRebaseConflictError } from '../errors';
import { applyConflictResolverOrThrow } from './apply-conflict-resolver';
import type { ConflictResolver } from '../git-ops.types';

const BRANCH = 'dream/conflict';
const CONFLICTED_FILES = ['MEMORY.md'];

describe('applyConflictResolverOrThrow', () => {
  let mockGit: DeepMocked<SimpleGit>;

  beforeEach(() => {
    mockGit = createMock<SimpleGit>();
  });

  afterEach(() => jest.clearAllMocks());

  it('should run editor-less rebase --continue and not abort when resolver resolves all conflicts', async () => {
    // Arrange
    const resolver: ConflictResolver = jest.fn().mockResolvedValueOnce({ resolved: true });

    // Act
    await expect(applyConflictResolverOrThrow(mockGit, BRANCH, CONFLICTED_FILES, resolver)).resolves.toBeUndefined();

    // Assert
    expect(mockGit.raw).toHaveBeenCalledWith(['-c', 'core.editor=true', 'rebase', '--continue']);
    expect(mockGit.rebase).not.toHaveBeenCalledWith(['--abort']);
    expect(resolver).toHaveBeenCalledWith(CONFLICTED_FILES);
  });

  it('should abort rebase and throw GitOpsRebaseConflictError when rebase --continue itself throws', async () => {
    // Arrange — resolver claims success but git still reports unresolved conflicts on continue.
    const resolver: ConflictResolver = jest.fn().mockResolvedValueOnce({ resolved: true });
    mockGit.raw.mockRejectedValueOnce(Object.assign(new Error('You must edit all merge conflicts'), { name: 'GitError' }));

    // Act & Assert
    await expect(applyConflictResolverOrThrow(mockGit, BRANCH, CONFLICTED_FILES, resolver)).rejects.toBeInstanceOf(GitOpsRebaseConflictError);
    expect(mockGit.rebase).toHaveBeenCalledWith(['--abort']);
  });

  it('should abort rebase and throw GitOpsRebaseConflictError when resolver returns resolved=false', async () => {
    // Arrange
    const resolver: ConflictResolver = jest.fn().mockResolvedValueOnce({ resolved: false });

    // Act & Assert
    await expect(applyConflictResolverOrThrow(mockGit, BRANCH, CONFLICTED_FILES, resolver)).rejects.toBeInstanceOf(GitOpsRebaseConflictError);
    expect(mockGit.rebase).toHaveBeenCalledWith(['--abort']);
    expect(mockGit.raw).not.toHaveBeenCalled();
  });

  it('should abort rebase and throw GitOpsRebaseConflictError when no resolver is provided', async () => {
    // Act & Assert
    await expect(applyConflictResolverOrThrow(mockGit, BRANCH, CONFLICTED_FILES, undefined)).rejects.toBeInstanceOf(GitOpsRebaseConflictError);
    expect(mockGit.rebase).toHaveBeenCalledWith(['--abort']);
    expect(mockGit.raw).not.toHaveBeenCalled();
  });
});
