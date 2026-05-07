import { Expose } from 'class-transformer';
import { IsString, IsUUID } from 'class-validator';

export class BlogCreatedPayload {
  @Expose()
  @IsUUID()
  blogId!: string;

  @Expose()
  @IsString()
  title!: string;

  @Expose()
  @IsUUID()
  authorId!: string;

  constructor(init?: Partial<BlogCreatedPayload>) {
    if (init) {
      Object.assign(this, init);
    }
  }
}
