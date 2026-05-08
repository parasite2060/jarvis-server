import { LoadTranscriptActivity } from './load-transcript.activity';
import { RunExtractionActivity } from './run-extraction.activity';
import { RunRecordActivity } from './run-record.activity';
import { PersistSessionLogActivity } from './persist-session-log.activity';
import { UpdateTranscriptPositionActivity } from './update-transcript-position.activity';
import { LightInvalidateContextCacheActivity } from './invalidate-context-cache.activity';
import { LightCommitAndPrActivity } from './commit-and-pr.activity';
import { MarkDreamOutcomeActivity } from './mark-dream-outcome.activity';

export const Activities = [
  LoadTranscriptActivity,
  RunExtractionActivity,
  RunRecordActivity,
  PersistSessionLogActivity,
  UpdateTranscriptPositionActivity,
  LightInvalidateContextCacheActivity,
  LightCommitAndPrActivity,
  MarkDreamOutcomeActivity,
];
