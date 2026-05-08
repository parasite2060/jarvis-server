import { HealthFixOutputSchema, HealthFixActionSchema } from './health-fix-output.schema';

describe('HealthFixOutputSchema', () => {
  it('accepts a valid output with one action', () => {
    const fixture = {
      actions: [{ issue_type: 'unresolved_contradiction', target_file: 'decisions/foo.md', action_taken: 'resolved_contradiction', reason: '' }],
      issues_resolved: 1,
      issues_skipped: 0,
      iteration: 2,
    };
    const parsed = HealthFixOutputSchema.parse(fixture);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.iteration).toBe(2);
  });

  it('rejects unknown issue_type', () => {
    expect(() => HealthFixActionSchema.parse({ issue_type: 'invalid_issue', target_file: 'x.md', action_taken: 'skipped' })).toThrow();
  });

  it('rejects unknown action_taken', () => {
    expect(() => HealthFixActionSchema.parse({ issue_type: 'knowledge_gap', target_file: 'x.md', action_taken: 'unknown_action' })).toThrow();
  });

  it('defaults to empty actions + 0 counts + iteration 1', () => {
    const parsed = HealthFixOutputSchema.parse({});
    expect(parsed.actions).toEqual([]);
    expect(parsed.iteration).toBe(1);
  });
});
