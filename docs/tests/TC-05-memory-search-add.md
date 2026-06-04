# TC-05: Memory Module — GET /memory/soul, GET /memory/identity, GET /memory/memory

Raw vault file content retrieval endpoints (SOUL/IDENTITY/MEMORY).

> **REMOVED (2026-06-04):** `POST /memory/search` and `POST /memory/add` were removed
> together with MemU. Those endpoints now return **404**. The cases that exercised them
> (formerly TC-05-01 through TC-05-04) have been deleted. The raw vault file endpoints
> below are unaffected.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running (postgres :5433)
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key

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
