/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DomainEventDto } from '../../models/requests/domain-event.dto';
import { DOMAIN_EVENT_HANDLER_METADATA } from './constants';
import { IDomainEventHandler } from './domain-event-handler.interface';

@Injectable()
export class DomainEventHandlerFactory {
  private readonly logger = new Logger(DomainEventHandlerFactory.name);
  private eventHandlerTypes: Type<any>[] = [];
  private handlers: Map<string, IDomainEventHandler> = new Map();

  constructor(private readonly moduleRef: ModuleRef) {}

  register(handlerTypes: Type<any>[]): void {
    this.eventHandlerTypes = handlerTypes;
  }

  async getHandler(eventCode: string): Promise<IDomainEventHandler | null> {
    if (this.handlers.has(eventCode)) {
      return this.handlers.get(eventCode)!;
    }

    const handlerType = this.eventHandlerTypes.find((type) => eventCode === Reflect.getMetadata(DOMAIN_EVENT_HANDLER_METADATA, type));

    if (!handlerType) {
      return null;
    }

    const handlerInstance = this.moduleRef.get<IDomainEventHandler>(handlerType, { strict: false });

    this.handlers.set(eventCode, handlerInstance);

    return handlerInstance;
  }

  async handle(event: DomainEventDto): Promise<void> {
    const handler = await this.getHandler(event.code);

    if (!handler) {
      this.logger.warn(`No handler for event code ${event.code}, skipping`);
      return;
    }

    await handler.handle(event);
  }
}
