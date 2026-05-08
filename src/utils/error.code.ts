export enum ErrorCode {
  UNKNOWN = -999999,
  UNAUTHORIZED = -888888,
  VALIDATION_FAILED = -777777,
  SUCCESS = 1,

  // Blog Module (-400001 to -400020)
  BLOG_NOT_FOUND = -400001,
  BLOG_TITLE_INVALID = -400002,
  BLOG_CONTENT_INVALID = -400003,
  BLOG_AUTHOR_INVALID = -400004,
  BLOG_PAGE_INVALID = -400005,
  BLOG_LIMIT_INVALID = -400006,

  // Comment Module (-400021 to -400040)
  COMMENT_NOT_FOUND = -400021,
  COMMENT_CONTENT_INVALID = -400022,
  COMMENT_BLOG_ID_INVALID = -400023,
  COMMENT_BLOG_NOT_FOUND = -400024,
  COMMENT_AUTHOR_INVALID = -400025,
  COMMENT_PAGE_INVALID = -400026,
  COMMENT_LIMIT_INVALID = -400027,

  // AuditLog Module (-400041 to -400060)
  AUDIT_LOG_NOT_FOUND = -400041,
  AUDIT_LOG_EVENT_CODE_INVALID = -400042,
  AUDIT_LOG_PAGE_INVALID = -400043,
  AUDIT_LOG_LIMIT_INVALID = -400044,

  // Conversation Module (-400061 to -400080)
  // Slot -400061 reserved for the ConversationIngested domain event code
  // (Story 13.3 / Q7); validation slots start at -400062.
  CONVERSATION_INGESTED = -400061,
  CONVERSATION_SESSION_ID_INVALID = -400062,
  CONVERSATION_TRANSCRIPT_INVALID = -400063,
  CONVERSATION_SOURCE_INVALID = -400064,
  CONVERSATION_SEGMENT_START_INVALID = -400065,
  CONVERSATION_SEGMENT_END_INVALID = -400066,

  // Memory Module + Memu API + Vault read errors (-400081 to -400100)
  MEMORY_QUERY_INVALID = -400081,
  MEMORY_METHOD_INVALID = -400082,
  MEMORY_CONTENT_INVALID = -400083,
  MEMORY_METADATA_INVALID = -400084,
  MEMU_UNAVAILABLE = -400085,
  MEMU_ERROR = -400086,
  VAULT_FILE_NOT_FOUND = -400087,
  VAULT_PATH_TRAVERSAL = -400088,

  // Vault Module (-400101 to -400120) — Story 13.6.
  // Note: Story 13.4's MEMORY-context VAULT_FILE_NOT_FOUND (-400087) and
  // VAULT_PATH_TRAVERSAL (-400088) STAY in the Memory block — thrown by
  // GetSoul/GetIdentity/GetMemoryFile use cases. The codes below are
  // VAULT-context, thrown by manifest + file-by-path endpoints. Acceptable
  // duplication: the codes encode WHICH endpoint failed (HTTP status differs
  // for the path-traversal case — Memory block returns 403, Vault endpoint
  // returns 400 per Python `files.py:91-101`). Distinct enum identifiers
  // (`VAULT_ENDPOINT_*` vs `VAULT_*`) avoid TS duplicate-name compile errors
  // while preserving the leader's slot allocation.
  VAULT_ENDPOINT_FILE_NOT_FOUND = -400101, // HTTP 404 — GET /memory/files/*path missing
  VAULT_ENDPOINT_PATH_TRAVERSAL = -400102, // HTTP 400 — GET /memory/files/*path traversal
  VAULT_MANIFEST_FAILED = -400103, // HTTP 500 — manifest walk failure (rare)
  VAULT_FILE_READ_FAILED = -400104, // HTTP 500 — read failure after path validation

  // GitOps Shared Service (-400121 to -400140) — Story 13.7.
  // Slots reserved for shared git operations (vault repo). Errors here are
  // thrown from src/shared/git/git-ops.service.ts and consumed by dream
  // activities (Stories 13.10/13.11/13.12) — they map to dream_phases
  // outcome 'failed' or 'partial' per design/git-ops.md §5.3.
  GIT_OPS_PULL_NON_FF = -400121, // pull --ff-only divergence (rare; activity retries)
  GIT_OPS_BRANCH_NAME_INVALID = -400122, // defensive — caller passed an invalid name
  GIT_OPS_REBASE_CONFLICT = -400123, // non-FF push rebase produced conflicts (terminal for the dream)
  GIT_OPS_PUSH_FAILED = -400124, // push failed for non-recoverable reason
  GIT_OPS_FORBIDDEN_TRAILER = -400125, // commit message contained Co-Authored-By: Claude/AI line
  GIT_OPS_PR_CREATION_FAILED = -400126, // gh pr create failed for non-idempotent reason
  GIT_OPS_GH_CLI_MISSING = -400127, // gh binary not found on PATH (ENOENT)
  GIT_OPS_VAULT_PATH_INVALID = -400128, // appConfig.vaultPath does not exist or is not a git working tree
  // Slots -400129..-400140 reserved.

  // Temporal Shared Service (-400141 to -400160) — Story 13.8.
  // Errors thrown from src/shared/temporal/{temporal-client,temporal-worker}.service.ts.
  // Surface examples: signal-failed → IngestTranscriptUseCase soft-fail (Story 13.3);
  // worker-start-failed → main.ts bootstrap process.exit(1).
  TEMPORAL_CONNECTION_FAILED = -400141, // Client.connect failed (network/DNS)
  TEMPORAL_WORKFLOW_START_FAILED = -400142, // client.workflow.start non-idempotent failure
  TEMPORAL_SIGNAL_FAILED = -400143, // handle.signal RPC error
  TEMPORAL_WORKER_START_FAILED = -400144, // Worker.create threw
  TEMPORAL_WORKER_NOT_BOOTED = -400145, // defensive: method needs worker before start()
  TEMPORAL_SCHEDULE_REGISTRATION_FAILED = -400146, // Story 13.13 surface (reserved here)
  // -400147..-400160 reserved.

  // Light Dream Pipeline (-400161 to -400170) — Story 13.10 / Q9.
  // Per-story sub-block split (Q9.b RESOLVED 2026-05-08) — keeps each pipeline's
  // codes contiguous for ownership clarity. -400171..-400180 reserved for
  // Deep Dream (Story 13.11), -400181..-400190 for Weekly Review (Story 13.12),
  // -400191..-400200 for Chaos/Cutover (Story 13.16).
  //
  // Slot -400170 re-allocated 2026-05-08 (Addendum 1) from
  // `DREAM_PROMPT_LOAD_FAILED` to `LLM_PROVIDER_CONFIG_INVALID` per
  // team-lead instruction. `DREAM_PROMPT_LOAD_FAILED` moves into the
  // shared agents block at -400201..-400210 (NEW reservation; documented
  // in Dev Notes — this expands beyond the original -400200 ceiling
  // because shared infrastructure errors don't fit a per-pipeline split).
  LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND = -400161, // transcript_id not in DB; non-retryable
  LIGHT_DREAM_EXTRACTION_AGENT_FAILED = -400162, // extraction agent threw after retries
  LIGHT_DREAM_EXTRACTION_OUTPUT_INVALID = -400163, // Zod validation of `ExtractionSummary` failed after `output_retries=3`
  LIGHT_DREAM_RECORD_AGENT_FAILED = -400164, // record agent threw after retries — caught by workflow, marks `partial`
  LIGHT_DREAM_PERSIST_SESSION_LOG_FAILED = -400165, // DB UPDATE on `dreams.session_log` failed
  LIGHT_DREAM_COMMIT_AND_PR_FAILED = -400166, // any of branch/commit/push/PR steps failed terminally
  LIGHT_DREAM_INVALIDATE_CACHE_FAILED = -400167, // CommandBus dispatch threw
  LIGHT_DREAM_UPDATE_POSITION_FAILED = -400168, // transcript update failed
  LIGHT_DREAM_VAULT_WRITE_DENIED = -400169, // record agent's `writeFile` tool received a path outside the glob — should be impossible; defensive
  LLM_PROVIDER_CONFIG_INVALID = -400170, // DeepAgentFactory built with provider whose required env vars are missing/empty (Addendum 1)

  // Deep Dream Pipeline (-400171 to -400180) — Story 13.11 / Q12.
  // Phase 2 has no ErrorCode because it soft-fails internally (returns
  // `output_json: null` on any exception) and never raises out of the
  // activity; the workflow has no failure path for it.
  // Reserve -400181..-400190 for Weekly Review (Story 13.12),
  // -400191..-400200 for Chaos/Cutover (Story 13.16).
  DEEP_DREAM_GATHER_INPUTS_FAILED = -400171,
  DEEP_DREAM_PHASE1_AGENT_FAILED = -400172,
  DEEP_DREAM_PHASE1_OUTPUT_INVALID = -400173,
  DEEP_DREAM_SCORING_FAILED = -400174,
  DEEP_DREAM_PHASE3_AGENT_FAILED = -400175,
  DEEP_DREAM_PHASE3_OUTPUT_INVALID = -400176,
  DEEP_DREAM_HEALTH_FIX_AGENT_FAILED = -400177,
  DEEP_DREAM_WRITE_FILES_FAILED = -400178,
  DEEP_DREAM_COMMIT_AND_PR_FAILED = -400179,
  DEEP_DREAM_ALIGN_MEMU_FAILED = -400180,

  // Weekly Review Pipeline (-400181 to -400190) — Story 13.12 / Q9.
  // Per-pipeline sub-block split (Q9.b RESOLVED 2026-05-08, inherited from
  // 13.10/13.11). Reserve -400191..-400200 for Story 13.16 (Chaos/Cutover).
  // Slot allocations per Q9 leader resolution:
  WEEKLY_REVIEW_GATHER_DAILYS_EMPTY_WEEK = -400181, // non-retryable per Q5
  WEEKLY_REVIEW_GATHER_INDEXES_FAILED = -400182,
  WEEKLY_REVIEW_AGENT_FAILED = -400183,
  WEEKLY_REVIEW_OUTPUT_INVALID = -400184, // Zod validation after output_retries exhaustion
  WEEKLY_REVIEW_WRITE_FILE_FAILED = -400185,
  WEEKLY_REVIEW_COMMIT_AND_PR_FAILED = -400186,
  WEEKLY_REVIEW_INVALIDATE_CACHE_FAILED = -400187, // Q3 — TS-only enhancement
  WEEKLY_REVIEW_OUTCOME_UPDATE_FAILED = -400188, // Q8 — TS-only enhancement
  // Slots -400189..-400190 reserved.

  // Shared Agents Infrastructure (-400201 to -400210) — Story 13.10.
  // Cross-pipeline errors thrown by `src/shared/agents/`. Sits OUTSIDE the
  // -400191..-400200 chaos/cutover band per Q9.b sub-blocks; -400201..-400210
  // reserved exclusively for shared agents.
  DREAM_PROMPT_LOAD_FAILED = -400201, // prompt file not found at boot — `PromptCacheService` failure

  // Config business module (-400221 to -400240) — Story 13.13 (Q5 RESOLVED).
  // `src/modules/config/` errors: validation, file IO, YAML parse failures.
  CONFIG_VALIDATION_FAILED = -400221, // empty body, no fields to update
  CONFIG_FILE_NOT_FOUND = -400222, // config.yml absent at vault path (defensive — falls back to defaults silently)
  CONFIG_FILE_PARSE_FAILED = -400223, // config.yml YAML parse failed (defensive — falls back to defaults silently)
  CONFIG_FILE_WRITE_FAILED = -400224, // atomic temp+rename write failed
  CONFIG_CRON_INVALID = -400225, // cron expression invalid per cron-parser
  // Slots -400226..-400240 reserved.
}
