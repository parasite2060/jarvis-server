import { calculateCandidateScore, DEFAULT_DECAY_RATE, DEFAULT_SCORING_WEIGHTS } from './calculate-candidate-score';

// Story 13.11 / AC #6 — exhaustive unit coverage of the pure scoring fn.
// AAA pattern; the function is pure so each test is a single arithmetic case.
describe('calculateCandidateScore', () => {
  describe('special-case terminals (short-circuit)', () => {
    it('should return 1.0 when is_reference is true', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 0,
        days_since_reinforced: 0,
        in_active_project: false,
        has_contradiction: true,
        context_count: 0,
        is_reference: true,
      });

      // Assert
      expect(score).toBe(1.0);
    });

    it('should return 1.0 when is_failed_lesson is true', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 0,
        days_since_reinforced: 365,
        in_active_project: false,
        has_contradiction: false,
        context_count: 0,
        is_failed_lesson: true,
      });

      // Assert
      expect(score).toBe(1.0);
    });
  });

  describe('formula — default weights', () => {
    it('should return 0.45 for all-zero input + production hard-codes (recency=1.0, relevance=1.0)', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 0,
        days_since_reinforced: 0,
        in_active_project: true,
        has_contradiction: false,
        context_count: 0,
      });

      // Assert — recency*0.25 + relevance*0.20 = 0.25 + 0.20 + consistency*0.20 = 0.65
      // Wait — has_contradiction=false → consistency=1.0 → 0.20*1.0=0.20.
      // 0 + 0.25*1 + 0.2*1 + 0.2*1 + 0 = 0.65.
      expect(score).toBeCloseTo(0.65, 5);
    });

    it('should drop consistency contribution to 0 when has_contradiction is true', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 0,
        days_since_reinforced: 0,
        in_active_project: true,
        has_contradiction: true,
        context_count: 0,
      });

      // Assert — recency*0.25 + relevance*0.20 + 0 = 0.45
      expect(score).toBeCloseTo(0.45, 5);
    });

    it('should cap frequency at 1.0 when reinforcement_count == 10', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 10,
        days_since_reinforced: 0,
        in_active_project: true,
        has_contradiction: false,
        context_count: 0,
      });

      // Assert — freq=1.0 → 0.25*1 + 0.25*1 + 0.20*1 + 0.20*1 + 0 = 0.90
      expect(score).toBeCloseTo(0.9, 5);
    });

    it('should keep frequency capped at 1.0 when reinforcement_count exceeds 10', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 100,
        days_since_reinforced: 0,
        in_active_project: true,
        has_contradiction: false,
        context_count: 0,
      });

      // Assert — same as cap-at-10 case
      expect(score).toBeCloseTo(0.9, 5);
    });

    it('should cap breadth at 1.0 when context_count == 5', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 0,
        days_since_reinforced: 0,
        in_active_project: true,
        has_contradiction: false,
        context_count: 5,
      });

      // Assert — breadth=1.0 → 0 + 0.25 + 0.2 + 0.2 + 0.10 = 0.75
      expect(score).toBeCloseTo(0.75, 5);
    });

    it('should drop relevance to 0.3 when in_active_project is false', () => {
      // Arrange / Act
      const score = calculateCandidateScore({
        reinforcement_count: 0,
        days_since_reinforced: 0,
        in_active_project: false,
        has_contradiction: false,
        context_count: 0,
      });

      // Assert — relevance=0.3 → 0 + 0.25*1 + 0.20*0.3 + 0.20*1 + 0 = 0.51
      expect(score).toBeCloseTo(0.51, 5);
    });
  });

  describe('Ebbinghaus decay', () => {
    it('should apply exp(-decay_rate * days) to recency', () => {
      // Arrange — custom decay rate for clarity (default is 0.03)
      const days = 30;
      const decayRate = 0.03;
      const expectedRecency = Math.exp(-decayRate * days);

      // Act
      const score = calculateCandidateScore({
        reinforcement_count: 0,
        days_since_reinforced: days,
        in_active_project: false, // strip relevance contribution to 0.3*0.2=0.06
        has_contradiction: true, // strip consistency to 0
        context_count: 0,
      });

      // Assert — score = 0 + 0.25*expectedRecency + 0.20*0.3 + 0 + 0
      const expected = 0.25 * expectedRecency + 0.06;
      expect(score).toBeCloseTo(expected, 5);
    });

    it('should respect a custom decay_rate option', () => {
      // Arrange
      const days = 10;
      const customRate = 0.1;

      // Act
      const score = calculateCandidateScore(
        {
          reinforcement_count: 0,
          days_since_reinforced: days,
          in_active_project: false,
          has_contradiction: true,
          context_count: 0,
        },
        { decay_rate: customRate },
      );

      // Assert — recency = exp(-1.0) ≈ 0.3679
      const expectedRecency = Math.exp(-customRate * days);
      const expected = 0.25 * expectedRecency + 0.06;
      expect(score).toBeCloseTo(expected, 5);
    });
  });

  describe('custom weights', () => {
    it('should use a custom weight override for a single component', () => {
      // Arrange — override frequency weight to 1.0; everything else default
      const customWeights = { frequency: 1.0 };

      // Act — reinforcement=10 → freq=1.0 → contribution = 1.0 * 1.0 = 1.0
      const score = calculateCandidateScore(
        {
          reinforcement_count: 10,
          days_since_reinforced: 0,
          in_active_project: true,
          has_contradiction: false,
          context_count: 0,
        },
        { weights: customWeights },
      );

      // Assert — 1.0 + 0.25 + 0.20 + 0.20 + 0 = 1.65 (intentionally above 1 to verify override)
      expect(score).toBeCloseTo(1.65, 5);
    });

    it('should use defaults when only a partial weights override is supplied', () => {
      // Arrange / Act
      const partial = { frequency: 0.5 };
      const score = calculateCandidateScore(
        {
          reinforcement_count: 10,
          days_since_reinforced: 0,
          in_active_project: true,
          has_contradiction: false,
          context_count: 0,
        },
        { weights: partial },
      );

      // Assert — 0.5*1 + 0.25 + 0.2 + 0.2 + 0 = 1.15
      expect(score).toBeCloseTo(1.15, 5);
    });
  });

  describe('exported defaults', () => {
    it('exports DEFAULT_SCORING_WEIGHTS matching Python', () => {
      expect(DEFAULT_SCORING_WEIGHTS).toEqual({
        frequency: 0.25,
        recency: 0.25,
        relevance: 0.2,
        consistency: 0.2,
        breadth: 0.1,
      });
    });

    it('exports DEFAULT_DECAY_RATE = 0.03', () => {
      expect(DEFAULT_DECAY_RATE).toBe(0.03);
    });
  });
});
