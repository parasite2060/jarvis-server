/* eslint-disable @typescript-eslint/no-explicit-any */
import { Metadata } from '@grpc/grpc-js';
import { KafkaContext } from '@nestjs/microservices';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { LoggerModuleOptions } from './logger-options';

export function defaultHttpSetup(_cls: ClsService, _req: Request, _res: Response, _options: LoggerModuleOptions): void {}
export function defaultKafkaSetup(_cls: ClsService, _context: KafkaContext, _payload: any, _options: LoggerModuleOptions): void {}
export function defaultGrpcSetup(_cls: ClsService, _context: Metadata, _payload: any, _options: LoggerModuleOptions): void {}
