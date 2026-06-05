# TC-07: Error Handling — HTTP Status Codes and Error Envelope Shape

Verifies all error responses use the flat envelope `{ code, message, data }` and correct HTTP status codes.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key

---

### TC-07-01: GET /nonexistent-route — flat envelope, 404
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — Error envelope flat shape (TS) + nested (Python)

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/nonexistent-route-12345`

**Checkpoints**:
- [ ] CP1: HTTP status is 404 — verify: output contains `HTTP_STATUS:404`
- [ ] CP2: Response is JSON — verify: `echo $RESP | python3 -c "import sys,json; json.load(sys.stdin)"`
- [ ] CP3: Response has top-level `code` field (NOT nested under `error`) — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('flat' if 'code' in d and 'error' not in d else 'nested')"`
- [ ] CP4: `message` is a string — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('valid' if isinstance(d.get('message'),str) else 'wrong_type')"`
- [ ] CP5: `data` is null — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('null' if d.get('data') is None else 'not_null')"`

**Cleanup**: None

---

### TC-07-02: POST /dream with invalid sourceDate — flat envelope, 400
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"sourceDate":"2026-99-99"}' http://localhost:3000/dream`

**Checkpoints**:
- [ ] CP1: HTTP status is 400 — verify: output contains `HTTP_STATUS:400`
- [ ] CP2: Response is flat envelope with `code` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('flat' if 'code' in d else 'not_flat')"`
- [ ] CP3: `code` is an error code (numeric or string constant) — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('valid' if d.get('code') not in [None, {}] else 'missing')"`
- [ ] CP4: `message` mentions validation or sourceDate — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); m=str(d.get('message','')).lower(); print('has_ref' if 'source' in m or 'date' in m or 'valid' in m else 'no_ref')"`

**Cleanup**: None

---

### TC-07-03: POST /conversations missing required fields — flat envelope, 400
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Input Validation

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"sessionId":"tc-07-03"}' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: HTTP status is 400 — verify: output contains `HTTP_STATUS:400`
- [ ] CP2: Response is flat envelope — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('flat' if 'code' in d else 'not_flat')"`
- [ ] CP3: `message` mentions missing field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_field_ref' if 'transcript' in str(d.get('message','')).lower() or 'source' in str(d.get('message','')).lower() else 'no_field_ref')"`

**Cleanup**: None

---

### TC-07-04: GET /memory/files/NONEXISTENT — flat envelope, 404
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Error Handling

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/NONEXISTENT-FILE-XYZ.md`

**Checkpoints**:
- [ ] CP1: HTTP status is 404 — verify: output contains `HTTP_STATUS:404`
- [ ] CP2: Response is flat envelope — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('flat' if 'code' in d else 'not_flat')"`
- [ ] CP3: No stack traces in response — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); s=str(d); print('clean' if 'traceback' not in s.lower() and 'at ' not in s else 'leaks_info')"`

**Cleanup**: None

---

### TC-07-05: POST /memory/search — empty query, 400 with flat envelope
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"query": ""}' http://localhost:3000/memory/search`

**Checkpoints**:
- [ ] CP1: HTTP status is 400 — verify: output contains `HTTP_STATUS:400`
- [ ] CP2: Response is flat envelope — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('flat' if 'code' in d else 'not_flat')"`
- [ ] CP3: `message` mentions `query` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_query_ref' if 'query' in str(d.get('message','')).lower() else 'no_ref')"`

**Cleanup**: None

---

### TC-07-06: PATCH /config — invalid cron, 400 with flat envelope
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P2

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"deepDreamCron": "invalid"}' http://localhost:3000/config`

**Checkpoints**:
- [ ] CP1: HTTP status is 400 — verify: output contains `HTTP_STATUS:400`
- [ ] CP2: Response is flat envelope — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('flat' if 'code' in d else 'not_flat')"`
- [ ] CP3: `message` mentions cron or schedule — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); m=str(d.get('message','')).lower(); print('has_cron_ref' if 'cron' in m or 'schedule' in m else 'no_ref')"`

**Cleanup**: None

---

### TC-07-07: No stack traces leaked in any error response
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — Error Handling security

**Preconditions**: None

**Steps**:
1. Run all error-producing requests from previous TCs and capture all responses
2. `echo $ALL_RESPONSES | grep -ciE "traceback|at .*\.(py|ts|js):[0-9]+|stack trace|node_modules|internal/|app/"`

**Checkpoints**:
- [ ] CP1: No response contains Python traceback — verify: `echo $RESP | grep -ci "Traceback" | awk '{print ($1==0?"clean":"leaks")}'`
- [ ] CP2: No response contains TypeScript/JavaScript stack frames — verify: `echo $RESP | grep -ciE "at .*\.[jt]s:[0-9]+" | awk '{print ($1==0?"clean":"leaks")}'`
- [ ] CP3: No response exposes internal paths — verify: `echo $RESP | grep -ciE "/app/|/src/|/node_modules/" | awk '{print ($1==0?"clean":"leaks")}'`

**Cleanup**: None