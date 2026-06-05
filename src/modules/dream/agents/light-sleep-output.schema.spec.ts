import { LightSleepOutputSchema, ScoredCandidateSchema } from './light-sleep-output.schema';

// Story 13.11 / AC #1 — round-trip parsing of fixture JSON; reject malformed.
describe('LightSleepOutputSchema', () => {
  it('should accept a valid Phase 1 output with snake_case keys', () => {
    // Arrange
    const fixture = {
      candidates: [
        { content: 'Use strict TS', category: 'decisions', reinforcement_count: 5, contradiction_flag: false, source_sessions: ['s1', 's2'] },
      ],
      duplicates_removed: 2,
      contradictions_found: 1,
    };

    // Act
    const parsed = LightSleepOutputSchema.parse(fixture);

    // Assert
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]!.reinforcement_count).toBe(5);
  });

  it('should default missing fields to safe values', () => {
    // Arrange / Act — every field optional except content + category
    const parsed = LightSleepOutputSchema.parse({});

    // Assert
    expect(parsed.candidates).toEqual([]);
    expect(parsed.duplicates_removed).toBe(0);
    expect(parsed.contradictions_found).toBe(0);
  });

  it('should reject negative reinforcement_count', () => {
    // Arrange
    const bad = {
      candidates: [{ content: 'x', category: 'y', reinforcement_count: -1, contradiction_flag: false, source_sessions: [] }],
    };

    // Act / Assert
    expect(() => LightSleepOutputSchema.parse(bad)).toThrow();
  });
});

describe('ScoredCandidateSchema', () => {
  it('should accept a candidate with default reinforcement_count and source_sessions', () => {
    // Arrange / Act
    const parsed = ScoredCandidateSchema.parse({ content: 'x', category: 'patterns' });

    // Assert
    expect(parsed.reinforcement_count).toBe(0);
    expect(parsed.contradiction_flag).toBe(false);
    expect(parsed.source_sessions).toEqual([]);
  });
});
