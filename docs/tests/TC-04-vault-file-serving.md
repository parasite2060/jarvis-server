# TC-04: Vault Module — GET /memory/files/manifest + GET /memory/files/{filePath}

Vault file serving, manifest generation, and security (path traversal blocking).

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key
- [ ] Vault at `/tmp/jarvis-e2e-vault` seeded with test files

---

### TC-04-01: GET /memory/files/manifest — happy path, returns file list
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — Vault manifest + file serving

**Preconditions**:
- [ ] Vault seeded with: SOUL.md, IDENTITY.md, MEMORY.md, dailys/2026-05-08.md, decisions/_index.md

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/manifest`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response is JSON with `code: SUCCESS` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code'))"`
- [ ] CP3: `data.files` is array — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('array' if isinstance(d.get('data',{}).get('files'),list) else 'not_array')"`
- [ ] CP4: `data.fileCount` matches files array length — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); f=d.get('data',{}).get('files',[]); c=d.get('data',{}).get('fileCount'); print('match' if len(f)==c else f'mismatch {len(f)} vs {c}')"`
- [ ] CP5: `data.manifestHash` is non-empty string — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); h=d.get('data',{}).get('manifestHash'); print('valid' if isinstance(h,str) and h else 'missing')"`
- [ ] CP6: Each file entry has `path`, `hash`, `size`, `updatedAt` — verify: first file has all 4 keys

**Cleanup**: None

---

### TC-04-02: GET /memory/files/{filePath} — SOUL.md content served
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] SOUL.md exists in vault with frontmatter

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/SOUL.md`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Content starts with `---` (frontmatter) — verify: first line is `---`
- [ ] CP3: Response has `data.path` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_path' if 'path' in d.get('data',{}) else 'missing')"`
- [ ] CP4: `data.hash` is non-empty — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); h=d.get('data',{}).get('hash'); print('valid' if isinstance(h,str) and h else 'missing')"`
- [ ] CP5: `data.size` is positive integer — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('data',{}).get('size'); print('valid' if isinstance(s,int) and s>0 else 'invalid')"`

**Cleanup**: None

---

### TC-04-03: GET /memory/files/{filePath} — nested path, dailys/2026-05-08.md
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] dailys/2026-05-08.md exists in vault

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/dailys%2F2026-05-08.md`
   (URL-encode the forward slash as %2F)

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Content contains daily date reference — verify: response body contains `2026-05-08`
- [ ] CP3: `data.path` ends with `2026-05-08.md` — verify: path field ends with expected file name

**Cleanup**: None

---

### TC-04-04: GET /memory/files/{filePath} — path traversal blocked
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — Path Traversal security

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/..%2F..%2F..%2Fetc%2Fpasswd"`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/..%2F..%2Fconfig.yml"`
3. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/....//....//etc/passwd"`
4. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" "http://localhost:3000/memory/files/%2e%2e%2f%2e%2e%2fetc%2fpasswd"`

**Checkpoints**:
- [ ] CP1: `../` returns 400 or 403 — verify: first output does NOT contain `HTTP_STATUS:200`
- [ ] CP2: `..%2F` double-encoded returns 400 or 403 — verify: second output does NOT contain `HTTP_STATUS:200`
- [ ] CP3: `....//` double-dot returns 400 or 403 — verify: third output does NOT contain `HTTP_STATUS:200`
- [ ] CP4: Percent-encoded `..%2e%2e` blocked — verify: fourth output does NOT contain `HTTP_STATUS:200`
- [ ] CP5: No response contains `/etc/passwd` or actual system file content — verify: none return actual passwd content

**Cleanup**: None

---

### TC-04-05: GET /memory/files/{filePath} — nonexistent file, 404
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/NONEXISTENT-FILE-12345.md`

**Checkpoints**:
- [ ] CP1: HTTP status is 404 — verify: output contains `HTTP_STATUS:404`
- [ ] CP2: Error response has `code` field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has_code' if 'code' in d else 'missing')"`
- [ ] CP3: Error message mentions file not found — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); m=str(d); print('mentions_file' if 'not found' in m.lower() or 'file' in m.lower() else 'no_ref')"`

**Cleanup**: None

---

### TC-04-06: GET /memory/files/manifest — excludes .git/ and node_modules/
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] Vault has .git/ directory, node_modules/, .DS_Store, README.txt (seeded)

**Steps**:
1. `curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/manifest | python3 -c "import sys,json; d=json.load(sys.stdin); paths=[e['path'] for e in d.get('data',{}).get('files',[])]; print('\n'.join(paths))"`

**Checkpoints**:
- [ ] CP1: No entry with path containing `.git/` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); paths=[e['path'] for e in d.get('data',{}).get('files',[])]; print('clean' if not any('.git' in p for p in paths) else 'has_git')"`
- [ ] CP2: No entry with path containing `node_modules/` — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); paths=[e['path'] for e in d.get('data',{}).get('files',[])]; print('clean' if not any('node_modules' in p for p in paths) else 'has_nm')"`
- [ ] CP3: SOUL.md, IDENTITY.md, MEMORY.md ARE present — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); paths=[e['path'] for e in d.get('data',{}).get('files',[])]; print('has_core' if all(f in str(paths) for f in ['SOUL.md','IDENTITY.md','MEMORY.md']) else 'missing_core')"`

**Cleanup**: None

---

### TC-04-07: GET /memory/files/{filePath} — large file, correct size in response
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] A large file (>1MB) exists in vault (create one for this test)

**Steps**:
1. `dd if=/dev/urandom bs=1M count=2 of=/tmp/jarvis-e2e-vault/large-file.bin 2>/dev/null`
2. `curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/large-file.bin | wc -c`
3. `curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/large-file.bin | python3 -c "import sys,json; d=json.load(sys.stdin) if sys.stdin.read(1)=='{' else None; print('not_json' if d is None else d.get('data',{}).get('size',0))" 2>/dev/null || curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/memory/files/large-file.bin | wc -c`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: HTTP 200
- [ ] CP2: `data.size` is approximately 2MB (2097152 bytes, ±1%) — verify: size check
- [ ] CP3: Downloaded content size matches `data.size` — verify: bytes match

**Cleanup**:
```bash
rm -f /tmp/jarvis-e2e-vault/large-file.bin
```