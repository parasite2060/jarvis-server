/**
 * GetContextUseCase — Story 13.5 / cache-wrap layer.
 *
 * On hit: returns cached context with `cached: true` and a fresh `assembled_at`
 * timestamp (mirrors Python `memory.py:71-73` — `assembled_at` reflects the
 * CURRENT request time, not when the cache was warmed).
 *
 * On miss: runs `AssembleContextUseCase`, persists the result + assembled_at,
 * returns `cached: false`.
 *
 * cache-manager v7 collapses miss + expiry into a single `undefined` return —
 * the wrapper's `get()` normalises to `null`. We log only `reason: 'empty'`
 * because the wire-level `cached: false` flag is identical for both branches.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ContextPresenter } from '../models/presenters/context.presenter';
import { ContextCacheService } from '../services/context-cache.service';
import { formatPythonIso } from '../utils/format-iso';
import { AssembleContextUseCase } from './assemble-context.usecase';

@Injectable()
export class GetContextUseCase {
  private readonly logger = new Logger(GetContextUseCase.name);

  constructor(
    private readonly assembleContextUseCase: AssembleContextUseCase,
    private readonly cacheService: ContextCacheService,
  ) {}

  async execute(): Promise<ContextPresenter> {
    const cached = await this.cacheService.get();
    if (cached !== null) {
      this.logger.log({ message: 'context cache hit', event: 'context.cache.hit' });
      return new ContextPresenter(cached.context, true, formatPythonIso(new Date()));
    }
    this.logger.log({ message: 'context cache miss', event: 'context.cache.miss', reason: 'empty' });
    const assembled = await this.assembleContextUseCase.execute();
    const assembledAt = formatPythonIso(new Date());
    await this.cacheService.set(assembled, assembledAt);
    this.logger.log({ message: 'context cache set', event: 'context.cache.set' });
    return new ContextPresenter(assembled, false, assembledAt);
  }
}
