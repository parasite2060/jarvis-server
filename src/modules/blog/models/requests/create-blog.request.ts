import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ErrorCode } from 'src/utils/error.code';

export class CreateBlogRequest {
  @IsNotEmpty({ context: { code: ErrorCode.BLOG_TITLE_INVALID, message: 'title is required' } })
  @IsString({ context: { code: ErrorCode.BLOG_TITLE_INVALID, message: 'title must be string' } })
  @MaxLength(200, { context: { code: ErrorCode.BLOG_TITLE_INVALID, message: 'title max 200 chars' } })
  title!: string;

  @IsNotEmpty({ context: { code: ErrorCode.BLOG_CONTENT_INVALID, message: 'content is required' } })
  @IsString({ context: { code: ErrorCode.BLOG_CONTENT_INVALID, message: 'content must be string' } })
  content!: string;

  @IsNotEmpty({ context: { code: ErrorCode.BLOG_AUTHOR_INVALID, message: 'authorId is required' } })
  @IsString({ context: { code: ErrorCode.BLOG_AUTHOR_INVALID, message: 'authorId must be string' } })
  authorId!: string;
}
