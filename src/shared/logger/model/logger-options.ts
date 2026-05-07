/* eslint-disable @typescript-eslint/no-explicit-any */
import { Metadata } from '@grpc/grpc-js';
import { KafkaContext } from '@nestjs/microservices';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { withTruncation } from '../internal/truncate-id';
import { Level } from '../utils/level';
import { defaultGrpcIdGenerator, defaultHttpIdGenerator, defaultKafkaIdGenerator } from './default-id-generators';
import { defaultGrpcSetup, defaultHttpSetup, defaultKafkaSetup } from './default-setups';

export const CUSTOM_LOGGER_OPTION = Symbol('CUSTOM_LOGGER_OPTION');

const ID_MAX_LENGTH = 16;

export class CustomLoggerOptions {
  output?: 'json' | 'text' = 'text';
  source?: boolean = false;
  gcpProperties?: boolean = false;
  level?: Level = 'info';
  logFile?: string | null = null;
  syncFile?: string = '/var/run/application.pid';
}

export class HttpLoggerOptions {
  idGenerator: (req: Request, res: Response) => string = withTruncation(defaultHttpIdGenerator, ID_MAX_LENGTH);
  setup: (cls: ClsService, req: Request, res: Response, options: LoggerModuleOptions) => void = defaultHttpSetup;
}

export class KafkaLoggerOptions {
  idGenerator: (context: KafkaContext, payload: any) => string = withTruncation(defaultKafkaIdGenerator, ID_MAX_LENGTH);
  setup: (cls: ClsService, context: KafkaContext, payload: any, options: LoggerModuleOptions) => void = defaultKafkaSetup;
}

export class GrpcLoggerOptions {
  idGenerator: (context: Metadata, payload: any) => string = withTruncation(defaultGrpcIdGenerator, ID_MAX_LENGTH);
  setup: (cls: ClsService, context: Metadata, payload: any, options: LoggerModuleOptions) => void = defaultGrpcSetup;
}

export class LoggerModuleOptions extends CustomLoggerOptions {
  global?: boolean = true;
  http?: HttpLoggerOptions = new HttpLoggerOptions();
  kafka?: KafkaLoggerOptions = new KafkaLoggerOptions();
  grpc?: GrpcLoggerOptions = new GrpcLoggerOptions();
}
