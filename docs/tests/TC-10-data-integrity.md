# TC-10: Data Integrity — Dreams, Transcripts, File Manifest Tables

Verifies data integrity in Postgres: FK constraints, autoincrement IDs, JSONB fields, timestamp behavior.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running (postgres :5433)
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key
- [ ] Database is clean or known state

---

### TC-10-01: dreams table — autoincrement id and status default
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — Dream repository

**Preconditions**: None

**Steps**:
1. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='dreams' AND table_schema='jarvis' ORDER BY ordinal_position;"`

**Checkpoints**:
- [ ] CP1: `id` is `bigint` or `integer` with autoincrement — verify: `id` has nextval or serial
- [ ] CP2: `status` has a default value (`queued`) — verify: column_default contains `queued` or `nextval`
- [ ] CP3: `created_at` is NOT NULL — verify: is_nullable = NO
- [ ] CP4: `updated_at` is NOT NULL — verify: is_nullable = NO
- [ ] CP5: `source_date_iso` is `date` type — verify: data_type = `date`

**Cleanup**: None

---

### TC-10-02: dream_phases table — FK to dreams, phase uniqueness
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] A completed deep dream exists in DB (or run TC-09-04 first)

**Steps**:
1. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='dream_phases' AND table_schema='jarvis' ORDER BY ordinal_position;"`
2. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "SELECT conname, conrelid::regclass, confrelid::regclass FROM pg_constraint WHERE conrelid::regclass = 'jarvis.dream_phases'::regclass AND contype = 'f';"`

**Checkpoints**:
- [ ] CP1: `dream_id` is FK to `dreams.id` — verify: foreign key constraint exists
- [ ] CP2: `phase` is `varchar` or `text` — verify: data_type
- [ ] CP3: `status` column exists — verify: column present
- [ ] CP4: `token_count` is `integer` — verify: data_type
- [ ] CP5: Unique constraint on (dream_id, phase) — verify: `SELECT conname FROM pg_constraint WHERE conrelid::regclass='jarvis.dream_phases'::regclass AND contype='u'`

**Cleanup**: None

---

### TC-10-03: transcripts table — dedup window constraint
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — Conversation dedup

**Preconditions**:
- [ ] Clean transcripts table: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id LIKE 'tc-10%';"`

**Steps**:
1. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='transcripts' AND table_schema='jarvis' ORDER BY ordinal_position;"`
2. Insert test row:
   `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "INSERT INTO jarvis.transcripts (session_id, transcript, source, last_line) VALUES ('tc-10-03', 'test transcript', 'manual-test', 10);"`
3. Check: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT session_id, last_line FROM jarvis.transcripts WHERE session_id='tc-10-03';"

**Checkpoints**- [ ] CP1: `session_id` is `varchar` and NOT NULL — verify: data_type and is_nullable
- [ ] CP2: `transcript` is `text` (not varchar, supports large content) — verify: data_type = `text`
- [ ] CP3: Row inserted successfully — verify: select returns 1 row
- [ ] CP4: `last_line` is integer ≥ 0 — verify: value is non-negative integer

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id='tc-10-03';"
```

---

### TC-10-04: file_manifest table — path unique constraint, sync diff
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — File manifest repository

**Preconditions**:
- [ ] Vault has at least one file in manifest

**Steps**:
1. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='file_manifest' AND table_schema='jarvis' ORDER BY ordinal_position;"`
2. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "SELECT count(*) FROM jarvis.file_manifest;"`
3. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "SELECT path, hash, size FROM jarvis.file_manifest LIMIT 5;"`

**Checkpoints**:
- [ ] CP1: `path` column has unique constraint — verify: `SELECT conname FROM pg_constraint WHERE conrelid::regclass='jarvis.file_manifest'::regclass AND contype='u'`
- [ ] CP2: At least 1 file manifest entry exists — verify: count > 0
- [ ] CP3: Each entry has `path`, `hash`, `size` — verify: columns present
- [ ] CP4: `hash` is non-empty for real entries — verify: no empty hashes

**Cleanup**: None

---

### TC-10-05: dreams.jsonb field — outcome stored and retrieved identically
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Dream repository JSONB

**Preconditions**:
- [ ] A completed dream with outcome JSON exists

**Steps**:
1. Find a dream with outcome: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT id, outcome FROM jarvis.dreams WHERE outcome IS NOT NULL ORDER BY created_at DESC LIMIT 1;"`
2. Parse as JSON: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT jsonb_pretty(outcome) FROM jarvis.dreams WHERE outcome IS NOT NULL ORDER BY created_at DESC LIMIT 1;"`

**Checkpoints**:
- [ ] CP1: `outcome` is valid JSONB — verify: `SELECT jsonb_pretty(outcome) FROM jarvis.dreams WHERE outcome IS NOT NULL LIMIT 1` succeeds
- [ ] CP2: Outcome has expected structure keys — verify: parsed JSON has `phases` or `status` or similar
- [ ] CP3: JSON round-trip preserves data — verify: no truncation, no escaped issues

**Cleanup**: None

---

### TC-10-06: FK constraint — invalid dream_id in dream_phases fails
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Data Integrity

**Preconditions**: None

**Steps**:
1. Attempt invalid FK insert: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "INSERT INTO jarvis.dream_phases (dream_id, phase, status) VALUES (999999, 'phase_test', 'pending');" 2>&1`

**Checkpoints**:
- [ ] CP1: Insert fails with FK violation — verify: error contains `violates foreign key` or `dream_id` or `999999`
- [ ] CP2: Error is clean Postgres error (not crash) — verify: no JavaScript stack trace in output

**Cleanup**: None (insert was rejected)

---

### TC-10-07: Concurrent transcript inserts — only one wins for same session within dedup window
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Concurrency

**Preconditions**:
- [ ] No existing transcript for session_id `tc-10-07`

**Steps**:
1. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "INSERT INTO jarvis.transcripts (session_id, transcript, source, last_line) VALUES ('tc-10-07', 'first write', 'test', 1);" &`
2. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "INSERT INTO jarvis.transcripts (session_id, transcript, source, last_line) VALUES ('tc-10-07', 'second write', 'test', 2);" &`
3. Wait: `sleep 2`
4. Check: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.transcripts WHERE session_id='tc-10-07';"`

**Checkpoints**:
- [ ] CP1: Only 1 row exists after concurrent inserts — verify: count = 1 (dedup window)
- [ ] CP2: The row has last_line matching one of the inserts — verify: last_line is 1 or 2
- [ ] CP3: No partial or corrupted rows — verify: query succeeds cleanly

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id='tc-10-07';"
```