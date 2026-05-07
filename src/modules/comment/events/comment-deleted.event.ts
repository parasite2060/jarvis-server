import { DomainEvent, IDomainEventMetadata } from 'src/shared/common/models/seedwork/domain-event';
import { Comment } from 'src/shared/domain/entities/comment.entity';

export class CommentDeletedPayload {
  commentId!: string;
  blogId!: string;
  authorId!: string;

  constructor(init?: Partial<CommentDeletedPayload>) {
    Object.assign(this, init);
  }
}

export class CommentDeletedEvent extends DomainEvent<CommentDeletedPayload> {
  public readonly payload: CommentDeletedPayload;

  constructor(comment: Comment, metadata?: IDomainEventMetadata) {
    super({
      id: comment.id,
      refId: metadata?.refId,
      timestamp: metadata?.timestamp,
      actor: metadata?.actor,
      source: metadata?.source || { module: 'comment' },
    });

    this.payload = new CommentDeletedPayload({
      commentId: comment.id,
      blogId: comment.blogId,
      authorId: comment.authorId,
    });
  }

  public get code(): string {
    return 'ORG02002';
  }

  public key(): string {
    return this.id;
  }
}
