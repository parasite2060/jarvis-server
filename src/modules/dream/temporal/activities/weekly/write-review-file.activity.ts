import { Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { weekIso as computeWeekIso } from '../../workflows/iso-week';
import type { WriteReviewInput, WriteReviewResult } from '../../workflows/weekly-review.workflow';
import { buildReviewFrontmatter } from './helpers';

@Injectable()
export class WriteReviewFileActivity {
  private readonly logger = new Logger(WriteReviewFileActivity.name);

  @TemporalActivity('weekly.write_review_file')
  async writeReviewFile(inp: WriteReviewInput): Promise<WriteReviewResult> {
    try {
      const weekIso = computeWeekIso(inp.week_start);
      const reviewPath = `reviews/${weekIso}.md`;
      const frontmatter = buildReviewFrontmatter(inp.week_start, weekIso);
      const fullContent = frontmatter + inp.review_content;

      this.logger.log({
        message: 'weekly review write_review_file completed',
        event: 'weeklyReview.writeReviewFile.completed',
        dreamId: inp.dream_id,
        reviewPath,
      });

      return {
        review_path: reviewPath,
        files_modified: [{ path: reviewPath, action: 'create' }],
        vault_writes: [{ path: reviewPath, content: fullContent, action: 'create' }],
      };
    } catch (err) {
      if (err instanceof InternalException) throw err;
      throw new InternalException(ErrorCode.WEEKLY_REVIEW_WRITE_FILE_FAILED, `writeReviewFile failed: ${(err as Error).message}`);
    }
  }
}
