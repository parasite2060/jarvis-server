import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ErrorCode } from 'src/utils/error.code';

export class CreateCommentRequest {
  @IsNotEmpty({ context: { code: ErrorCode.COMMENT_CONTENT_INVALID, message: 'content is required' } })
  @IsString({ context: { code: ErrorCode.COMMENT_CONTENT_INVALID, message: 'content must be string' } })
  content!: string;

  @IsNotEmpty({ context: { code: ErrorCode.COMMENT_BLOG_ID_INVALID, message: 'blogId is required' } })
  @IsUUID('4', { context: { code: ErrorCode.COMMENT_BLOG_ID_INVALID, message: 'blogId must be valid UUID' } })
  blogId!: string;

  @IsNotEmpty({ context: { code: ErrorCode.COMMENT_AUTHOR_INVALID, message: 'authorId is required' } })
  @IsString({ context: { code: ErrorCode.COMMENT_AUTHOR_INVALID, message: 'authorId must be string' } })
  authorId!: string;
}
