import { Injectable } from '@nestjs/common';
import { DomainEventDto } from '../models/requests/domain-event.dto';
import { DomainEventHandlerFactory } from './domain-event-handlers/domain-event-handler.factory';

@Injectable()
export class HandleDomainEventUseCase {
  constructor(private readonly domainEventHandlerFactory: DomainEventHandlerFactory) {}

  async execute(event: DomainEventDto): Promise<void> {
    await this.domainEventHandlerFactory.handle(event);
  }
}
