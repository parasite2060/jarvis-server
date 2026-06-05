/**
 * UpdateConfigRequest — Story 13.13 (validators per Q4 RESOLVED = `cron-parser`).
 *
 * Mirrors Python `ConfigUpdateRequest` (`app/models/config_schemas.py:21-27`).
 * All fields optional; cron strings validated via `cron-parser`'s
 * `parseExpression(str)` (catches `60 20 * * *` which regex accepts but
 * Temporal rejects).
 */
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsCronExpression } from './cron-expression.validator';

export class UpdateConfigRequest {
  @IsOptional()
  @IsBoolean()
  autoMerge?: boolean;

  @IsOptional()
  @IsString()
  @IsCronExpression()
  deepDreamCron?: string;

  @IsOptional()
  @IsString()
  @IsCronExpression()
  weeklyReviewCron?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(500)
  maxMemoryLines?: number;
}
