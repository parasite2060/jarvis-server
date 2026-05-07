import { DomainEventDto } from '../../../models/requests/domain-event.dto';
import { CommentDeletedPayload } from '../../../models/event-payloads/comment-deleted.payload';
import { InjectableDomainEventHandler } from '../domain-event-handler.decorator';
import { IDomainEventHandler } from '../domain-event-handler.interface';
import { CreateAuditLogUseCase } from '../../create-audit-log.usecase';

@InjectableDomainEventHandler('ORG02002', CommentDeletedPayload)
export class CommentDeletedHandler implements IDomainEventHandler<CommentDeletedPayload> {
  constructor(private readonly createAuditLogUseCase: CreateAuditLogUseCase) {}

  async handle(event: DomainEventDto<CommentDeletedPayload>): Promise<void> {
    await this.createAuditLogUseCase.execute(event as unknown as DomainEventDto, 'Comment', 'DELETE');
  }
}
