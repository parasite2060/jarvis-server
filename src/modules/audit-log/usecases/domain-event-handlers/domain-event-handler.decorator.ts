/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { DOMAIN_EVENT_HANDLER_METADATA } from './constants';
import { DomainEventTransform } from './domain-event-transform.decorator';

export function InjectableDomainEventHandler<T extends { new (...args: any[]): any }>(eventCode: string, payloadClass?: T): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(DOMAIN_EVENT_HANDLER_METADATA, eventCode, target);

    Injectable()(target);

    if (payloadClass) {
      DomainEventTransform(payloadClass)(target);
    }

    return target;
  };
}
