/* eslint-disable @typescript-eslint/no-explicit-any */

import { Injectable, LoggerService } from '@nestjs/common';

@Injectable()
export class MockLoggerService implements LoggerService {
  public setContext(_context: string): void {
    // This is default function, allow empty
  }

  public log(_message: any, _context?: string): any {
    return {};
  }

  public error(_message: any, _trace?: string, _context?: string): any {
    return {};
  }

  public warn(_message: any, _context?: string): any {
    return {};
  }

  public debug?(_message: any, _context?: string): any {
    return {};
  }

  public verbose?(_message: any, _context?: string): any {
    return {};
  }
}
