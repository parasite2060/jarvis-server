# TC-05: Memory Module — POST /memory/search, POST /memory/add, GET /memory/soul, GET /memory/identity, GET /memory/memory

Memory search, add, and file content retrieval endpoints.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running (MemU :8001, postgres :5433)
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key
- [ ] MemU service reachable and healthy

---

### TC-05-01: POST /memory/search — happy path, returns results
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — Memory endpoints

**Preconditions**:
- [ ] MemU has indexed data (at least one memory exists)

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"query": "testing keyword", "method": "rag"}' http://localhost:3000/memory/search`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response has `code: SUCCESS` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code'))"`
- [ ] CP3: `data.results` is array — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('array' if isinstance(d.get('data',{}).get('results'),list) else 'not_array')"`
- [ ] CP4: Each result has `content` and `relevance` — verify: first result has both keys
- [ ] CP5: `data.query` echoes request query — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('match' if d.get('data',{}).get('query')=='testing keyword' else 'mismatch')"`

**Cleanup**: None

---

### TC-05-02: POST /memory/search — empty query returns 400
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Input Validation

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"query": ""}' http://localhost:3000/memory/search`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{}' http://localhost:3000/memory/search`

**Checkpoints**:
- [ ] CP1: Empty string query returns 400 — verify: first output contains `HTTP_STATUS:400`
- [ ] CP2: Missing query field returns 400 — verify: second output contains `HTTP_STATUS:400`

**Cleanup**: None

---

### TC-05-03: POST /memory/add — happy path, memory stored
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — Memory endpoints

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"content": "This is a test memory from manual testing TC-05-03", "metadata": {"source":"manual-test","tc":"TC-05-03"}}' http://localhost:3000/memory/add`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response has `code: SUCCESS` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code'))"`
- [ ] CP3: `data.memory_id` is non-empty string — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); i=d.get('data',{}).get('memory_id'); print('valid' if isinstance(i,str) and i else 'missing')"`
- [ ] CP4: `data.status` is `stored` or `indexed` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('data',{}).get('status'); print('ok' if s in ['stored','indexed','success'] else f'unknown:{s}')"`

**Cleanup**: None (MemU handles own storage)

---

### TC-05-04: POST /memory/add — missing content returns 400
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Input Validation

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{}' http://localhost:3000/memory/add`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"metadata":{"foo":"bar"}}' http://localhost:3000/memory/add`

**Checkpoints**:
- [ ] CP1: Empty body returns 400 — verify: first output contains `HTTP_STATUS:400`
- [ ] CP2: Missing content returns 400 — verify: second output contains `HTTP_STATUS:400`

**Cleanup**: None

---

### TC-05-05: GET /memory/soul — returns SOUL.md content
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — Memory endpoints

**Preconditions**:
- [ ] SOUL.md exists in vault at `/tmp/jarvis-e2e-vault/SOUL.md`

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/soul`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response has `code: SUCCESS` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code'))"`
- [ ] CP3: `data.content` is non-empty string — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); c=d.get('data',{}).get('content'); print('valid' if isinstance(c,str) and c else 'missing')"`
- [ ] CP4: `data.file_path` ends with `SOUL.md` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('data',{}).get('file_path',''); print('correct' if 'SOUL.md' in p else f'wrong:{p}')"`

**Cleanup**: None

---

### TC-05-06: GET /memory/identity — returns IDENTITY.md content
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] IDENTITY.md exists in vault

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/identity`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: HTTP 200
- [ ] CP2: `data.content` is non-empty string — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); c=d.get('data',{}).get('content'); print('valid' if isinstance(c,str) and c else 'missing')"`
- [ ] CP3: `data.file_path` ends with `IDENTITY.md` — verify: path check

**Cleanup**: None

---

### TC-05-07: GET /memory/memory — returns MEMORY.md content
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] MEMORY.md exists in vault

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/memory`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: HTTP 200
- [ ] CP2: `data.content` is non-empty string — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); c=d.get('data',{}).get('content'); print('valid' if isinstance(c,str) and c else 'missing')"`
- [ ] CP3: `data.file_path` ends with `MEMORY.md` — verify: path check

**Cleanup**: None

---

### TC-05-08: GET /memory/soul — missing file returns error envelope
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P1 — Error Handling

**Preconditions**:
- [ ] SOUL.md does NOT exist in vault (remove it temporarily)

**Steps**:
1. `mv /tmp/jarvis-e2e-vault/SOUL.md /tmp/jarvis-e2e-vault/SOUL.md.bak 2>/dev/null || true`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/soul`
3. `mv /tmp/jarvis-e2e-vault/SOUL.md.bak /tmp/jarvis-e2e-vault/SOUL.md 2>/dev/null || true`

**Checkpoints**:
- [ ] CP1: HTTP status is 404 or 500 — verify: NOT HTTP 200
- [ ] CP2: Error response has `code` field — verify: JSON response with error code
- [ ] CP3: Original file restored after test — verify: `ls /tmp/jarvis-e2e-vault/SOUL.md` exists

**Cleanup**:
```bash
test -f /tmp/jarvis-e2e-vault/SOUL.md || mv /tmp/jarvis-e2e-vault/SOUL.md.bak /tmp/jarvis-e2e-vault/SOUL.md 2>/dev/null || true
```