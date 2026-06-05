import { LoggerModuleOptions } from 'src/shared/logger/model/logger.option';
import { Level } from 'src/shared/logger/utils/level';
import { NodeEnvironment } from 'src/shared/config/environment';

export function getLogLevels(): Level {
  if (process.env['NODE_ENV'] === NodeEnvironment.LOCAL) {
    return 'debug';
  }

  if (process.env['NODE_ENV'] === NodeEnvironment.PRODUCTION) {
    return 'info';
  }

  if (process.env['NODE_ENV'] === NodeEnvironment.STAGING) {
    return 'info';
  }

  return (process.env['LOG_LEVEL'] as Level) ?? 'debug';
}

export function getLoggerOptions(): LoggerModuleOptions {
  const output = (process.env['LOG_OUTPUT'] as 'json' | 'text') ?? (process.env['NODE_ENV'] === NodeEnvironment.LOCAL ? 'text' : 'json');
  const logFile = process.env['LOG_FILE_PATH'] ?? process.env['LOG_FILE'];

  return {
    global: true,
    output,
    gcpProperties: process.env['NODE_ENV'] !== NodeEnvironment.LOCAL,
    source: ![NodeEnvironment.STAGING, NodeEnvironment.PRODUCTION].includes(process.env['NODE_ENV'] as NodeEnvironment),
    level: getLogLevels(),
    logFile,
    syncFile: process.env['LOG_SYNC_FILE'] ?? '/var/run/application.pid',
  };
}
