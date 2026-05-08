import { HealthReportSchema } from './health-report.schema';

describe('HealthReportSchema', () => {
  it('accepts a full report with all 9 issue types populated', () => {
    const fixture = {
      orphan_notes: ['a.md'],
      stale_notes: ['b.md'],
      missing_frontmatter: ['c.md'],
      unresolved_contradictions: ['d.md'],
      memory_overflow: true,
      knowledge_gaps: ['e'],
      missing_backlinks: ['f → g'],
      unclassified_lessons: ['h.md'],
      broken_wikilinks: ['i.md → [[j]]'],
      total_issues: 9,
    };
    const parsed = HealthReportSchema.parse(fixture);
    expect(parsed.total_issues).toBe(9);
    expect(parsed.memory_overflow).toBe(true);
  });

  it('defaults all arrays empty + memory_overflow false + total_issues 0', () => {
    const parsed = HealthReportSchema.parse({});
    expect(parsed.orphan_notes).toEqual([]);
    expect(parsed.memory_overflow).toBe(false);
    expect(parsed.total_issues).toBe(0);
  });
});
