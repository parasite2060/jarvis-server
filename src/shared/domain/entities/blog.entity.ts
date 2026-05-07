export class Blog {
  id!: string;
  title!: string;
  content!: string;
  authorId!: string;
  isValid: boolean = true;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(init?: Partial<Blog>) {
    Object.assign(this, init);
  }
}
