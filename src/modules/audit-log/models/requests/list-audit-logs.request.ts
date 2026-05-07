import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ErrorCode } from 'src/utils/error.code';

export class ListAuditLogsRequest {
  @IsOptional()
  @IsString({ context: { code: ErrorCode.AUDIT_LOG_EVENT_CODE_INVALID, message: 'entityId must be string' } })
  entityId?: string;

  @IsOptional()
  @IsInt({ context: { code: ErrorCode.AUDIT_LOG_PAGE_INVALID, message: 'page must be integer' } })
  @Min(1, { context: { code: ErrorCode.AUDIT_LOG_PAGE_INVALID, message: 'page min 1' } })
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @IsOptional()
  @IsInt({ context: { code: ErrorCode.AUDIT_LOG_LIMIT_INVALID, message: 'limit must be integer' } })
  @Min(1, { context: { code: ErrorCode.AUDIT_LOG_LIMIT_INVALID, message: 'limit min 1' } })
  @Max(100, { context: { code: ErrorCode.AUDIT_LOG_LIMIT_INVALID, message: 'limit max 100' } })
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;
}
