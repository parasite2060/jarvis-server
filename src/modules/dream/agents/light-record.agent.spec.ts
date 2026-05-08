/**
 * Unit specs for `buildLightRecordAgent` (Story 13.10 / Adjustment 1).
 *
 * Verifies the three record-tools' side effects via direct closure inspection:
 *   - `writeFile` glob-restricts to `dailys/*.md` (Q12 + FR45).
 *   - `writeFile` collects `(path, content, action: 'create')` triples.
 *   - `updateReinforcement` reads frontmatter, increments count, collects 'update' triple.
 *   - `flagContradiction` sets has_contradiction + contradiction_reason in frontmatter.
 *
 * The agent-build call is mocked at the factory level (no real `createDeepAgent`).
 */
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildLightRecordAgent, type RecordDeps } from './light-record.agent';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { readFileTool } from './tools/vault-tools';
import { createMock as cm } from '@golevelup/ts-jest';
import type { IMemuApi } from 'src/shared/domain/apis/memu-api.interface';

interface CapturedToolDef {
  name: string;
  func: (input: Record<string, unknown>) => Promise<string>;
}

describe('buildLightRecordAgent', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;
  let capturedTools: CapturedToolDef[];
  let deps: RecordDeps;
  let vaultRoot: string;

  beforeEach(() => {
    // Arrange — temp vault for updateReinforcement/flagContradiction reads.
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'record-agent-spec-'));

    capturedTools = [];
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockImplementation((opts) => {
      // Capture the tools passed to the factory.create call.
      capturedTools = (opts.tools as unknown as Array<{ name: string; func: (input: Record<string, unknown>) => Promise<string> }>).map((t) => ({
        name: t.name,
        func: t.func,
      }));
      return {
        usageLimits: opts.usageLimits,
        outputSchema: opts.output,
        invoke: jest.fn().mockResolvedValue({ files: [], summary: '' }),
      };
    });

    deps = {
      session_id: 'sess-1',
      recordOutput: { session_log_writes: [] },
      today_iso: '2026-05-08',
    };
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  function getTool(name: string): (input: Record<string, unknown>) => Promise<string> {
    const tool = capturedTools.find((t) => t.name === name);
    if (tool === undefined) throw new Error(`Tool '${name}' not found in capturedTools`);
    return tool.func;
  }

  function buildBaseToolFactories(): NonNullable<Parameters<typeof buildLightRecordAgent>[1]['baseToolFactories']> {
    const memu = cm<IMemuApi>();
    return {
      readFile: (input) => readFileTool({ vaultPath: vaultRoot, memuApi: memu }, input),
      grep: async () => '(no matches)',
      listFiles: async () => '(empty directory)',
      fileInfo: async () => 'path=x lines=0 chars=0 estimated_tokens=0',
      readFrontmatter: async () => '(no frontmatter)',
      memuSearch: async () => '[]',
      memuCategories: async () => '[]',
    };
  }

  describe('writeFile glob restriction (Q12 + FR45)', () => {
    it('queues (path, content, action: create) triple when path matches dailys/*.md', async () => {
      // Arrange
      buildLightRecordAgent(mockFactory, {
        systemPrompt: 'PROMPT',
        deps,
        baseToolFactories: buildBaseToolFactories(),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });
      const writeFile = getTool('writeFile');

      // Act
      const result = await writeFile({ path: 'dailys/2026-05-08.md', content: 'session log' });

      // Assert
      expect(result).toMatch(/^Queued write of dailys\/2026-05-08\.md/);
      expect(deps.recordOutput.session_log_writes).toEqual([{ path: 'dailys/2026-05-08.md', content: 'session log', action: 'create' }]);
    });

    it('rejects out-of-glob paths with Error string', async () => {
      // Arrange
      buildLightRecordAgent(mockFactory, {
        systemPrompt: 'PROMPT',
        deps,
        baseToolFactories: buildBaseToolFactories(),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });
      const writeFile = getTool('writeFile');

      // Act
      const result = await writeFile({ path: 'decisions/foo.md', content: 'x' });

      // Assert
      expect(result).toMatch(/^Error: path 'decisions\/foo\.md' not allowed/);
      expect(deps.recordOutput.session_log_writes).toHaveLength(0);
    });

    it('respects custom allowedPatterns when provided', async () => {
      // Arrange
      buildLightRecordAgent(mockFactory, {
        systemPrompt: 'PROMPT',
        deps,
        baseToolFactories: buildBaseToolFactories(),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
        allowedPatterns: ['custom/*.md'],
      });
      const writeFile = getTool('writeFile');

      // Act
      const allowed = await writeFile({ path: 'custom/file.md', content: 'x' });
      const denied = await writeFile({ path: 'dailys/2026-05-08.md', content: 'x' });

      // Assert
      expect(allowed).toMatch(/^Queued write/);
      expect(denied).toMatch(/^Error/);
    });
  });

  describe('updateReinforcement frontmatter mutation', () => {
    it('reads file, increments reinforcement_count, sets last_reinforced, queues update triple', async () => {
      // Arrange
      const target = 'decisions/example.md';
      await fsp.mkdir(path.join(vaultRoot, 'decisions'));
      await fsp.writeFile(
        path.join(vaultRoot, target),
        '---\ntitle: Example\nreinforcement_count: 2\nlast_reinforced: 2026-04-01\n---\nbody content',
      );
      buildLightRecordAgent(mockFactory, {
        systemPrompt: 'PROMPT',
        deps,
        baseToolFactories: buildBaseToolFactories(),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });
      const updateReinforcement = getTool('updateReinforcement');

      // Act
      const result = await updateReinforcement({ filePath: target });

      // Assert
      expect(result).toMatch(/^Queued reinforcement update/);
      expect(deps.recordOutput.session_log_writes).toHaveLength(1);
      const triple = deps.recordOutput.session_log_writes[0];
      expect(triple?.action).toBe('update');
      expect(triple?.path).toBe(target);
      expect(triple?.content).toContain('reinforcement_count: 3');
      expect(triple?.content).toContain('last_reinforced: 2026-05-08');
      expect(triple?.content).toContain('body content');
    });

    it('returns Error string when file has no frontmatter', async () => {
      // Arrange
      await fsp.writeFile(path.join(vaultRoot, 'plain.md'), 'no frontmatter here');
      buildLightRecordAgent(mockFactory, {
        systemPrompt: 'PROMPT',
        deps,
        baseToolFactories: buildBaseToolFactories(),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });
      const updateReinforcement = getTool('updateReinforcement');

      // Act
      const result = await updateReinforcement({ filePath: 'plain.md' });

      // Assert
      expect(result).toMatch(/^Error: 'plain\.md' has no YAML frontmatter/);
      expect(deps.recordOutput.session_log_writes).toHaveLength(0);
    });
  });

  describe('flagContradiction frontmatter mutation', () => {
    it('sets has_contradiction true and contradiction_reason, queues update triple', async () => {
      // Arrange
      await fsp.mkdir(path.join(vaultRoot, 'patterns'));
      await fsp.writeFile(path.join(vaultRoot, 'patterns/example.md'), '---\ntitle: x\n---\nbody');
      buildLightRecordAgent(mockFactory, {
        systemPrompt: 'PROMPT',
        deps,
        baseToolFactories: buildBaseToolFactories(),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });
      const flagContradiction = getTool('flagContradiction');

      // Act
      const result = await flagContradiction({ filePath: 'patterns/example.md', reason: 'session conflicts with this' });

      // Assert
      expect(result).toMatch(/^Flagged contradiction on patterns\/example\.md/);
      const triple = deps.recordOutput.session_log_writes[0];
      expect(triple?.action).toBe('update');
      expect(triple?.content).toContain('has_contradiction: true');
      expect(triple?.content).toContain('contradiction_reason: session conflicts with this');
    });
  });
});
