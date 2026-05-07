import { DomainEventDto } from '../../../models/requests/domain-event.dto';
import { CommentCreatedPayload } from '../../../models/event-payloads/comment-created.payload';
import { InjectableDomainEventHandler } from '../domain-event-handler.decorator';
import { IDomainEventHandler } from '../domain-event-handler.interface';
import { CreateAuditLogUseCase } from '../../create-audit-log.usecase';

@InjectableDomainEventHandler('ORG02001', CommentCreatedPayload)
export class CommentCreatedHandler implements IDomainEventHandler<CommentCreatedPayload> {
  constructor(private readonly createAuditLogUseCase: CreateAuditLogUseCase) {}

  async handle(event: DomainEventDto<CommentCreatedPayload>): Promise<void> {
    await this.createAuditLogUseCase.execute(event as unknown as DomainEventDto, 'Comment', 'CREATE');
  }
}
