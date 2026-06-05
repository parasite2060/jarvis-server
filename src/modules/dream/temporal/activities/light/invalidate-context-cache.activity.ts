import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { InvalidateContextCacheCommand } from 'src/modules/context/commands/invalidate-context-cache.command';
import type { InvalidateCacheInput } from '../../workflows/light-dream.workflow';

@Injectable()
export class LightInvalidateContextCacheActivity {
  private readonly logger = new Logger(LightInvalidateContextCacheActivity.name);

  constructor(private readonly commandBus: CommandBus) {}

  @TemporalActivity('light.invalidate_cache')
  async invalidateContextCache(inp: InvalidateCacheInput): Promise<void> {
    try {
      await this.commandBus.execute(new InvalidateContextCacheCommand({ reason: 'light-dream-completed', timestamp: new Date() }));
      this.logger.log({
        message: 'light dream invalidate context cache dispatched',
        event: 'lightDream.invalidateContextCache.dispatched',
        dreamId: inp.dream_id,
      });
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_INVALIDATE_CACHE_FAILED, `invalidateContextCache failed: ${(err as Error).message}`);
    }
  }
}
