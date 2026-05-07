import { ExecutionContext } from '@nestjs/common';
import { KafkaContext, Transport } from '@nestjs/microservices';
import { TRANSPORT_METADATA } from '@nestjs/microservices/constants';

export type RequestType = 'HTTP' | 'KAFKA' | 'GRPC';

const transportCache = new WeakMap<object, Transport | undefined>();

export function detectRequestType(context: ExecutionContext): RequestType {
  const args = context.getArgs();

  if (args.length >= 2 && args[1] instanceof KafkaContext) {
    return 'KAFKA';
  }

  if (getTransport(context) === Transport.GRPC) {
    return 'GRPC';
  }

  return 'HTTP';
}

function getTransport(context: ExecutionContext): Transport | undefined {
  const handler = context.getHandler();
  const cached = transportCache.get(handler);
  if (cached !== undefined) return cached;

  const transport = Reflect.getMetadata(TRANSPORT_METADATA, handler) as Transport | undefined;
  transportCache.set(handler, transport);
  return transport;
}
