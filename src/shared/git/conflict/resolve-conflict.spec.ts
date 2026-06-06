import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SimpleGit } from 'simple-git';
import type { DeepAgentFactoryAgent } from 'src/shared/agents/deep-agent.factory';
import type { ConflictResolutionOutputSchema } from 'src/modules/dream/agents/conflict-resolution-output.schema';
import { resolveRebaseConflict } from './resolve-conflict';

type MockAgent = DeepAgentFactoryAgent<typeof ConflictResolutionOutputSchema>;

function makeGit(stageContents: Record<string, string>): SimpleGit {
  const raw = jest.fn(async (args: string[]): Promise<string> => {
    const ref = args[1] ?? '';
    const match = /^:([123]):(.+)$/.exec(ref);
    if (!match) return '';
    const stage = match[1];
    const file = match[2] ?? '';
    const key = `${stage}:${file}`;
    return stageContents[key] ?? '';
  });
  const add = jest.fn().mockResolvedValue(undefined);
  return { raw, add } as unknown as SimpleGit;
}

function makeAgent(output: { resolvedContent: string; reasoning: string; confident: boolean }): MockAgent {
  return {
    usageLimits: { totalTokens: 10000, toolCalls: 10 },
    outputSchema: {} as typeof ConflictResolutionOutputSchema,
    invoke: jest.fn().mockResolvedValue(output),
  };
}

const BASE_CONFIG = {
  aiConflictResolution: true,
  allowGlobs: ['dailys/*', 'decisions/*'],
  protectedFiles: ['MEMORY.md', 'SOUL.md'],
  autoMergeResolved: true,
};

