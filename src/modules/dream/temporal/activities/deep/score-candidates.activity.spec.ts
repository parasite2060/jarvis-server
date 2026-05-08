/**
 * Unit tests for `ScoreCandidatesActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ScoreCandidatesActivity } from './score-candidates.activity';
import { AppConfigService } from 'src/shared/config/config.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('ScoreCandidatesActivity', () => {
  let target: ScoreCandidatesActivity;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'scoringWeights', {
      configurable: true,
      get: () => ({ frequency: 0.25, recency: 0.25, relevance: 0.2, consistency: 0.2, breadth: 0.1 }),
    });
    Object.defineProperty(mockConfig, 'scoringDecayRate', { configurable: true, get: () => 0.03 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [ScoreCandidatesActivity, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(ScoreCandidatesActivity);
  });

  it('hard-codes days_since_reinforced=0 and in_active_project=true; rounds to 4 decimals', async () => {
    // Arrange
    const candidates = [
      { content: 'a', category: 'decisions', reinforcement_count: 5, contradiction_flag: false, source_sessions: ['s1'] },
      { content: 'b', category: 'patterns', reinforcement_count: 0, contradiction_flag: true, source_sessions: [] },
    ];

    // Act
    const result = await target.scoreCandidates({ dream_id: 1, candidates_json: candidates });

    // Assert
    expect(result.scored).toHaveLength(2);
    expect(result.scored[0]!['score']).toBeCloseTo(0.795, 4);
    expect(result.scored[1]!['score']).toBeCloseTo(0.45, 4);
  });

  it('preserves all candidate fields and adds score', async () => {
    // Arrange
    const candidate = {
      content: 'x',
      category: 'decisions',
      reinforcement_count: 2,
      contradiction_flag: false,
      source_sessions: [],
      extra: 'preserved',
    };

    // Act
    const result = await target.scoreCandidates({ dream_id: 1, candidates_json: [candidate] });

    // Assert
    expect(result.scored[0]).toMatchObject({ content: 'x', extra: 'preserved' });
    expect(result.scored[0]!['score']).toBeDefined();
  });
});
