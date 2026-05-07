export class Comment {
  id!: string;
  content!: string;
  blogId!: string;
  authorId!: string;
  isValid: boolean = true;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(init?: Partial<Comment>) {
    Object.assign(this, init);
  }
}
