# TC-03: Conversation Module — POST /conversations + GET /conversations/position

Comprehensive coverage of conversation ingest, dedup, and position tracking.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running (postgres :5433)
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key
- [ ] No prior transcripts for session_ids used in this TC

---

### TC-03-01: POST /conversations — happy path, new session, 202
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /conversations ingest + dedup

**Preconditions**:
- [ ] No existing transcript for session_id `tc-03-01` (verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.transcripts WHERE session_id='tc-03-01'"` returns 0)

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{
     "sessionId": "tc-03-01",
     "transcript": "[10:00] user: Hello, this is a test session\n[10:01] assistant: Hello! How can I help?",
     "source": "claude-code-session",
     "segmentStartLine": 0,
     "segmentEndLine": 3
   }' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: HTTP status is 202 — verify: output contains `HTTP_STATUS:202`
- [ ] CP2: Response has `code: SUCCESS` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code'))"`
- [ ] CP3: `data.transcriptId` is positive integer — verify: `echo $RESP | python3 -c "import sys,json; i=d.get('data',{}).get('transcriptId'); print('valid' if isinstance(i,int) and i>0 else 'invalid')"`
- [ ] CP4: `data.duplicate` is false — verify: `echo $RESP | python3 -c "import sys,json; print('not_dup' if not d.get('data',{}).get('duplicate') else 'is_dup')"`
- [ ] CP5: Database row created — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.transcripts WHERE session_id='tc-03-01'"` returns 1

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id='tc-03-01';"
```

---

### TC-03-02: POST /conversations — duplicate within dedup window, returns 200
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — dedup window

**Preconditions**:
- [ ] Transcript exists for session_id `tc-03-02` from prior test or setup

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{
     "sessionId": "tc-03-02",
     "transcript": "[10:00] user: Hello again\n[10:01] assistant: Hello again!",
     "source": "claude-code-session"
   }' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: `data.duplicate` is true — verify: `echo $RESP | python3 -c "import sys,json; print('is_dup' if d.get('data',{}).get('duplicate') else 'not_dup')"`
- [ ] CP3: `data.transcriptId` is not null — verify: `echo $RESP | python3 -c "import sys,json; i=d.get('data',{}).get('transcriptId'); print('has_id' if i else 'missing_id')"`
- [ ] CP4: Exactly 1 transcript row exists for session — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.transcripts WHERE session_id='tc-03-02'"` returns 1

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id='tc-03-02';"
```

---

### TC-03-03: GET /conversations/position — returns last_line for session
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — GET /conversations/position

**Preconditions**:
- [ ] Transcript exists for session_id `tc-03-03` with known `last_line` value
- [ ] Setup: insert test data via prior POST or direct SQL

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/conversations/position?session_id=tc-03-03"`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response has `session_id` field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin) if not isinstance(d,str) else {}; print('has_session' if 'session_id' in d else 'missing')"`
- [ ] CP3: Response has `last_line` field — verify: output contains `last_line`
- [ ] CP4: `last_line` is a non-negative integer — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin) if not isinstance(d,str) else {}; print('valid' if isinstance(d.get('last_line'),int) and d.get('last_line',-1)>=0 else 'invalid')"`
- [ ] CP5: Response is NOT wrapped in envelope (raw object) — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin) if not isinstance(d,str) else {}; print('raw' if 'code' not in d else 'wrapped')"`

**Cleanup**: None

---

### TC-03-04: GET /conversations/position — unknown session returns defaults
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] No transcript exists for session_id `tc-03-04-nonexistent`

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/conversations/position?session_id=tc-03-04-nonexistent"`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: HTTP 200
- [ ] CP2: `session_id` matches query — verify: response matches query param
- [ ] CP3: `last_line` is 0 — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin) if not isinstance(d,str) else {}; print('zero' if d.get('last_line',-1)==0 else 'nonzero')"`

**Cleanup**: None

---

### TC-03-05: POST /conversations — missing required fields, 400
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Input Validation

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{}' http://localhost:3000/conversations`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sessionId":"tc-03-05"}' http://localhost:3000/conversations`
3. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sessionId":"tc-03-05","transcript":"hello"}' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: Empty body returns 400 — verify: first output contains `HTTP_STATUS:400`
- [ ] CP2: Missing transcript returns 400 — verify: second output contains `HTTP_STATUS:400`
- [ ] CP3: Missing source returns 400 — verify: third output contains `HTTP_STATUS:400`
- [ ] CP4: Each error response has `code` field — verify: all three responses parse as JSON with `code` field

**Cleanup**: None

---

### TC-03-06: POST /conversations — dedup window boundary (exactly at 5min)
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P1 — dedup window boundary

**Preconditions**:
- [ ] Transcript exists for session_id `tc-03-06` created exactly 5 minutes ago (needs direct SQL)

**Steps**:
1. `psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "INSERT INTO jarvis.transcripts (session_id, transcript, source, last_line, created_at) VALUES ('tc-03-06', 'old transcript', 'test', 10, NOW() - INTERVAL '5 minutes') ON CONFLICT DO NOTHING;"`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"sessionId":"tc-03-06","transcript":"new transcript after 5 min","source":"test"}' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: Within dedup window → 200 with duplicate: true — verify: HTTP 200, `duplicate: true`
- [ ] CP2: After dedup window → 202 with duplicate: false — verify: after window expires, HTTP 202 (this may pass or fail based on implementation)

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id='tc-03-06';"
```

---

### TC-03-07: POST /conversations — segment line tracking
**Priority**: Medium
**Design Ref**: Story 13.3 — segment start/end line tracking

**Preconditions**:
- [ ] No existing transcript for session_id `tc-03-07`

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"sessionId":"tc-03-07","transcript":"lines 0-5","source":"test","segmentStartLine":0,"segmentEndLine":5}' http://localhost:3000/conversations`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"sessionId":"tc-03-07","transcript":"lines 6-12","source":"test","segmentStartLine":6,"segmentEndLine":12}' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: First call returns 202 — verify: first HTTP 202
- [ ] CP2: Second call (same session, next segment) returns 200 — verify: second HTTP 200
- [ ] CP3: last_line reflects last segment end — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT last_line FROM jarvis.transcripts WHERE session_id='tc-03-07' ORDER BY created_at DESC LIMIT 1;"` returns 12

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.transcripts WHERE session_id='tc-03-07';"
```