import { ConsolidationOutputSchema, VaultFileEntrySchema } from './consolidation-output.schema';

describe('ConsolidationOutputSchema', () => {
  it('should accept a full Phase 3 output with all 8 vault folder buckets', () => {
    const fixture = {
      memory_md: '## Strong Patterns\n- foo',
      daily_summary: 'Some text',
      stats: {
        total_memories_processed: 5,
        duplicates_removed: 1,
        contradictions_resolved: 0,
        patterns_promoted: 2,
        stale_pruned: 0,
      },
      vault_updates: {
        decisions: [{ filename: 'foo.md', title: 'Foo', summary: 'short summary', content: 'body', tags: [], action: 'create' as const }],
        projects: [],
        patterns: [],
        templates: [],
        concepts: [],
        connections: [],
        lessons: [],
        topics: [],
      },
      vault_writes: [],
    };

    const parsed = ConsolidationOutputSchema.parse(fixture);
    expect(parsed.memory_md).toBe('## Strong Patterns\n- foo');
    expect(parsed.vault_updates.decisions).toHaveLength(1);
    expect(parsed.vault_writes).toEqual([]);
  });

  it('should reject summary longer than 100 chars', () => {
    const tooLong = 'x'.repeat(101);
    expect(() => VaultFileEntrySchema.parse({ filename: 'a.md', title: 't', summary: tooLong, content: '', tags: [], action: 'create' })).toThrow();
  });

  it('should default missing fields', () => {
    const parsed = ConsolidationOutputSchema.parse({ memory_md: 'x', daily_summary: 'y' });
    expect(parsed.stats.total_memories_processed).toBe(0);
    expect(parsed.vault_updates.topics).toEqual([]);
    expect(parsed.vault_writes).toEqual([]);
  });

  it('keeps topics in the schema (Q10/Q14: drop happens at activity boundary, not schema)', () => {
    const parsed = ConsolidationOutputSchema.parse({
      memory_md: 'x',
      daily_summary: 'y',
      vault_updates: {
        decisions: [],
        projects: [],
        patterns: [],
        templates: [],
        concepts: [],
        connections: [],
        lessons: [],
        topics: [{ filename: 't.md', title: 'T', summary: 's', content: 'c', tags: [], action: 'create' }],
      },
    });
    expect(parsed.vault_updates.topics).toHaveLength(1);
  });
});
