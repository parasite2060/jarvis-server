import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ErrorCode } from 'src/utils/error.code';

export class UpdateBlogRequest {
  @IsOptional()
  @IsString({ context: { code: ErrorCode.BLOG_TITLE_INVALID, message: 'title must be string' } })
  @MaxLength(200, { context: { code: ErrorCode.BLOG_TITLE_INVALID, message: 'title max 200 chars' } })
  title?: string;

  @IsOptional()
  @IsString({ context: { code: ErrorCode.BLOG_CONTENT_INVALID, message: 'content must be string' } })
  content?: string;
}
