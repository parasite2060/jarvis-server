import { Expose } from 'class-transformer';
import { IsUUID } from 'class-validator';

export class BlogDeletedPayload {
  @Expose()
  @IsUUID()
  blogId!: string;

  @Expose()
  @IsUUID()
  authorId!: string;

  constructor(init?: Partial<BlogDeletedPayload>) {
    if (init) {
      Object.assign(this, init);
    }
  }
}
