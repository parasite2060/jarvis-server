/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { DOMAIN_EVENT_HANDLER_METADATA } from './constants';

@Injectable()
export class DomainEventHandlerExplorer {
  private readonly logger = new Logger(DomainEventHandlerExplorer.name);

  constructor(private readonly modulesContainer: ModulesContainer) {}

  explore(): { eventHandlers: Type<any>[] } {
    const eventHandlers: Type<any>[] = [];

    const modules = [...this.modulesContainer.values()];

    for (const module of modules) {
      const providers = [...module.providers.values()];

      for (const provider of providers) {
        if (!provider.metatype || typeof provider.metatype !== 'function') {
          continue;
        }

        const metadata = Reflect.getMetadata(DOMAIN_EVENT_HANDLER_METADATA, provider.metatype);

        if (metadata) {
          eventHandlers.push(provider.metatype as Type<any>);
        }
      }
    }

    this.logger.log(`Discovered ${eventHandlers.length} domain event handlers`);

    return { eventHandlers };
  }
}
