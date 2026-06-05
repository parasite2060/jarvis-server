import * as fs from 'fs';
import pino, { DestinationStream } from 'pino';
import { CustomLoggerOptions } from '../model/logger-options';

const FLUSH_INTERVAL_MS = 5_000;
const MIN_BUFFER_BYTES = 8_192;
const MAX_WRITE_BYTES = 32_768;

export function createPinoDestination(options: CustomLoggerOptions): DestinationStream | undefined {
  if (options.logFile) return createFileDestination(options.logFile, options.syncFile);
  if (options.output === 'text') return createPrettyTransport();
  return undefined;
}

function createFileDestination(logFile: string, syncFile?: string): DestinationStream {
  const dest = pino.destination({
    dest: logFile,
    minLength: MIN_BUFFER_BYTES,
    maxWrite: MAX_WRITE_BYTES,
    sync: false,
  });

  if (syncFile) {
    fs.writeFileSync(syncFile, process.pid.toString());
  }
  process.on('SIGUSR2', () => dest.reopen());

  setInterval(() => dest.flush(), FLUSH_INTERVAL_MS).unref();

  return dest;
}

function createPrettyTransport(): DestinationStream {
  return pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      messageKey: 'message',
      ignore: 'hostname,severity',
    },
  });
}
