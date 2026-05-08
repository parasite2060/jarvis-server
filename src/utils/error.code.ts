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
  // Context block (Story 13.5 placeholder removed in 13.6 / Q9 to free this range);
  // future Context ErrorCodes allocate at -400141..-400160 if needed.
}
