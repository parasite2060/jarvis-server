import { Expose } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { ErrorCode } from 'src/utils/error.code';

/**
 * GET /conversations/position query string.
 *
 * Wire format: `?session_id=<sid>` (snake_case). The plugin's
 * `worker/conversation-drain.js :: fetchLastPosition` and the SessionStart
 * hook both call this with `session_id`. We bind the query to a TS property
 * via `@Expose({ name: 'session_id' })` so the rest of the codebase can use
 * the camelCase identifier.
 */
export class GetPositionRequest {
  @Expose({ name: 'session_id' })
  @IsNotEmpty({ context: { code: ErrorCode.CONVERSATION_SESSION_ID_INVALID, message: 'session_id is required' } })
  @IsString({ context: { code: ErrorCode.CONVERSATION_SESSION_ID_INVALID, message: 'session_id must be string' } })
  sessionId!: string;
}
