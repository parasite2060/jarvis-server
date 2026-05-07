import { DomainEventDto } from '../../../models/requests/domain-event.dto';
import { BlogUpdatedPayload } from '../../../models/event-payloads/blog-updated.payload';
import { InjectableDomainEventHandler } from '../domain-event-handler.decorator';
import { IDomainEventHandler } from '../domain-event-handler.interface';
import { CreateAuditLogUseCase } from '../../create-audit-log.usecase';

@InjectableDomainEventHandler('ORG01002', BlogUpdatedPayload)
export class BlogUpdatedHandler implements IDomainEventHandler<BlogUpdatedPayload> {
  constructor(private readonly createAuditLogUseCase: CreateAuditLogUseCase) {}

  async handle(event: DomainEventDto<BlogUpdatedPayload>): Promise<void> {
    await this.createAuditLogUseCase.execute(event as unknown as DomainEventDto, 'Blog', 'UPDATE');
  }
}
