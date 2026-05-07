import { DomainEvent, IDomainEventMetadata } from 'src/shared/common/models/seedwork/domain-event';
import { Blog } from 'src/shared/domain/entities/blog.entity';

export class BlogCreatedPayload {
  blogId!: string;
  title!: string;
  authorId!: string;

  constructor(init?: Partial<BlogCreatedPayload>) {
    Object.assign(this, init);
  }
}

export class BlogCreatedEvent extends DomainEvent<BlogCreatedPayload> {
  public readonly payload: BlogCreatedPayload;

  constructor(blog: Blog, metadata?: IDomainEventMetadata) {
    super({
      id: blog.id,
      refId: metadata?.refId,
      timestamp: metadata?.timestamp,
      actor: metadata?.actor,
      source: metadata?.source || { module: 'blog' },
    });

    this.payload = new BlogCreatedPayload({
      blogId: blog.id,
      title: blog.title,
      authorId: blog.authorId,
    });
  }

  public get code(): string {
    return 'ORG01001';
  }

  public key(): string {
    return this.id;
  }
}
