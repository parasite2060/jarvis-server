/* eslint-disable @typescript-eslint/no-explicit-any */
import { Metadata } from '@grpc/grpc-js';
import { KafkaContext } from '@nestjs/microservices';
import { Request, Response } from 'express';
import { randomId } from '../internal/random-id';
import { CLOUD_TRACE_HEADERS } from './cloud-trace-headers';

export function defaultKafkaIdGenerator(context: KafkaContext, payload: any): string {
  const headers = context.getMessage().headers;

  for (const header of CLOUD_TRACE_HEADERS) {
    const requestId = headers?.[header];
    if (requestId) return requestId.toString();
  }

  if (payload?.event_id) return payload.event_id;

  return randomId();
}

export function defaultHttpIdGenerator(req: Request, _res: Response): string {
  for (const header of CLOUD_TRACE_HEADERS) {
    const requestId = req.headers[header];
    if (requestId) return requestId.toString();
  }

  return randomId();
}

export function defaultGrpcIdGenerator(metadata: Metadata, _payload: any): string {
  if (!metadata) return randomId();

  for (const header of CLOUD_TRACE_HEADERS) {
    const requestId = metadata.get(header);
    if (requestId && requestId.length > 0) {
      return requestId[0]!.toString();
    }
  }

  return randomId();
}
