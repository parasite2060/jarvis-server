import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { UseCases } from './usecases';
import { DomainEventHandlers, DomainEventHandlerFactory, DomainEventHandlerExplorer } from './usecases/domain-event-handlers';

@Module({
  controllers: [AuditLogController],
  providers: [...UseCases, ...DomainEventHandlers, DomainEventHandlerFactory, DomainEventHandlerExplorer],
  exports: [...UseCases],
})
export class AuditLogModule implements OnApplicationBootstrap {
  constructor(
    private readonly domainEventHandlerExplorer: DomainEventHandlerExplorer,
    private readonly domainEventHandlerFactory: DomainEventHandlerFactory,
  ) {}

  onApplicationBootstrap(): void {
    const { eventHandlers } = this.domainEventHandlerExplorer.explore();
    this.domainEventHandlerFactory.register(eventHandlers);
  }
}
