import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { LoggerModuleOptions } from './logger-options';

export function defaultHttpSetup(_cls: ClsService, _req: Request, _res: Response, _options: LoggerModuleOptions): void {}