describe('resolveRebaseConflict', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-resolve-conflict-'));
  });

  afterEach(async () => {
    await fs.rm(vaultPath, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  describe('empty conflicted files', () => {
    it('should return resolved=false with reason no-conflicts', async () => {
      // Arrange
      const git = makeGit({});
      const agent = makeAgent({ resolvedContent: 'x', reasoning: 'r', confident: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: [],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result).toEqual({
        resolved: false,
        reason: 'no-conflicts',
        resolvedFiles: [],
        skippedFiles: [],
        audits: [],
      });
      expect(agent.invoke).not.toHaveBeenCalled();
    });
  });

  describe('protected file gate', () => {
    it('should abort and return resolved=false with reason protected-file without calling agent', async () => {
      // Arrange
      const git = makeGit({});
      const agent = makeAgent({ resolvedContent: 'x', reasoning: 'r', confident: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: ['MEMORY.md'],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('protected-file');
      expect(result.skippedFiles).toEqual(['MEMORY.md']);
      expect(agent.invoke).not.toHaveBeenCalled();
    });

    it('should abort when a protected file appears alongside an allowed file', async () => {
      // Arrange
      const git = makeGit({
        '1:dailys/note.md': 'base',
        '3:dailys/note.md': 'dream',
        '2:dailys/note.md': 'main',
      });
      const agent = makeAgent({ resolvedContent: 'resolved', reasoning: 'r', confident: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: ['SOUL.md', 'dailys/note.md'],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('protected-file');
    });

    it('should report the offending file plus the unprocessed remainder in skippedFiles', async () => {
      // Arrange
      const allowedA = 'dailys/a.md';
      const protectedB = 'SOUL.md';
      const allowedC = 'dailys/c.md';

      const git = makeGit({
        '1:dailys/a.md': 'base-a',
        '3:dailys/a.md': 'dream-a',
        '2:dailys/a.md': 'main-a',
      });
      const agent = makeAgent({ resolvedContent: 'resolved-a', reasoning: 'r', confident: true });

      await fs.mkdir(path.join(vaultPath, 'dailys'), { recursive: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: [allowedA, protectedB, allowedC],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('protected-file');
      expect(result.resolvedFiles).toEqual([allowedA]);
      expect(result.skippedFiles).toEqual([protectedB, allowedC]);
    });
  });

  describe('allowlist gate', () => {
    it('should abort and return resolved=false with reason not-allowlisted without calling agent', async () => {
      // Arrange
      const git = makeGit({});
      const agent = makeAgent({ resolvedContent: 'x', reasoning: 'r', confident: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: ['private/secret.md'],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('not-allowlisted');
      expect(result.skippedFiles).toEqual(['private/secret.md']);
      expect(agent.invoke).not.toHaveBeenCalled();
    });
  });

  describe('agent confident=true', () => {
    it('should write resolved content to disk, call git.add, and return resolved=true with audit', async () => {
      // Arrange
      const file = 'dailys/2026-06-06.md';
      const baseContent = 'base content';
      const dreamContent = 'dream content';
      const mainContent = 'main content';
      const resolvedContent = 'merged content';

      const git = makeGit({
        '1:dailys/2026-06-06.md': baseContent,
        '3:dailys/2026-06-06.md': dreamContent,
        '2:dailys/2026-06-06.md': mainContent,
      });
      const agent = makeAgent({ resolvedContent, reasoning: 'AI merged cleanly', confident: true });

      await fs.mkdir(path.join(vaultPath, 'dailys'), { recursive: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: [file],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.resolvedFiles).toEqual([file]);
      expect(result.skippedFiles).toEqual([]);
      expect(result.audits).toHaveLength(1);

      const audit = result.audits[0]!;
      expect(audit.path).toBe(file);
      expect(audit.base).toBe(baseContent);
      expect(audit.dream).toBe(dreamContent);
      expect(audit.main).toBe(mainContent);
      expect(audit.resolvedContent).toBe(resolvedContent);
      expect(audit.reasoning).toBe('AI merged cleanly');

      const writtenContent = await fs.readFile(path.join(vaultPath, file), 'utf-8');
      expect(writtenContent).toBe(resolvedContent);

      expect(git.add as jest.Mock).toHaveBeenCalledWith(file);
    });

    it('should pass a run-prompt containing BASE:, DREAM:, MAIN: headings and version content to agent.invoke', async () => {
      // Arrange
      const file = 'dailys/test.md';
      const baseContent = 'BASE_BODY';
      const dreamContent = 'DREAM_BODY';
      const mainContent = 'MAIN_BODY';

      const git = makeGit({
        '1:dailys/test.md': baseContent,
        '3:dailys/test.md': dreamContent,
        '2:dailys/test.md': mainContent,
      });
      const agent = makeAgent({ resolvedContent: 'out', reasoning: 'r', confident: true });

      await fs.mkdir(path.join(vaultPath, 'dailys'), { recursive: true });

      // Act
      await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: [file],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      const invokeArg = (agent.invoke as jest.Mock).mock.calls[0]![0] as string;
      expect(invokeArg).toContain('BASE:');
      expect(invokeArg).toContain('DREAM:');
      expect(invokeArg).toContain('MAIN:');
      expect(invokeArg).toContain(baseContent);
      expect(invokeArg).toContain(dreamContent);
      expect(invokeArg).toContain(mainContent);
    });
  });

  describe('agent confident=false', () => {
    it('should abort and return resolved=false with reason low-confidence, not writing file', async () => {
      // Arrange
      const file = 'dailys/uncertain.md';
      const git = makeGit({
        '1:dailys/uncertain.md': 'base',
        '3:dailys/uncertain.md': 'dream',
        '2:dailys/uncertain.md': 'main',
      });
      const agent = makeAgent({ resolvedContent: 'maybe', reasoning: 'not sure', confident: false });

      await fs.mkdir(path.join(vaultPath, 'dailys'), { recursive: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: [file],
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('low-confidence');
      expect(result.skippedFiles).toEqual([file]);
      expect(result.resolvedFiles).toEqual([]);

      const fileExists = await fs
        .access(path.join(vaultPath, file))
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);

      expect(git.add as jest.Mock).not.toHaveBeenCalled();
    });
  });

  describe('multiple files', () => {
    it('should resolve all files and return audits for each when all are confident', async () => {
      // Arrange
      const files = ['dailys/a.md', 'dailys/b.md', 'decisions/c.md'];

      const stageContents: Record<string, string> = {};
      for (const f of files) {
        stageContents[`1:${f}`] = `base-${f}`;
        stageContents[`3:${f}`] = `dream-${f}`;
        stageContents[`2:${f}`] = `main-${f}`;
      }

      const git = makeGit(stageContents);
      const agent: MockAgent = {
        usageLimits: { totalTokens: 10000, toolCalls: 10 },
        outputSchema: {} as typeof ConflictResolutionOutputSchema,
        invoke: jest.fn().mockImplementation(async (prompt: string) => ({
          resolvedContent: `resolved-for-${prompt.length}`,
          reasoning: 'confident merge',
          confident: true,
        })),
      };

      await fs.mkdir(path.join(vaultPath, 'dailys'), { recursive: true });
      await fs.mkdir(path.join(vaultPath, 'decisions'), { recursive: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: files,
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.resolvedFiles).toEqual(files);
      expect(result.skippedFiles).toEqual([]);
      expect(result.audits).toHaveLength(3);
      expect(agent.invoke).toHaveBeenCalledTimes(3);
    });

    it('should abort on first low-confidence file and not process remaining files', async () => {
      // Arrange
      const files = ['dailys/first.md', 'dailys/second.md'];

      const git = makeGit({
        '1:dailys/first.md': 'base',
        '3:dailys/first.md': 'dream',
        '2:dailys/first.md': 'main',
      });

      const agent: MockAgent = {
        usageLimits: { totalTokens: 10000, toolCalls: 10 },
        outputSchema: {} as typeof ConflictResolutionOutputSchema,
        invoke: jest.fn().mockResolvedValue({ resolvedContent: 'out', reasoning: 'unsure', confident: false }),
      };

      await fs.mkdir(path.join(vaultPath, 'dailys'), { recursive: true });

      // Act
      const result = await resolveRebaseConflict({
        git,
        vaultPath,
        conflictedFiles: files,
        agent,
        config: BASE_CONFIG,
      });

      // Assert
      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('low-confidence');
      expect(agent.invoke).toHaveBeenCalledTimes(1);
    });
  });
});
