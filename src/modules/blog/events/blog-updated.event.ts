import { DomainEvent, IDomainEventMetadata } from 'src/shared/common/models/seedwork/domain-event';
import { Blog } from 'src/shared/domain/entities/blog.entity';

export class BlogUpdatedPayload {
  blogId!: string;
  title!: string;
  authorId!: string;

  constructor(init?: Partial<BlogUpdatedPayload>) {
    Object.assign(this, init);
  }
}

export class BlogUpdatedEvent extends DomainEvent<BlogUpdatedPayload> {
  public readonly payload: BlogUpdatedPayload;

  constructor(blog: Blog, metadata?: IDomainEventMetadata) {
    super({
      id: blog.id,
      refId: metadata?.refId,
      timestamp: metadata?.timestamp,
      actor: metadata?.actor,
      source: metadata?.source || { module: 'blog' },
    });

    this.payload = new BlogUpdatedPayload({
      blogId: blog.id,
      title: blog.title,
      authorId: blog.authorId,
    });
  }

  public get code(): string {
    return 'ORG01002';
  }

  public key(): string {
    return this.id;
  }
}
