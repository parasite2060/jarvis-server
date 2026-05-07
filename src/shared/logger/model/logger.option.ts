/* eslint-disable @typescript-eslint/no-explicit-any*/
import { KafkaContext } from '@nestjs/microservices';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { Level } from '../utils/level';
import { Metadata } from '@grpc/grpc-js';

export const CUSTOM_LOGGER_OPTION = Symbol('CUSTOM_LOGGER_OPTION');

export const CLOUD_TRACE_HEADERS = [
  'grpc-trace-bin',
  'x-request-id',
  'x-cloud-trace-context',
  'x-datadog-trace-id',
  'x-b3-traceid',
  'x-b3-spanid',
  'x-b3parentspanid',
  'x-b3-sampled',
  'x-b3-flags',
  'traceparent',
];

export class CustomLoggerOptions {
  output?: 'json' | 'text' = 'text';
  source?: boolean = false;
  gcpProperties?: boolean = false;
  level?: Level = 'info';
  logFile?: string | null = null;
  syncFile?: string = '/var/run/application.pid';
}

export class KafkaLoggerOptions {
  idGenerator: (context: KafkaContext, payload: any) => string = truncateKafkaIdGenerator(defaultKafkaIdGenerator, 16);
  setup: (cls: ClsService, context: KafkaContext, payload: any, options: LoggerModuleOptions) => void = defaultKafkaSetup;
}

export class HttpLoggerOptions {
  idGenerator: (req: Request, res: Response) => string = truncateHttpIdGenerator(defaultHttpIdGenerator, 16);
  setup: (cls: ClsService, req: Request, res: Response, options: LoggerModuleOptions) => void = defaultHttpSetup;
}

export class GrpcLoggerOptions {
  idGenerator: (context: any, payload: any) => string = truncateGrpcIdGenerator(defaultGrpcIdGenerator, 16);

  setup: (cls: ClsService, context: any, payload: any, options: LoggerModuleOptions) => void = defaultGrpcSetup;
}

export class LoggerModuleOptions extends CustomLoggerOptions {
  global?: boolean = true;
  http?: HttpLoggerOptions = new HttpLoggerOptions();
  kafka?: KafkaLoggerOptions = new KafkaLoggerOptions();
  gprc?: GrpcLoggerOptions = new GrpcLoggerOptions();
}

function truncateKafkaIdGenerator(
  generator: (context: KafkaContext, payload: any) => string,
  max: number,
): (context: KafkaContext, payload: any) => string {
  return (context: KafkaContext, payload: any) => {
    const requestId = generator(context, payload);
    if (requestId && requestId.length > max) {
      return requestId.substring(requestId.length - max);
    }

    return requestId;
  };
}

function truncateGrpcIdGenerator(generator: (context: any, payload: any) => string, max: number): (context: any, payload: any) => string {
  return (context: any, payload: any) => {
    const requestId = generator(context, payload);
    if (requestId && requestId.length > max) {
      return requestId.substring(requestId.length - max);
    }

    return requestId;
  };
}

function truncateHttpIdGenerator(generator: (req: Request, res: Response) => string, max: number): (req: Request, res: Response) => string {
  return (req: Request, res: Response) => {
    const requestId = generator(req, res);
    if (requestId && requestId.length > max) {
      return requestId.substring(requestId.length - max);
    }

    return requestId;
  };
}

function defaultKafkaIdGenerator(context: KafkaContext, payload: any): string {
  const message = context.getMessage();
  for (const header of CLOUD_TRACE_HEADERS) {
    const requestId = message.headers?.[header];
    if (requestId) {
      return requestId.toString();
    }
  }

  if (payload?.event_id) {
    return payload.event_id;
  }

  return getRandomString();
}

function defaultHttpIdGenerator(req: Request, _res: Response): string {
  for (const header of CLOUD_TRACE_HEADERS) {
    const requestId = req.headers[header];
    if (requestId) {
      return requestId.toString();
    }
  }

  return getRandomString();
}

function defaultGrpcIdGenerator(metadata: Metadata, _payload: any): string {
  if (metadata) {
    for (const header of CLOUD_TRACE_HEADERS) {
      const requestId = metadata.get(header);
      if (requestId && requestId.length > 0) {
        return requestId[0]!.toString();
      }
    }
  }

  return getRandomString();
}

function defaultHttpSetup(_cls: ClsService, _req: Request, _res: Response, _options: LoggerModuleOptions) {}

function defaultKafkaSetup(_cls: ClsService, _context: KafkaContext, _payload: any, _options: LoggerModuleOptions) {}

function defaultGrpcSetup(_cls: ClsService, _context: Metadata, _payload: any, _options: LoggerModuleOptions) {}

function getRandomString(): string {
  return randomBytes(8).toString('hex');
}
