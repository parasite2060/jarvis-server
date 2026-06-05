# TC-01: Infrastructure & Health Checks

Manual smoke tests for the jarvis-server-ts critical path using API mock infrastructure.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running (postgres :5433, redis :6380, temporal :7234+8234, api-mock :11435)
- [ ] jarvis-server is accessible on port 3000 (or configured PORT)
- [ ] API_KEY is known (`jarvis-e2e-test-key` from `.env.e2e`)
- [ ] `bun run test:e2e` completed successfully (20/21 suites, 102/103 tests) — confirms infra is healthy

---

### TC-01-01: GET /health — all indicators up
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — GET /health

**Preconditions**:
- [ ] `docker-compose.e2e.yml` services all healthy (postgres, redis, temporal)
- [ ] jarvis-server is running on localhost:3000

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/health`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response is JSON — verify: `echo $RESP | python3 -c "import sys,json; json.load(sys.stdin)"`
- [ ] CP3: `application` indicator present — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'application' in d else 'missing')"`
- [ ] CP4: `postgres` indicator status is `up` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['application']['details']['postgres']['status'])"`
- [ ] CP5: `temporal` indicator status is `up` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['application']['details']['temporal']['status'])"`
- [ ] CP6: No `error` key at top level — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_error' if 'error' in d else 'clean')"`

**Cleanup**: None (read-only health check)

---

### TC-01-02: POST /dream — 202 + queued status
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /dream

**Preconditions**:
- [ ] jarvis-server running on localhost:3000
- [ ] Temporal namespace `jarvis` exists (started by docker-compose)
- [ ] Vault path seeded at `/tmp/jarvis-e2e-vault` (auto-seeded by E2ETestSetup on first test run)

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{}' http://localhost:3000/dream`

**Checkpoints**:
- [ ] CP1: HTTP status is 202 — verify: output contains `HTTP_STATUS:202`
- [ ] CP2: Response is JSON — verify: parses without error
- [ ] CP3: `code` is `SUCCESS` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code'))"`
- [ ] CP4: `data.status` is `queued` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status'))"`
- [ ] CP5: `data.dreamId` is a positive integer — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); i=d.get('data',{}).get('dreamId'); print('valid' if isinstance(i,int) and i>0 else 'invalid')"`

**Cleanup**: None (creates DB row — acceptable for smoke test)

---

### TC-01-03: POST /dream with sourceDate — submitDeep signal
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /dream with sourceDate

**Preconditions**:
- [ ] jarvis-server running on localhost:3000
- [ ] Temporal coordinator workflow can be signaled

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sourceDate":"2026-04-20"}' http://localhost:3000/dream`

**Checkpoints**:
- [ ] CP1: HTTP status is 202 — verify: output contains `HTTP_STATUS:202`
- [ ] CP2: Response `data.trigger` is `manual-backfill` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('trigger'))"`
- [ ] CP3: Response `data.source_date_iso` is `2026-04-20` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('source_date_iso'))"`
- [ ] CP4: Response `data.target_date` is `2026-04-20` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('target_date'))"`

**Cleanup**: None

---

### TC-01-04: POST /dream with invalid sourceDate — 400
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /dream validation

**Preconditions**:
- [ ] jarvis-server running on localhost:3000

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sourceDate":"not-a-date"}' http://localhost:3000/dream`

**Checkpoints**:
- [ ] CP1: HTTP status is 400 — verify: output contains `HTTP_STATUS:400`
- [ ] CP2: Response has `code` field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_code' if 'code' in d else 'missing')"`
- [ ] CP3: `data.message` or `message` mentions `sourceDate` or `date` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); m=str(d.get('data',{}).get('message',''))+str(d.get('message','')); print('mentions_date' if 'date' in m.lower() else 'no_date_ref')"`

**Cleanup**: None

---

### TC-01-05: POST /conversations — ingest + dedup
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /conversations

