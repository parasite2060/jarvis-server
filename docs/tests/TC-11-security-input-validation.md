# TC-11: Security & Auth — API_KEY Enforcement, Input Sanitization

Verifies authentication behavior, input sanitization, and no injection vulnerabilities.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running
- [ ] jarvis-server accessible on localhost:3000

---

### TC-11-01: Endpoints work without API_KEY — no auth enforcement
**Priority**: High (security finding)
**Design Ref**: `test-design-epic-13.md` §P1 — Auth requirements

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3000/health`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3000/dream`
3. `curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3000/memory/context`

**Checkpoints**:
- [ ] CP1: GET /health works without Authorization header — verify: HTTP 200
- [ ] CP2: POST /dream works without Authorization header — verify: HTTP 202
- [ ] CP3: GET /memory/context works without Authorization header — verify: HTTP 200
- [ ] CP4: Response data is identical with or without API_KEY — verify: both return same data shape

**Note**: This is a FINDING — all endpoints are publicly accessible. If auth is desired, this must be addressed before production.

**Cleanup**: None

---

### TC-11-02: SQL injection — /conversations query params
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — SQL injection blocked

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" "http://localhost:3000/conversations/position?session_id='; DROP TABLE jarvis.transcripts;--" 2>&1`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"sessionId":"tc-11-02\"; DELETE FROM jarvis.transcripts; --","transcript":"test","source":"test"}' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: SQL injection in session_id param returns 400 or 200 (not crash) — verify: not HTTP 500
- [ ] CP2: SQL injection in body returns 400 (validation rejects malformed JSON or sanitizes) — verify: not HTTP 500
- [ ] CP3: Database table still exists after attacks — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.transcripts;"` returns a number (table exists)
- [ ] CP4: No rows deleted by injection — verify: row count unchanged from before

**Cleanup**: None

---

### TC-11-03: XSS — /memory/add content field — REMOVED (2026-06-04)
`POST /memory/add` and `POST /memory/search` were removed together with MemU.
Those endpoints now return **404**, so this stored-XSS case is retired.

---

### TC-11-04: Path traversal — /memory/files/{filePath}
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — Path Traversal security

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/..%2F..%2F..%2Fetc%2Fpasswd"`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/....//....//....//etc/passwd"`
3. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"`
4. `curl -s -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/..%2F..%2F..%2F..%2Fapp/jarvis-server/package.json" | head -5`

**Checkpoints**:
- [ ] CP1: Double-dot with `%2F` returns 400 or 404 — verify: NOT HTTP 200
- [ ] CP2: Double-dot with `//` returns 400 or 404 — verify: NOT HTTP 200
- [ ] CP3: Percent-encoded `..%2e%2e` returns 400 or 404 — verify: NOT HTTP 200
- [ ] CP4: No `/etc/passwd` content leaked — verify: response is not system passwd file
- [ ] CP5: No `package.json` leaked — verify: jarvis-server source not accessible

**Cleanup**: None

---

### TC-11-05: Large payload — POST /conversations with 10MB transcript
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P1 — Input Validation

**Preconditions**: None

**Steps**:
1. `python3 -c "print('x'*10485760)" > /tmp/large-transcript.txt`  # 10MB
2. `TRANSCRIPT=$(cat /tmp/large-transcript.txt | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read()))")`
3. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d "{\"sessionId\":\"tc-11-05\",\"transcript\":\"$TRANSCRIPT\",\"source\":\"test\"}" http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: Large payload returns 400 (payload too large) or 413 (Payload Too Large) — verify: NOT HTTP 500
- [ ] CP2: Server does not crash — verify: still responds to subsequent requests
- [ ] CP3: Response is JSON error (not HTML) — verify: response is valid JSON with `code` field

**Cleanup**:
```bash
rm -f /tmp/large-transcript.txt
```

---

### TC-11-06: Header injection — newlines in /conversations sessionId
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P1 — Header Injection

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"sessionId":"tc-11-06\r\nX-Injected: true","transcript":"test","source":"test"}' http://localhost:3000/conversations`

**Checkpoints**:
- [ ] CP1: Header injection rejected — verify: HTTP 400 (validation error) or sessionId is sanitized
- [ ] CP2: Server does not interpret `\r\n` as header separator — verify: no extra headers in response

**Cleanup**: None