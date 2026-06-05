import { EntitySchema } from 'typeorm';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';

/**
 * `jarvis.transcripts` schema (Story 13.2 / Task 4).
 *
 * Mirrors `Transcript` in `components/jarvis-server/app/models/tables.py`.
 * Entity name `Conversation` (module-map §3.1); table name `transcripts`.
 *
 * FKs are NOT declared here — `transcripts.light_dream_id` and
 * `dreams.transcript_id` form a circular dependency that the migration
 * resolves with post-table `ALTER TABLE ADD CONSTRAINT` (see
 * `migration/0001-init-jarvis.ts`). Schema files stay FK-free to avoid
 * non-deterministic TypeORM relations behaviour.
 */
export const TranscriptSchema = new EntitySchema<Conversation>({
  name: 'Conversation',
  schema: 'jarvis',
  tableName: 'transcripts',
  columns: {
    id: {
      type: 'integer',
      primary: true,
      generated: 'increment',
    },
    sessionId: {
      name: 'session_id',
      type: 'varchar',
      length: 255,
      nullable: false,
    },
    project: {
      name: 'project',
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    rawContent: {
      name: 'raw_content',
      type: 'text',
      nullable: false,
    },
    parsedText: {
      name: 'parsed_text',
      type: 'text',
      nullable: true,
    },
    tokenCount: {
      name: 'token_count',
      type: 'integer',
      nullable: true,
    },
    source: {
      name: 'source',
      type: 'varchar',
      length: 50,
      nullable: true,
    },
    status: {
      name: 'status',
      type: 'varchar',
      length: 50,
      nullable: false,
      default: 'received',
    },
    lightDreamId: {
      name: 'light_dream_id',
      type: 'integer',
      nullable: true,
    },
    isContinuation: {
      name: 'is_continuation',
      type: 'boolean',
      nullable: false,
      default: false,
    },
    segmentStartLine: {
      name: 'segment_start_line',
      type: 'integer',
      nullable: false,
      default: 0,
    },
    segmentEndLine: {
      name: 'segment_end_line',
      type: 'integer',
      nullable: false,
      default: 0,
    },
    lastProcessedLine: {
      name: 'last_processed_line',
      type: 'integer',
      nullable: false,
      default: 0,
    },
    createdAt: {
      name: 'created_at',
      type: 'timestamp with time zone',
      createDate: true,
    },
    updatedAt: {
      name: 'updated_at',
      type: 'timestamp with time zone',
      updateDate: true,
    },
  },
  indices: [
    { name: 'ix_transcripts_session_id', columns: ['sessionId'] },
    { name: 'ix_transcripts_status', columns: ['status'] },
    { name: 'ix_transcripts_created_at', columns: ['createdAt'] },
    { name: 'ix_transcripts_session_source', columns: ['sessionId', 'source'] },
  ],
});