**Preconditions**:
- [ ] jarvis-server running on localhost:3000
- [ ] No existing transcript for session_id `tc-01-05-manual` (verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.transcripts WHERE session_id='tc-01-05-manual'"` returns 0)

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{
     "session_id": "tc-01-05-manual",
     "messages": [
       {"role":"user","content":"Hello from manual test"},
       {"role":"assistant","content":"Hello! How can I help?"}
     ]
   }' http://localhost:3000/conversations`
2. `sleep 2`
3. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{
     "session_id": "tc-01-05-manual",
     "messages": [
       {"role":"user","content":"Hello from manual test — duplicate"}
     ]
   }' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: First request returns 201 — verify: first output contains `HTTP_STATUS:201`
- [ ] CP2: First response has `transcriptId` — verify: first response JSON has `data.transcriptId`
- [ ] CP3: Second request (duplicate) returns 200 — verify: second output contains `HTTP_STATUS:200`
- [ ] CP4: Second response has `duplicate: true` — verify: `echo $RESP2 | python3 -c "import sys,json; d=json.load(sys.stdin); print('dup' if d.get('data',{}).get('duplicate') else 'not_dup')"`
- [ ] CP5: Exactly 1 transcript row exists — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.transcripts WHERE session_id='tc-01-05-manual'"` returns 1

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id='tc-01-05-manual';"
```

---

### TC-01-06: GET /memory/context — 200 + structure
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — GET /memory/context

**Preconditions**:
- [ ] jarvis-server running on localhost:3000

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/context`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response is JSON — verify: parses without error
- [ ] CP3: Response has `soul` key — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_soul' if 'soul' in d else 'missing')"`
- [ ] CP4: Response has `identity` key — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_identity' if 'identity' in d else 'missing')"`
- [ ] CP5: Response has `memory` key — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_memory' if 'memory' in d else 'missing')"`
- [ ] CP6: Response has `recentDailys` key — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_recentDailys' if 'recentDailys' in d else 'missing')"`

**Cleanup**: None (read-only)

---

### TC-01-07: Error envelope — flat shape, correct fields
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — Error envelope flat shape

**Preconditions**:
- [ ] jarvis-server running on localhost:3000

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X GET -H "Authorization: Bearer $API_KEY" http://localhost:3000/nonexistent-route`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{}' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: Unknown route returns JSON — verify: `echo $RESP1 | python3 -c "import sys,json; json.load(sys.stdin)"`
- [ ] CP2: Unknown route has `code` field (not nested) — verify: `echo $RESP1 | python3 -c "import sys,json; d=json.load(sys.stdin); print('flat' if 'code' in d and 'error' not in d else 'nested')"`
- [ ] CP3: Validation error has `code` field — verify: second response parses as JSON and has `code`
- [ ] CP4: Error responses do NOT contain stack traces — verify: `echo $RESP1 $RESP2 | grep -ci "traceback\|at .*\.py\|at .*\.ts" | awk '{print ($1==0?"clean":"leaks_info")}'`

**Cleanup**: None

---

### TC-01-08: POST /dream deep pipeline — phases rows created
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /dream temporal deep spec

**Preconditions**:
- [ ] jarvis-server running on localhost:3000
- [ ] Temporal worker can execute workflows
- [ ] API mock registered with phase stubs (phase1Stub, phase2Stub, phase3Stub, healthFixStub)

**Steps**:
1. Register LLM stubs via api-mock control API on :11435
2. `curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sourceDate":"2026-05-08"}' http://localhost:3000/dream`
3. Poll dream status: `sleep 30 && psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT status FROM jarvis.dreams WHERE id=<dreamId> ORDER BY created_at DESC LIMIT 1;"`
4. Check phases: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT phase, status FROM jarvis.dream_phases WHERE dream_id=<dreamId> ORDER BY phase;"`

**Checkpoints**:
- [ ] CP1: Dream row created with status `queued` or `processing` — verify: initial POST returns 202 with dreamId
- [ ] CP2: After 60s, dream status is `completed` — verify: status query returns `completed`
- [ ] CP3: At least 3 phase rows exist — verify: count query returns ≥ 3
- [ ] CP4: All phase rows have status `completed` — verify: no `failed` or `pending` phases
- [ ] CP5: Phase sequence includes phase1, phase2, phase3 — verify: phases are `phase_1`, `phase_2`, `phase_3` or similar

**Cleanup**:
```bash
DREAM_ID=$(psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT id FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1;")
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dream_phases WHERE dream_id=$DREAM_ID;"
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dreams WHERE id=$DREAM_ID;"
```

---

### TC-01-09: POST /dream light pipeline — daily log updated
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — Light dream E2E

**Preconditions**:
- [ ] jarvis-server running on localhost:3000
- [ ] Vault has seeded dailys at `/tmp/jarvis-e2e-vault/dailys/`

**Steps**:
1. `curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"type":"light"}' http://localhost:3000/dream`
2. `sleep 60`
3. Check dream status: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT status FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1;"`

**Checkpoints**:
- [ ] CP1: POST returns 202 — verify: HTTP 202
- [ ] CP2: After 90s, dream status is `completed` — verify: status query returns `completed`
- [ ] CP3: Dream `type` is `light` — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT type FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1;"` returns `light`
- [ ] CP4: At least 1 daily log was created/updated in vault — verify: `ls /tmp/jarvis-e2e-vault/dailys/*.md | wc -l` > 0

**Cleanup**:
```bash
DREAM_ID=$(psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT id FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1;")
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dream_phases WHERE dream_id=$DREAM_ID;"
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dreams WHERE id=$DREAM_ID;"
```

---

### TC-01-10: Vault manifest — file serving + structure
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Vault manifest + file serving

**Preconditions**:
- [ ] jarvis-server running on localhost:3000
- [ ] Vault at `/tmp/jarvis-e2e-vault` has seed files (SOUL.md, IDENTITY.md, MEMORY.md, config.yml)

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/vault/manifest`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/vault/file/SOUL.md`
3. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/vault/file/MEMORY.md`

**Checkpoints**:
- [ ] CP1: Manifest returns 200 — verify: HTTP 200
- [ ] CP2: Manifest is JSON array — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('array' if isinstance(d,list) else 'not_array')"`
- [ ] CP3: Manifest entries have `path` field — verify: first entry has `path` key
- [ ] CP4: SOUL.md returns 200 — verify: HTTP 200
- [ ] CP5: SOUL.md content starts with `---` (frontmatter) — verify: first line is `---`
- [ ] CP6: MEMORY.md returns 200 — verify: HTTP 200
- [ ] CP7: Path traversal blocked — verify: `curl -s -w "%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/vault/file/../config.yml` returns 400 or 403

**Cleanup**: None

---

### TC-01-11: Memory search — REMOVED (2026-06-04)
`POST /memory/search` and `GET /memory/recent` were removed together with MemU.
Those endpoints now return **404**. This case is retired.