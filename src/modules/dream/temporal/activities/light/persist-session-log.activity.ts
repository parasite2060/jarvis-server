import { Inject, Injectable } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { PersistSessionLogInput } from '../../workflows/light-dream.workflow';

@Injectable()
export class PersistSessionLogActivity {
  constructor(@Inject(DREAM_REPOSITORY) private readonly dreamRepo: IDreamRepository) {}

  @TemporalActivity('light.persist_session_log')
  async persistSessionLog(inp: PersistSessionLogInput): Promise<void> {
    try {
      await this.dreamRepo.persistSessionLog(inp.dream_id, inp.session_log_json as unknown as Record<string, unknown>);
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_PERSIST_SESSION_LOG_FAILED, `persistSessionLog failed: ${(err as Error).message}`);
    }
  }
}
