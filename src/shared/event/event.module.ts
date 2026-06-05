import { Global, Module } from '@nestjs/common';

/**
 * EventModule — placeholder for future domain event publishing infrastructure.
 * Jarvis MVP uses in-process EventBus only (architecture.md §6.8).
 * Kafka publishing was removed in Story 13.16.5.
 */
@Global()
@Module({})
export class EventModule {}
