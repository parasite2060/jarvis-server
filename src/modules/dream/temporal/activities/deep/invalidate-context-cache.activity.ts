import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import type { InvalidateCacheInput } from '../../workflows/deep-dream.workflow';

@Injectable()
export class DeepInvalidateContextCacheActivity {
  private readonly logger = new Logger(DeepInvalidateContextCacheActivity.name);

  constructor(private readonly commandBus: CommandBus) {}

  @TemporalActivity('deep.invalidate_cache')
  async invalidateContextCache(inp: InvalidateCacheInput): Promise<void> {
    await this.commandBus.execute(new InvalidateContextCacheCommand({ reason: 'deep-dream-completed', timestamp: new Date() }));
    this.logger.log({
      message: 'deep dream invalidate context cache dispatched',
      event: 'deepDream.invalidateContextCache.dispatched',
      dreamId: inp.dream_id,
    });
  }
}
