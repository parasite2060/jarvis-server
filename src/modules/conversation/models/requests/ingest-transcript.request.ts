import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ErrorCode } from 'src/utils/error.code';

/**
 * POST /conversations request body.
 *
 * Wire format: camelCase keys (the plugin's `worker/conversation-drain.js`
 * sends `sessionId`, `segmentStartLine`, `segmentEndLine`). Python's Pydantic
 * model accepts both camelCase aliases and snake_case names; for TS we accept
 * the camelCase form the plugin actually sends.
 */
export class IngestTranscriptRequest {
  @IsNotEmpty({ context: { code: ErrorCode.CONVERSATION_SESSION_ID_INVALID, message: 'sessionId is required' } })
  @IsString({ context: { code: ErrorCode.CONVERSATION_SESSION_ID_INVALID, message: 'sessionId must be string' } })
  sessionId!: string;

  @IsNotEmpty({ context: { code: ErrorCode.CONVERSATION_TRANSCRIPT_INVALID, message: 'transcript is required' } })
  @IsString({ context: { code: ErrorCode.CONVERSATION_TRANSCRIPT_INVALID, message: 'transcript must be string' } })
  transcript!: string;

  @IsNotEmpty({ context: { code: ErrorCode.CONVERSATION_SOURCE_INVALID, message: 'source is required' } })
  @IsString({ context: { code: ErrorCode.CONVERSATION_SOURCE_INVALID, message: 'source must be string' } })
  source!: string;

  @IsOptional()
  @IsInt({ context: { code: ErrorCode.CONVERSATION_SEGMENT_START_INVALID, message: 'segmentStartLine must be integer' } })
  @Min(0, { context: { code: ErrorCode.CONVERSATION_SEGMENT_START_INVALID, message: 'segmentStartLine must be >= 0' } })
  segmentStartLine: number = 0;

  @IsOptional()
  @IsInt({ context: { code: ErrorCode.CONVERSATION_SEGMENT_END_INVALID, message: 'segmentEndLine must be integer' } })
  @Min(0, { context: { code: ErrorCode.CONVERSATION_SEGMENT_END_INVALID, message: 'segmentEndLine must be >= 0' } })
  segmentEndLine: number = 0;
}
