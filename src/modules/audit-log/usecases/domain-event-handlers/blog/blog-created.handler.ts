import { DomainEventDto } from '../../../models/requests/domain-event.dto';
import { BlogCreatedPayload } from '../../../models/event-payloads/blog-created.payload';
import { InjectableDomainEventHandler } from '../domain-event-handler.decorator';
import { IDomainEventHandler } from '../domain-event-handler.interface';
import { CreateAuditLogUseCase } from '../../create-audit-log.usecase';

@InjectableDomainEventHandler('ORG01001', BlogCreatedPayload)
export class BlogCreatedHandler implements IDomainEventHandler<BlogCreatedPayload> {
  constructor(private readonly createAuditLogUseCase: CreateAuditLogUseCase) {}

  async handle(event: DomainEventDto<BlogCreatedPayload>): Promise<void> {
    await this.createAuditLogUseCase.execute(event as unknown as DomainEventDto, 'Blog', 'CREATE');
  }
}
