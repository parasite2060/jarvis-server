import { DomainEventDto } from '../../models/requests/domain-event.dto';

export interface IDomainEventHandler<TPayload = Record<string, unknown>> {
  handle(event: DomainEventDto<TPayload>): Promise<void>;
}
