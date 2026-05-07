import { DomainEvent, IDomainEventMetadata } from 'src/shared/common/models/seedwork/domain-event';
import { Comment } from 'src/shared/domain/entities/comment.entity';

export class CommentCreatedPayload {
  commentId!: string;
  blogId!: string;
  authorId!: string;

  constructor(init?: Partial<CommentCreatedPayload>) {
    Object.assign(this, init);
  }
}

export class CommentCreatedEvent extends DomainEvent<CommentCreatedPayload> {
  public readonly payload: CommentCreatedPayload;

  constructor(comment: Comment, metadata?: IDomainEventMetadata) {
    super({
      id: comment.id,
      refId: metadata?.refId,
      timestamp: metadata?.timestamp,
      actor: metadata?.actor,
      source: metadata?.source || { module: 'comment' },
    });

    this.payload = new CommentCreatedPayload({
      commentId: comment.id,
      blogId: comment.blogId,
      authorId: comment.authorId,
    });
  }

  public get code(): string {
    return 'ORG02001';
  }

  public key(): string {
    return this.id;
  }
}
