/**
 * Unit specs for `buildLightExtractionAgent` (Story 13.10 / Adjustment 1).
 *
 * Verifies each of the 8 store-tools mutates `deps.session_*` correctly.
 * The factory is mocked at `DeepAgentFactory.create`; the captured tool
 * funcs are invoked directly with structured input.
 */
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { buildLightExtractionAgent, type DreamDeps } from './light-extraction.agent';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';

interface CapturedTool {
  name: string;
  func: (input: Record<string, unknown>) => Promise<string>;
}

describe('buildLightExtractionAgent — store tools', () => {
  let mockFactory: DeepMocked<DeepAgentFactory>;
  let capturedTools: CapturedTool[];
  let deps: DreamDeps;

  beforeEach(() => {
    capturedTools = [];
    mockFactory = createMock<DeepAgentFactory>();
    mockFactory.create.mockImplementation((opts) => {
      capturedTools = (opts.tools as unknown as Array<{ name: string; func: (input: Record<string, unknown>) => Promise<string> }>).map((t) => ({
        name: t.name,
        func: t.func,
      }));
      return {
        usageLimits: opts.usageLimits,
        outputSchema: opts.output,
        invoke: jest.fn(),
      };
    });

    deps = {
      session_id: 'sess-1',
      session_context: '',
      session_decisions: [],
      session_lessons: [],
      session_failed_lessons: [],
      session_action_items: [],
      session_key_exchanges: [],
      session_concepts: [],
      session_connections: [],
      memories: [],
      today_iso: '2026-05-08',
    };

    buildLightExtractionAgent(mockFactory, {
      systemPrompt: 'PROMPT',
      deps,
      baseToolFactories: {
        readFile: async () => '',
        grep: async () => '',
        listFiles: async () => '',
        fileInfo: async () => '',
        readFrontmatter: async () => '',
        memuSearch: async () => '',
        memuCategories: async () => '',
      },
      usageLimits: { totalTokens: 1, toolCalls: 1 },
    });
  });

  function getTool(name: string): (input: Record<string, unknown>) => Promise<string> {
    const tool = capturedTools.find((t) => t.name === name);
    if (tool === undefined) throw new Error(`Tool '${name}' not found`);
    return tool.func;
  }

  it('exposes all 7 base + 8 store tools (15 total)', () => {
    expect(capturedTools.map((t) => t.name).sort()).toEqual([
      'fileInfo',
      'grep',
      'listFiles',
      'memuCategories',
      'memuSearch',
      'readFile',
      'readFrontmatter',
      'storeActionItem',
      'storeConcept',
      'storeConnection',
      'storeContext',
      'storeDecision',
      'storeKeyExchange',
      'storeLesson',
      'storeSessionMemory',
    ]);
  });

  it('storeContext mutates deps.session_context', async () => {
    await getTool('storeContext')({ content: 'test session about migration' });
    expect(deps.session_context).toBe('test session about migration');
  });

  it('storeDecision appends to session_decisions AND adds memory item with vault_target=decisions', async () => {
    await getTool('storeDecision')({ decision: 'Use TS', reasoning: 'better types' });
    expect(deps.session_decisions).toEqual(['Use TS — better types']);
    expect(deps.memories).toHaveLength(1);
    expect(deps.memories[0]?.vault_target).toBe('decisions');
    expect(deps.memories[0]?.source_date).toBe('2026-05-08');
  });

  it('storeLesson with outcome=failed adds failed_lesson dict', async () => {
    await getTool('storeLesson')({ lesson: 'Tried X', outcome: 'failed', failureReason: 'Y broke Z' });
    expect(deps.session_lessons).toEqual(['Tried X']);
    expect(deps.session_failed_lessons).toHaveLength(1);
    expect(deps.session_failed_lessons[0]?.['failure_reason']).toBe('Y broke Z');
  });

  it('storeLesson without outcome only appends to session_lessons', async () => {
    await getTool('storeLesson')({ lesson: 'Worked OK' });
    expect(deps.session_lessons).toEqual(['Worked OK']);
    expect(deps.session_failed_lessons).toHaveLength(0);
  });

  it('storeActionItem appends', async () => {
    await getTool('storeActionItem')({ action: 'Wire 13.11' });
    expect(deps.session_action_items).toEqual(['Wire 13.11']);
  });

  it('storeKeyExchange appends', async () => {
    await getTool('storeKeyExchange')({ exchange: 'Q&A about Temporal' });
    expect(deps.session_key_exchanges).toEqual(['Q&A about Temporal']);
  });

  it('storeConcept appends to session_concepts AND adds memory with vault_target=concepts', async () => {
    await getTool('storeConcept')({ name: 'Clean Architecture', description: 'separation of concerns' });
    expect(deps.session_concepts).toEqual([{ name: 'Clean Architecture', description: 'separation of concerns' }]);
    expect(deps.memories).toHaveLength(1);
    expect(deps.memories[0]?.vault_target).toBe('concepts');
  });

  it('storeConnection appends to session_connections AND adds memory with vault_target=connections', async () => {
    await getTool('storeConnection')({
      conceptA: 'A',
      conceptB: 'B',
      relationship: 'A supports B',
      relationshipType: 'supports',
    });
    expect(deps.session_connections).toEqual([{ concept_a: 'A', concept_b: 'B', relationship: 'A supports B', relationship_type: 'supports' }]);
    expect(deps.memories[0]?.vault_target).toBe('connections');
  });

  it('storeSessionMemory appends MemoryItem with caller-provided fields', async () => {
    await getTool('storeSessionMemory')({
      category: 'patterns',
      content: 'Always run migrations before dev server',
      vaultTarget: 'patterns',
      sourceDate: '2026-05-08',
      reasoning: 'avoid stale schema errors',
    });
    expect(deps.memories).toHaveLength(1);
    expect(deps.memories[0]?.content).toContain('Always run migrations');
    expect(deps.memories[0]?.vault_target).toBe('patterns');
    expect(deps.memories[0]?.reasoning).toBe('avoid stale schema errors');
  });
});
