import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { TranscriptSchema } from 'src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from 'src/shared/postgres/schema/dream.schema';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { LoadTranscriptInput, LoadTranscriptResult } from '../../workflows/light-dream.workflow';
import { countUserMessages } from './helpers';

@Injectable()
export class LoadTranscriptActivity {
  private readonly logger = new Logger(LoadTranscriptActivity.name);

  constructor(
    @InjectDataSource(DBConnections.INTERNAL) private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  @TemporalActivity('light.load_transcript')
  async loadTranscript(inp: LoadTranscriptInput): Promise<LoadTranscriptResult> {
    if (inp.transcript_id === null) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND, 'transcript_id cannot be null');
    }
    const transcriptId: number = inp.transcript_id;

    const loaded = await this.dataSource.transaction(async (manager) => {
      const transcriptRepo = manager.getRepository(TranscriptSchema);
      const dreamRepo = manager.getRepository(DreamSchema);
      const transcript = await transcriptRepo.findOne({ where: { id: transcriptId } });
      if (transcript === null) {
        throw new InternalException(ErrorCode.LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND, `Transcript ${transcriptId} not found`);
      }

      const sixtySecondsAgo = new Date(Date.now() - 60_000);
      const existing = await dreamRepo
        .createQueryBuilder('d')
        .where('d.transcript_id = :tid', { tid: transcriptId })
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
          transcriptId: transcriptId,
          startedAt: new Date(),
        } satisfies Partial<Dream>);
        const saved = await dreamRepo.save(dream);
        dreamId = saved.id;
        await transcriptRepo.update({ id: transcriptId }, { lightDreamId: dreamId } satisfies Partial<Conversation>);
      }

      return {
        dreamId,
        text: transcript.parsedText ?? transcript.rawContent ?? '',
        project: transcript.project ?? null,
        tokenCount: transcript.tokenCount ?? null,
        createdAtIso: transcript.createdAt?.toISOString() ?? null,
        segmentEndLine: transcript.segmentEndLine ?? 0,
        isContinuation: transcript.isContinuation ?? false,
      };
    });

    const userMessageCount = countUserMessages(loaded.text);

    // Write AFTER the txn commits so a rollback never orphans a file. The
    // transcript file is removed by the post-dream cleanup (T3); a Temporal
    // retry of this activity may still orphan one, which is acceptable.
    const rand = crypto.randomUUID().slice(0, 8);
    const fileName = `${transcriptId}_${rand}.txt`;
    const relPath = `transcripts/${fileName}`;
    const absPath = path.join(this.config.vaultPath, 'transcripts', fileName);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, loaded.text, 'utf-8');

    this.logger.log({
      message: 'light dream load_transcript completed',
      event: 'lightDream.loadTranscript.completed',
      dreamId: loaded.dreamId,
      transcriptId: inp.transcript_id,
      sessionId: inp.session_id,
      transcriptFile: relPath,
      userMessageCount,
    });

    return {
      dream_id: loaded.dreamId,
      transcript_file: relPath,
      user_message_count: userMessageCount,
      project: loaded.project,
      token_count: loaded.tokenCount,
      created_at_iso: loaded.createdAtIso,
      segment_end_line: loaded.segmentEndLine,
      is_continuation: loaded.isContinuation,
    };
  }
}
