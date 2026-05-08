import { ExtractionSummarySchema, MemoryItemSchema, SessionLogEntrySchema, VaultTargetSchema, emptySessionLog } from './extraction-summary.schema';

describe('extraction-summary.schema', () => {
  describe('VaultTargetSchema', () => {
    it('accepts every canonical vault target', () => {
      for (const t of ['memory', 'decisions', 'patterns', 'projects', 'templates', 'concepts', 'connections', 'lessons', 'references', 'reviews']) {
        expect(VaultTargetSchema.parse(t)).toBe(t);
      }
    });

    it('rejects unknown values', () => {
      expect(() => VaultTargetSchema.parse('unknown')).toThrow();
    });
  });

  describe('MemoryItemSchema', () => {
    it('accepts a valid memory item', () => {
      const item = {
        content: 'use TS',
        reasoning: 'better types',
        vault_target: 'decisions',
        source_date: '2026-05-08',
      };
      expect(MemoryItemSchema.parse(item)).toEqual(item);
    });

    it('rejects malformed source_date', () => {
      expect(() => MemoryItemSchema.parse({ content: 'x', vault_target: 'memory', source_date: 'not-iso' })).toThrow();
    });

    it('allows null reasoning', () => {
      const item = { content: 'x', reasoning: null, vault_target: 'memory' as const, source_date: '2026-05-08' };
      expect(MemoryItemSchema.parse(item).reasoning).toBeNull();
    });
  });

  describe('SessionLogEntrySchema', () => {
    it('applies defaults for empty log', () => {
      const result = SessionLogEntrySchema.parse({});
      expect(result).toEqual(emptySessionLog());
    });

    it('preserves snake_case keys', () => {
      const log = SessionLogEntrySchema.parse({
        context: 'test',
        key_exchanges: ['ex'],
        decisions_made: ['d'],
        memories: [{ content: 'x', vault_target: 'memory', source_date: '2026-01-01' }],
      });
      expect(log.key_exchanges).toEqual(['ex']);
      expect(log.decisions_made).toEqual(['d']);
      expect(log.memories[0]?.vault_target).toBe('memory');
    });
  });

  describe('ExtractionSummarySchema', () => {
    it('parses a valid extraction summary', () => {
      const summary = {
        summary: 'session about X',
        no_extract: false,
        session_log: emptySessionLog(),
      };
      expect(ExtractionSummarySchema.parse(summary)).toEqual(summary);
    });

    it('requires session_log key (snake_case)', () => {
      expect(() => ExtractionSummarySchema.parse({ summary: 'x', no_extract: false })).toThrow();
    });
  });

  describe('emptySessionLog', () => {
    it('returns the canonical empty shape with all 9 sections', () => {
      const log = emptySessionLog();
      expect(log).toEqual({
        context: '',
        key_exchanges: [],
        decisions_made: [],
        lessons_learned: [],
        failed_lessons: [],
        action_items: [],
        concepts: [],
        connections: [],
        memories: [],
      });
    });
  });
});
