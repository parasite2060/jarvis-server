/**
 * Cross-module CommandBus handler for `InvalidateContextCacheCommand` —
 * Story 13.5 / Q6.
 *
 * Clears the assembled-context cache slot. Logs `context.cache.invalidated`
 * with `{ reason, timestamp: <Python-ISO> }` so operators can correlate cache
 * misses with their triggers (light/deep/weekly dream completions). The
 * `formatPythonIso` helper keeps the timestamp wire-format consistent with
 * `assembled_at` (Q8).
 *
 * No callers in 13.5 — Stories 13.10 / 13.11 / 13.12 wire the dispatch sites.
 */
import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ContextCacheService } from '../../services/context-cache.service';
import { formatPythonIso } from 'src/shared/utils/format-iso';
import { InvalidateContextCacheCommand } from '../invalidate-context-cache.command';

@Injectable()
@CommandHandler(InvalidateContextCacheCommand)
export class InvalidateContextCacheHandler implements ICommandHandler<InvalidateContextCacheCommand, void> {
  private readonly logger = new Logger(InvalidateContextCacheHandler.name);

  constructor(private readonly cacheService: ContextCacheService) {}

  async execute(command: InvalidateContextCacheCommand): Promise<void> {
    await this.cacheService.clear();
    this.logger.log({
      message: 'context cache invalidated',
      event: 'context.cache.invalidated',
      reason: command.payload.reason,
      timestamp: formatPythonIso(command.payload.timestamp),
    });
  }
}
