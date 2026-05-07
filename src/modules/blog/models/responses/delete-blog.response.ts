export class DeleteBlogResponse {
  id: string;
  deleted: boolean;

  constructor(init: { id: string; deleted: boolean }) {
    this.id = init.id;
    this.deleted = init.deleted;
  }
}
