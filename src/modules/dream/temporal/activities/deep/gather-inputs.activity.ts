import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { MEMU_API, IMemuApi } from 'src/shared/domain/apis/memu-api.interface';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { DreamSchema } from 'src/shared/postgres/schema/dream.schema';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { DeepDreamPayload, GatherInputsResult } from '../../workflows/deep-dream.workflow';
import { SEXTY_SECONDS_MS, safeReadVault, safeWriteVault } from './helpers';

@Injectable()
export class GatherInputsActivity {
  private readonly logger = new Logger(GatherInputsActivity.name);

  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    @InjectDataSource(DBConnections.INTERNAL) private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('deep.gather_inputs')
  async gatherInputs(payload: DeepDreamPayload): Promise<GatherInputsResult> {
    const targetDate = payload.target_date;
    const sourceDateIso = payload.source_date_iso ?? targetDate;

    let dreamId: number;
    try {
      dreamId = await this.dataSource.transaction(async (manager) => {
        const dreamRepo = manager.getRepository(DreamSchema);
        const sixtySecondsAgo = new Date(Date.now() - SEXTY_SECONDS_MS);
        const existing = await dreamRepo
          .createQueryBuilder('d')
          .where('d.type = :type', { type: 'deep' })
          .andWhere('d.created_at >= :cutoff', { cutoff: sixtySecondsAgo })
          .orderBy('d.created_at', 'DESC')
          .limit(1)
          .getOne();
        if (existing !== null) {
          return existing.id;
        }
        const dream = dreamRepo.create({
          type: 'deep',
          trigger: payload.trigger ?? 'auto',
          status: 'processing',
          startedAt: new Date(),
        } satisfies Partial<Dream>);
        const saved = await dreamRepo.save(dream);
        return saved.id;
      });
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_GATHER_INPUTS_FAILED, `gatherInputs DB op failed: ${(err as Error).message}`);
    }

    const vaultRoot = this.config.vaultPath;
    const memoryMd = (await safeReadVault(vaultRoot, 'MEMORY.md')) ?? '';
    const dailyLog = (await safeReadVault(vaultRoot, `dailys/${sourceDateIso}.md`)) ?? '';
    const soulMd = (await safeReadVault(vaultRoot, 'SOUL.md')) ?? '';

    if (memoryMd !== '') {
      await safeWriteVault(vaultRoot, `.backups/MEMORY.md.${sourceDateIso}.bak`, memoryMd);
    }
    if (dailyLog !== '') {
      await safeWriteVault(vaultRoot, `.backups/dailys-${sourceDateIso}.bak`, dailyLog);
    }

    let memuMemories: Array<Record<string, unknown>> = [];
    try {
      const result = await this.memuApi.retrieve(`deep-dream:${sourceDateIso}`);
      memuMemories = result.memories.map((m) => ({ ...m })) as unknown as Array<Record<string, unknown>>;
    } catch (err) {
      this.logger.warn({
        message: 'deep dream gather_inputs memu retrieve failed — continuing with empty list',
        event: 'deepDream.gatherInputs.memuFailed',
        dreamId,
        error: (err as Error).message,
      });
    }

    this.logger.log({
      message: 'deep dream gather_inputs completed',
      event: 'deepDream.gatherInputs.completed',
      dreamId,
      memuMemoriesCount: memuMemories.length,
      memoryMdLines: memoryMd.split('\n').length,
      dailyLogLines: dailyLog.split('\n').length,
      sourceDateIso,
    });

    return {
      dream_id: dreamId,
      memu_memories: memuMemories,
      memory_md: memoryMd,
      daily_log: dailyLog,
      soul_md: soulMd,
      source_date_iso: sourceDateIso,
    };
  }
}
