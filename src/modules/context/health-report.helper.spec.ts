import { Logger } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { formatHealthSummary, getLatestHealthReport } from './health-report.helper';

function makeDream(overrides: Partial<Dream> = {}): Dream {
  return new Dream({
    id: 1,
    type: 'deep',
    trigger: 'cron',
    status: 'completed',
    outputRaw: null,
    createdAt: new Date('2026-05-08T00:00:00.000Z'),
    completedAt: new Date('2026-05-08T00:00:01.000Z'),
    ...overrides,
  });
}

describe('getLatestHealthReport', () => {
  let mockDreamRepo: DeepMocked<IDreamRepository>;
  let mockLogger: DeepMocked<Logger>;

  beforeEach(() => {
    mockDreamRepo = createMock<IDreamRepository>();
    mockLogger = createMock<Logger>();
  });

  it('returns null when no completed deep dream exists', async () => {
    // Arrange
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(null);

    // Act
    const result = await getLatestHealthReport(mockDreamRepo, mockLogger);

    // Assert
    expect(result).toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns null when dream has no outputRaw', async () => {
    // Arrange
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(makeDream({ outputRaw: null }));

    // Act
    const result = await getLatestHealthReport(mockDreamRepo, mockLogger);

    // Assert
    expect(result).toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns null when outputRaw lacks health_report= marker', async () => {
    // Arrange
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(makeDream({ outputRaw: 'no marker here' }));

    // Act
    const result = await getLatestHealthReport(mockDreamRepo, mockLogger);

    // Assert
    expect(result).toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns parsed HealthReport on valid embedded JSON', async () => {
    // Arrange
    const json = JSON.stringify({ orphan_notes: ['a', 'b'], memory_overflow: true });
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(makeDream({ outputRaw: `prefix health_report=${json} suffix` }));

    // Act
    const result = await getLatestHealthReport(mockDreamRepo, mockLogger);

    // Assert
    expect(result?.orphan_notes).toEqual(['a', 'b']);
    expect(result?.memory_overflow).toBe(true);
    // Defaults applied for absent fields
    expect(result?.stale_notes).toEqual([]);
    expect(result?.knowledge_gaps).toEqual([]);
  });

  it('soft-fails on malformed JSON inside matched braces — logs context.healthReport.failed and returns null', async () => {
    // Arrange — regex `\{.*\}` matches braces, but JSON.parse throws on the body.
    mockDreamRepo.findLatestCompletedDeep.mockResolvedValue(makeDream({ outputRaw: 'health_report={not, valid, json}' }));

    // Act
    const result = await getLatestHealthReport(mockDreamRepo, mockLogger);

    // Assert
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.healthReport.failed' }));
  });

  it('soft-fails on repo throw — logs and returns null', async () => {
    // Arrange
    mockDreamRepo.findLatestCompletedDeep.mockRejectedValue(new Error('db down'));

    // Act
    const result = await getLatestHealthReport(mockDreamRepo, mockLogger);

    // Assert
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'context.healthReport.failed' }));
  });
});

describe('formatHealthSummary', () => {
  function emptyReport(): ReturnType<typeof JSON.parse> {
    return {
      orphan_notes: [],
      stale_notes: [],
      missing_frontmatter: [],
      unresolved_contradictions: [],
      memory_overflow: false,
      knowledge_gaps: [],
      missing_backlinks: [],
      unclassified_lessons: [],
      broken_wikilinks: [],
      total_issues: 0,
    };
  }

  it('returns empty string when no issues', () => {
    // Act / Assert
    expect(formatHealthSummary(emptyReport())).toBe('');
  });

  it('formats orphan notes count', () => {
    // Arrange
    const r = emptyReport();
    r.orphan_notes = ['a', 'b', 'c'];

    // Act
    const result = formatHealthSummary(r);

    // Assert
    expect(result).toBe('⚠ Vault health: 3 orphan notes');
  });

  it('formats memory overflow flag with literal text', () => {
    // Arrange
    const r = emptyReport();
    r.memory_overflow = true;

    // Act
    const result = formatHealthSummary(r);

    // Assert
    expect(result).toBe('⚠ Vault health: MEMORY.md approaching overflow');
  });

  it('joins multiple issues with ", " in the documented order', () => {
    // Arrange — orphan, stale, contradictions, frontmatter, memory_overflow, knowledge_gaps.
    const r = emptyReport();
    r.orphan_notes = ['a'];
    r.stale_notes = ['b', 'c'];
    r.unresolved_contradictions = ['d'];
    r.missing_frontmatter = ['e', 'f'];
    r.memory_overflow = true;
    r.knowledge_gaps = ['g'];

    // Act
    const result = formatHealthSummary(r);

    // Assert
    expect(result).toBe(
      '⚠ Vault health: 1 orphan notes, 2 stale notes, 1 unresolved contradictions, 2 missing frontmatter, MEMORY.md approaching overflow, 1 knowledge gaps',
    );
  });
});
