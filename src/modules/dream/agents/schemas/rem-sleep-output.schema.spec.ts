import { REMSleepOutputSchema, ALLOWED_RELATIONSHIP_TYPES } from './rem-sleep-output.schema';

describe('REMSleepOutputSchema', () => {
  it('should accept a full Phase 2 output', () => {
    // Arrange
    const fixture = {
      themes: [{ topic: 't1', session_count: 3, evidence: ['e'] }],
      new_connections: [{ concept_a: 'a', concept_b: 'b', relationship: 'r', relationship_type: 'supports', evidence_sessions: ['s'] }],
      promotion_candidates: [{ source_file: 'lessons/x.md', target_folder: 'patterns', reason: 'reinforced' }],
      gaps: [{ concept: 'X', mentioned_in_files: ['a.md', 'b.md'] }],
    };

    // Act
    const parsed = REMSleepOutputSchema.parse(fixture);

    // Assert
    expect(parsed.themes).toHaveLength(1);
    expect(parsed.gaps[0]!.concept).toBe('X');
  });

  it('should default empty arrays', () => {
    const parsed = REMSleepOutputSchema.parse({});
    expect(parsed.themes).toEqual([]);
    expect(parsed.gaps).toEqual([]);
  });

  it('exposes ALLOWED_RELATIONSHIP_TYPES with all 7 Python literals', () => {
    expect(ALLOWED_RELATIONSHIP_TYPES).toEqual(['extends', 'contradicts', 'supports', 'inspired_by', 'supersedes', 'derived_from', 'addresses_gap']);
  });

  it('allows relationship_type defaults to "supports"', () => {
    const parsed = REMSleepOutputSchema.parse({
      new_connections: [{ concept_a: 'a', concept_b: 'b', relationship: 'r' }],
    });
    expect(parsed.new_connections[0]!.relationship_type).toBe('supports');
  });
});
