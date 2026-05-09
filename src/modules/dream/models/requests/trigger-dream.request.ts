/**
 * TriggerDreamRequest — POST /dream body shape.
 * Mirrors Python `DreamRequest` at `app/api/routes/dream.py:22-23` byte-for-byte
 * modulo camelCase wire format per Story 13.6 Q1.
 *
 * Q7 SM pick: server accepts BOTH camelCase `sourceDate` (TS wire) and
 * snake_case `source_date` (plugin wire) via dual `@Expose` decorators.
 * Plugin keeps working; TS honours camelCase per Q1. No plugin code change.
 */
import { Expose } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';

export class TriggerDreamRequest {
  /**
   * camelCase wire format per Story 13.6 Q1.
   * Optional; when omitted targetDate defaults to today UTC.
   * Validated via regex — mirrors Python's wire-level rejection.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'sourceDate must be YYYY-MM-DD' })
  @Expose({ name: 'sourceDate' })
  sourceDate?: string;

  /**
   * snake_case alias — mirrors plugin's existing wire format
   * (`mcp-server/src/tools/dream.ts` sends `source_date`). Q7 SM pick.
   * Same validation applies; both map to the same class property.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'sourceDate must be YYYY-MM-DD' })
  @Expose({ name: 'source_date' })
  source_date?: string;
}
