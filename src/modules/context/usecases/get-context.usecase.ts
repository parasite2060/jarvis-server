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
import { formatPythonIso } from 'src/shared/utils/format-iso';
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
    const assembledAt = formatPythonIso(new Date());
    if (cached !== null) {
      this.logger.log({ message: 'context cache hit', event: 'context.cache.hit' });
      const context = this.buildContext(
        cached.soul,
        cached.identity,
        cached.memory,
        cached.recentDailys,
        cached.decisionsIndex,
        cached.projectsIndex,
        cached.patternsIndex,
        cached.templatesIndex,
        cached.health,
      );
      return new ContextPresenter(
        context,
        true,
        assembledAt,
        cached.soul,
        cached.identity,
        cached.memory,
        cached.recentDailys,
        cached.decisionsIndex,
        cached.projectsIndex,
        cached.patternsIndex,
        cached.templatesIndex,
      );
    }
    this.logger.log({ message: 'context cache miss', event: 'context.cache.miss', reason: 'empty' });
    const assembled = await this.assembleContextUseCase.execute();
    await this.cacheService.set(assembled);
    this.logger.log({ message: 'context cache set', event: 'context.cache.set' });

    const context = this.buildContext(
      assembled.soul,
      assembled.identity,
      assembled.memory,
      assembled.recentDailys,
      assembled.decisionsIndex,
      assembled.projectsIndex,
      assembled.patternsIndex,
      assembled.templatesIndex,
      assembled.health,
    );
    return new ContextPresenter(
      context,
      false,
      assembledAt,
      assembled.soul,
      assembled.identity,
      assembled.memory,
      assembled.recentDailys,
      assembled.decisionsIndex,
      assembled.projectsIndex,
      assembled.patternsIndex,
      assembled.templatesIndex,
    );
  }

  private buildContext(
    soul: string | null,
    identity: string | null,
    memory: string | null,
    recentDailys: Array<{ label: string; content: string }>,
    decisionsIndex: string | null,
    projectsIndex: string | null,
    patternsIndex: string | null,
    templatesIndex: string | null,
    health: string | null,
  ): string {
    const sections: string[] = [];
    if (soul) sections.push(`## SOUL\n\n${soul}`);
    if (identity) sections.push(`## IDENTITY\n\n${identity}`);
    if (memory) sections.push(`## MEMORY\n\n${memory}`);
    for (const daily of recentDailys) {
      sections.push(`## ${daily.label}\n\n${daily.content}`);
    }
    if (decisionsIndex) sections.push(`## DECISIONS INDEX\n\n${decisionsIndex}`);
    if (projectsIndex) sections.push(`## PROJECTS INDEX\n\n${projectsIndex}`);
    if (patternsIndex) sections.push(`## PATTERNS INDEX\n\n${patternsIndex}`);
    if (templatesIndex) sections.push(`## TEMPLATES INDEX\n\n${templatesIndex}`);
    if (health) sections.push(`## VAULT HEALTH\n\n${health}`);
    sections.push(
      '## MEMORY TOOLS\n\nYou have access to memory tools during this session:\n' +
        '- `memory_search`: Search past memories semantically. ' +
        "Use when you need context beyond what's in this injected memory.\n" +
        '- `memory_add`: Store a new memory (decision, preference, pattern, ' +
        'correction, fact). Use when you observe important context worth remembering.',
    );
    return sections.join('\n\n');
  }
}
