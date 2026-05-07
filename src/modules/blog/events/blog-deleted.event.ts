import { DomainEvent, IDomainEventMetadata } from 'src/shared/common/models/seedwork/domain-event';
import { Blog } from 'src/shared/domain/entities/blog.entity';

export class BlogDeletedPayload {
  blogId!: string;
  title!: string;
  authorId!: string;

  constructor(init?: Partial<BlogDeletedPayload>) {
    Object.assign(this, init);
  }
}

export class BlogDeletedEvent extends DomainEvent<BlogDeletedPayload> {
  public readonly payload: BlogDeletedPayload;

  constructor(blog: Blog, metadata?: IDomainEventMetadata) {
    super({
      id: blog.id,
      refId: metadata?.refId,
      timestamp: metadata?.timestamp,
      actor: metadata?.actor,
      source: metadata?.source || { module: 'blog' },
    });

    this.payload = new BlogDeletedPayload({
      blogId: blog.id,
      title: blog.title,
      authorId: blog.authorId,
    });
  }

  public get code(): string {
    return 'ORG01003';
  }

  public key(): string {
    return this.id;
  }
}
