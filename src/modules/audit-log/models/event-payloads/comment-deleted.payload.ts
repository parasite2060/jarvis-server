import { Expose } from 'class-transformer';
import { IsUUID } from 'class-validator';

export class CommentDeletedPayload {
  @Expose()
  @IsUUID()
  commentId!: string;

  @Expose()
  @IsUUID()
  blogId!: string;

  @Expose()
  @IsUUID()
  authorId!: string;

  constructor(init?: Partial<CommentDeletedPayload>) {
    if (init) {
      Object.assign(this, init);
    }
  }
}
