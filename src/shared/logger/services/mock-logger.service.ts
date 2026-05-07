import { Injectable, LoggerService } from '@nestjs/common';

@Injectable()
export class MockLoggerService implements LoggerService {
  setContext(_context: string): void {}
  log(_message: unknown, _context?: string): void {}
  error(_message: unknown, _trace?: string, _context?: string): void {}
  warn(_message: unknown, _context?: string): void {}
  debug(_message: unknown, _context?: string): void {}
  verbose(_message: unknown, _context?: string): void {}
}
