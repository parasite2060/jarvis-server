import { EntitySchema } from 'typeorm';
import { DreamPhase } from 'src/shared/domain/entities/dream-phase.entity';

/**
 * `jarvis.dream_phases` schema (Story 13.2 / Task 4).
 *
 * Mirrors `DreamPhase` in `components/jarvis-server/app/models/tables.py`.
 * FK `dream_id → jarvis.dreams.id` is added in the migration via
 * `ALTER TABLE ADD CONSTRAINT` (consistent with the other inter-table FKs).
 */
export const DreamPhaseSchema = new EntitySchema<DreamPhase>({
  name: 'DreamPhase',
  schema: 'jarvis',
  tableName: 'dream_phases',
  columns: {
    id: {
      type: 'integer',
      primary: true,
      generated: 'increment',
    },
    dreamId: {
      name: 'dream_id',
      type: 'integer',
      nullable: false,
    },
    phase: {
      name: 'phase',
      type: 'varchar',
      length: 50,
      nullable: false,
    },
    status: {
      name: 'status',
      type: 'varchar',
      length: 50,
      nullable: false,
      default: 'processing',
    },
    runPrompt: {
      name: 'run_prompt',
      type: 'text',
      nullable: true,
    },
    outputJson: {
      name: 'output_json',
      type: 'jsonb',
      nullable: true,
    },
    conversationHistory: {
      name: 'conversation_history',
      type: 'jsonb',
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
    errorMessage: {
      name: 'error_message',
      type: 'text',
      nullable: true,
    },
    createdAt: {
      name: 'created_at',
      type: 'timestamp with time zone',
      createDate: true,
    },
  },
  indices: [
    { name: 'ix_dream_phases_dream_id', columns: ['dreamId'] },
    { name: 'ix_dream_phases_phase', columns: ['phase'] },
  ],
});
