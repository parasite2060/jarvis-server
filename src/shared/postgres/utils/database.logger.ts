import { Logger as TypeOrmLogger } from 'typeorm';
import { Logger as NestLogger } from '@nestjs/common';

class DatabaseLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('SQL');
  private readonly isSilent = process.env['NODE_ENV'] === 'production' || process.env['NODE_ENV'] === 'staging';

  logQuery(query: string, parameters?: unknown[]) {
    this.logger.verbose(`${query} -- Parameters: ${this.stringifyParameters(parameters)}`);
  }

  logQueryError(error: string, query: string, parameters?: unknown[]) {
    this.logger.error(`${query} -- Parameters: ${this.stringifyParameters(parameters)} -- ${error}`);
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[]) {
    this.logger.warn(`Time: ${time} -- Parameters: ${this.stringifyParameters(parameters)} -- ${query}`);
  }

  logMigration(message: string) {
    this.logger.log(message);
  }

  logSchemaBuild(message: string) {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: string) {
    if (level === 'log' && !this.isSilent) {
      return this.logger.verbose(message);
    }
    if (level === 'info' && !this.isSilent) {
      return this.logger.verbose(message);
    }
    if (level === 'warn') {
      return this.logger.warn(message);
    }
  }

  private stringifyParameters(parameters?: unknown[]) {
    try {
      return JSON.stringify(parameters);
    } catch {
      return '';
    }
  }
}

export default DatabaseLogger;
