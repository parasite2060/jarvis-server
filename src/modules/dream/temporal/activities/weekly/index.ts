import { GatherDailysActivity } from './gather-dailys.activity';
import { GatherIndexesActivity } from './gather-indexes.activity';
import { RunWeeklyReviewAgentActivity } from './run-weekly-review-agent.activity';
import { WriteReviewFileActivity } from './write-review-file.activity';
import { WeeklyCommitAndPrActivity } from './commit-and-pr.activity';
import { WeeklyInvalidateContextCacheActivity } from './invalidate-context-cache.activity';
import { MarkWeeklyReviewOutcomeActivity } from './mark-weekly-review-outcome.activity';

export const Activities = [
  GatherDailysActivity,
  GatherIndexesActivity,
  RunWeeklyReviewAgentActivity,
  WriteReviewFileActivity,
  WeeklyCommitAndPrActivity,
  WeeklyInvalidateContextCacheActivity,
  MarkWeeklyReviewOutcomeActivity,
];
