import { DomainEventDto } from '../../../models/requests/domain-event.dto';
import { BlogDeletedPayload } from '../../../models/event-payloads/blog-deleted.payload';
import { InjectableDomainEventHandler } from '../domain-event-handler.decorator';
import { IDomainEventHandler } from '../domain-event-handler.interface';
import { CreateAuditLogUseCase } from '../../create-audit-log.usecase';

@InjectableDomainEventHandler('ORG01003', BlogDeletedPayload)
export class BlogDeletedHandler implements IDomainEventHandler<BlogDeletedPayload> {
  constructor(private readonly createAuditLogUseCase: CreateAuditLogUseCase) {}

  async handle(event: DomainEventDto<BlogDeletedPayload>): Promise<void> {
    await this.createAuditLogUseCase.execute(event as unknown as DomainEventDto, 'Blog', 'DELETE');
  }
}
