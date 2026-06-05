import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { defer, filter, map, mergeMap, Subscription } from 'rxjs';
import { DomainEvent } from 'src/shared/common/models/seedwork/domain-event';
import { SafeEventHandler } from 'src/utils/safe-event.handler';

export class DomainEventsHandler extends SafeEventHandler<DomainEvent> implements OnModuleInit, OnModuleDestroy {
  private subscription!: Subscription;

  constructor(private readonly eventBus: EventBus) {
    super();
  }

  onModuleInit() {
    this.subscription = this.eventBus
      .pipe(
        filter((event) => event instanceof DomainEvent),
        map((event) => event as DomainEvent),
        mergeMap((event) => defer(() => Promise.resolve(this.handle(event))), 5),
      )
      .subscribe();
  }

  onModuleDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  protected async action(event: DomainEvent) {
    // Jarvis MVP: domain events are handled in-process via EventBus only.
    // No Kafka publishing — kept for future extensibility.
    return event;
  }
}
