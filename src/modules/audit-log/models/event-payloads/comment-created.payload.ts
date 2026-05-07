import { Expose } from 'class-transformer';
import { IsString, IsUUID } from 'class-validator';

export class CommentCreatedPayload {
  @Expose()
  @IsUUID()
  commentId!: string;

  @Expose()
  @IsUUID()
  blogId!: string;

  @Expose()
  @IsString()
  content!: string;

  @Expose()
  @IsUUID()
  authorId!: string;

  constructor(init?: Partial<CommentCreatedPayload>) {
    if (init) {
      Object.assign(this, init);
    }
  }
}
