import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ErrorCode } from 'src/utils/error.code';

export class ListBlogsRequest {
  @IsOptional()
  @IsInt({ context: { code: ErrorCode.BLOG_PAGE_INVALID, message: 'page must be integer' } })
  @Min(1, { context: { code: ErrorCode.BLOG_PAGE_INVALID, message: 'page min 1' } })
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @IsOptional()
  @IsInt({ context: { code: ErrorCode.BLOG_LIMIT_INVALID, message: 'limit must be integer' } })
  @Min(1, { context: { code: ErrorCode.BLOG_LIMIT_INVALID, message: 'limit min 1' } })
  @Max(100, { context: { code: ErrorCode.BLOG_LIMIT_INVALID, message: 'limit max 100' } })
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;
}
