/**
 * Unit tests for `WriteReviewFileActivity` (Story 13.10.5 / Q4 decomposition).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { WriteReviewFileActivity } from './write-review-file.activity';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('WriteReviewFileActivity', () => {
  let target: WriteReviewFileActivity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WriteReviewFileActivity],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(WriteReviewFileActivity);
  });

  it('returns triple with frontmatter + body, no disk write', async () => {
    // Act
    const result = await target.writeReviewFile({
      dream_id: 8,
      week_start: '2026-05-04',
      review_content: '# Weekly Review: 2026-W19\n\nbody',
    });

    // Assert
    expect(result.review_path).toBe('reviews/2026-W19.md');
    expect(result.files_modified).toEqual([{ path: 'reviews/2026-W19.md', action: 'create' }]);
    expect(result.vault_writes).toHaveLength(1);
    expect(result.vault_writes[0]!.path).toBe('reviews/2026-W19.md');
    expect(result.vault_writes[0]!.content).toContain('---\ntype: review\ntags: [review, weekly]\ncreated: 2026-05-04\nweek: 2026-W19\n---\n');
    expect(result.vault_writes[0]!.content).toContain('# Weekly Review: 2026-W19\n\nbody');
    expect(result.vault_writes[0]!.action).toBe('create');
  });
});
