import { EntitySchema } from 'typeorm';
import { Dream } from 'src/shared/domain/entities/dream.entity';

/**
 * `jarvis.dreams` schema (Story 13.2 / Task 4).
 *
 * Mirrors `Dream` in `components/jarvis-server/app/models/tables.py`. `outcome`
 * is plain `varchar(30)` — no DB-level enum / CHECK constraint (Python uses
 * `String(30)`; the `DREAM_OUTCOMES` constants tuple is enforced in app code).
 *
 * FK `transcript_id → jarvis.transcripts.id` is added in the migration via
 * `ALTER TABLE ADD CONSTRAINT` to avoid the circular-FK ordering hazard with
 * `transcripts.light_dream_id`.
 */
export const DreamSchema = new EntitySchema<Dream>({
  name: 'Dream',
  schema: 'jarvis',
  tableName: 'dreams',
  columns: {
    id: {
      type: 'integer',
      primary: true,
      generated: 'increment',
    },
    type: {
      name: 'type',
      type: 'varchar',
      length: 20,
      nullable: false,
    },
    trigger: {
      name: 'trigger',
      type: 'varchar',
      length: 20,
      nullable: false,
    },
    status: {
      name: 'status',
      type: 'varchar',
      length: 50,
      nullable: false,
      default: 'queued',
    },
    outcome: {
      name: 'outcome',
      type: 'varchar',
      length: 30,
      nullable: true,
    },
    transcriptId: {
      name: 'transcript_id',
      type: 'integer',
      nullable: true,
    },
    inputSummary: {
      name: 'input_summary',
      type: 'text',
      nullable: true,
    },
    outputRaw: {
      name: 'output_raw',
      type: 'text',
      nullable: true,
    },
    sessionLog: {
      name: 'session_log',
      type: 'jsonb',
      nullable: true,
    },
    filesModified: {
      name: 'files_modified',
      type: 'jsonb',
      nullable: true,
    },
    gitBranch: {
      name: 'git_branch',
      type: 'varchar',
      length: 255,
      nullable: true,
    },
    gitPrUrl: {
      name: 'git_pr_url',
      type: 'varchar',
      length: 500,
      nullable: true,
    },
    gitPrStatus: {
      name: 'git_pr_status',
      type: 'varchar',
      length: 50,
      nullable: true,
    },
    inputTokens: {
      name: 'input_tokens',
      type: 'integer',
      nullable: true,
    },
    outputTokens: {
      name: 'output_tokens',
      type: 'integer',
      nullable: true,
    },
    totalTokens: {
      name: 'total_tokens',
      type: 'integer',
      nullable: true,
    },
    toolCalls: {
      name: 'tool_calls',
      type: 'integer',
      nullable: true,
    },
    errorMessage: {
      name: 'error_message',
      type: 'text',
      nullable: true,
    },
    durationMs: {
      name: 'duration_ms',
      type: 'integer',
      nullable: true,
    },
    startedAt: {
      name: 'started_at',
      type: 'timestamp with time zone',
      nullable: true,
    },
    completedAt: {
      name: 'completed_at',
      type: 'timestamp with time zone',
      nullable: true,
    },
    createdAt: {
      name: 'created_at',
      type: 'timestamp with time zone',
      createDate: true,
    },
  },
  indices: [
    { name: 'ix_dreams_type', columns: ['type'] },
    { name: 'ix_dreams_status', columns: ['status'] },
    { name: 'ix_dreams_created_at', columns: ['createdAt'] },
  ],
});
