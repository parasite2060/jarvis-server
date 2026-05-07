-- E2E Postgres init script (Story 13.2).
--
-- Pre-creates the `jarvis` schema and enables the `pgvector` extension so the
-- boilerplate's `synchronize: true` (e2e env) can place schema-qualified
-- entities (Conversation, Dream, DreamPhase, FileManifestEntry, ContextCache)
-- without the schema-missing error. Production uses TypeORM migrations and
-- creates the schema explicitly in `0001-init-jarvis.ts`; this file exists
-- only for the e2e harness.
CREATE SCHEMA IF NOT EXISTS "jarvis";
CREATE EXTENSION IF NOT EXISTS vector;
