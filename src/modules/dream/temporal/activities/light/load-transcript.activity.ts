import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { TranscriptSchema } from 'src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from 'src/shared/postgres/schema/dream.schema';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { LoadTranscriptInput, LoadTranscriptResult } from '../../workflows/light-dream.workflow';

@Injectable()
export class LoadTranscriptActivity {
  private readonly logger = new Logger(LoadTranscriptActivity.name);

  constructor(@InjectDataSource(DBConnections.INTERNAL) private readonly dataSource: DataSource) {}

  @TemporalActivity('light.load_transcript')
  async loadTranscript(inp: LoadTranscriptInput): Promise<LoadTranscriptResult> {
    return this.dataSource.transaction(async (manager) => {
      const transcriptRepo = manager.getRepository(TranscriptSchema);
      const dreamRepo = manager.getRepository(DreamSchema);
      const transcript = await transcriptRepo.findOne({ where: { id: inp.transcript_id } });
      if (transcript === null) {
        throw new InternalException(ErrorCode.LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND, `Transcript ${inp.transcript_id} not found`);
      }

      const sixtySecondsAgo = new Date(Date.now() - 60_000);
      const existing = await dreamRepo
        .createQueryBuilder('d')
        .where('d.transcript_id = :tid', { tid: inp.transcript_id })
        .andWhere('d.type = :type', { type: 'light' })
        .andWhere('d.created_at >= :cutoff', { cutoff: sixtySecondsAgo })
        .orderBy('d.created_at', 'DESC')
        .limit(1)
        .getOne();

      let dreamId: number;
      if (existing !== null) {
        dreamId = existing.id;
      } else {
        const dream = dreamRepo.create({
          type: 'light',
          trigger: 'auto',
          status: 'processing',
          transcriptId: inp.transcript_id,
          startedAt: new Date(),
        } satisfies Partial<Dream>);
        const saved = await dreamRepo.save(dream);
        dreamId = saved.id;
        await transcriptRepo.update({ id: inp.transcript_id }, { lightDreamId: dreamId } satisfies Partial<Conversation>);
      }

      this.logger.log({
        message: 'light dream load_transcript completed',
        event: 'lightDream.loadTranscript.completed',
        dreamId,
        transcriptId: inp.transcript_id,
        sessionId: inp.session_id,
      });

      return {
        dream_id: dreamId,
        parsed_text: transcript.parsedText ?? transcript.rawContent ?? '',
        project: transcript.project ?? null,
        token_count: transcript.tokenCount ?? null,
        created_at_iso: transcript.createdAt?.toISOString() ?? null,
        segment_end_line: transcript.segmentEndLine ?? 0,
        is_continuation: transcript.isContinuation ?? false,
      };
    });
  }
}
