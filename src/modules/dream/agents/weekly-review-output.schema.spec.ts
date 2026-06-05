import { WeeklyReviewOutputSchema } from './weekly-review-output.schema';

describe('WeeklyReviewOutputSchema', () => {
  it('parses a fully-populated payload (snake_case round-trip)', () => {
    const input = {
      review_content: '# Weekly Review: 2026-W19\n\n## Week Summary\nAll good.',
      week_themes: ['auth', 'realtime'],
      stale_action_items: ['Set up email templates'],
      project_updates: { TaskFlow: 'auth shipped', Jarvis: 'epic 13 ongoing' },
    };
    const parsed = WeeklyReviewOutputSchema.parse(input);
    expect(parsed.review_content).toBe(input.review_content);
    expect(parsed.week_themes).toEqual(['auth', 'realtime']);
    expect(parsed.stale_action_items).toEqual(['Set up email templates']);
    expect(parsed.project_updates).toEqual({ TaskFlow: 'auth shipped', Jarvis: 'epic 13 ongoing' });
  });

  it('applies defaults for omitted fields', () => {
    const parsed = WeeklyReviewOutputSchema.parse({});
    expect(parsed.review_content).toBe('');
    expect(parsed.week_themes).toEqual([]);
    expect(parsed.stale_action_items).toEqual([]);
    expect(parsed.project_updates).toEqual({});
  });

  it('rejects non-string review_content', () => {
    expect(() => WeeklyReviewOutputSchema.parse({ review_content: 123 })).toThrow();
  });

  it('rejects non-string-array week_themes', () => {
    expect(() => WeeklyReviewOutputSchema.parse({ week_themes: [1, 2] })).toThrow();
  });

  it('rejects non-string-keyed project_updates', () => {
    expect(() => WeeklyReviewOutputSchema.parse({ project_updates: { foo: 42 } })).toThrow();
  });
});
