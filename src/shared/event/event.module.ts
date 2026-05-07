import { Global, Module } from '@nestjs/common';
import { DomainEventsHandler } from './listeners/domain.event-handler';

@Global()
@Module({
  providers: [DomainEventsHandler],
})
export class EventModule {}
