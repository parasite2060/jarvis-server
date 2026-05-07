import { Expose } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class BlogUpdatedPayload {
  @Expose()
  @IsUUID()
  blogId!: string;

  @Expose()
  @IsString()
  title!: string;

  @Expose()
  @IsUUID()
  authorId!: string;

  @Expose()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  updatedFields?: string[];

  constructor(init?: Partial<BlogUpdatedPayload>) {
    if (init) {
      Object.assign(this, init);
    }
  }
}
