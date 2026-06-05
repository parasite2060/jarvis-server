# TC-06: Config Module — GET /config + PATCH /config

Config file read/write and cron validation.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key
- [ ] Vault at `/tmp/jarvis-e2e-vault` with config.yml seeded

---

### TC-06-01: GET /config — happy path, returns all config fields
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P2 — GET/PATCH /config E2E gap

**Preconditions**:
- [ ] config.yml exists at `/tmp/jarvis-e2e-vault/config.yml` with `auto_merge: true`, `deep_dream_cron: "0 20 * * *"`, `weekly_review_cron: "0 20 * * 0"`, `max_memory_lines: 200`

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/config`

**Checkpoints**:
- [ ] CP1: HTTP status is 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response has `autoMerge` field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has' if 'autoMerge' in d else 'missing')"`
- [ ] CP3: Response has `deepDreamCron` field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has' if 'deepDreamCron' in d else 'missing')"`
- [ ] CP4: Response has `weeklyReviewCron` field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has' if 'weeklyReviewCron' in d else 'missing')"`
- [ ] CP5: Response has `maxMemoryLines` field — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('has' if 'maxMemoryLines' in d else 'missing')"`
- [ ] CP6: `autoMerge` is boolean — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('autoMerge'); print('valid' if isinstance(v,bool) else f'wrong_type:{type(v)}')"`
- [ ] CP7: `maxMemoryLines` is integer between 50-500 — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('maxMemoryLines',0); print('valid' if 50<=v<=500 else f'out_of_range:{v}')"`

**Cleanup**: None

---

### TC-06-02: PATCH /config — update autoMerge
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P2

**Preconditions**:
- [ ] config.yml exists with `auto_merge: true`

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"autoMerge": false}' http://localhost:3000/config`
2. `grep "auto_merge" /tmp/jarvis-e2e-vault/config.yml`
3. `curl -s -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"autoMerge": true}' http://localhost:3000/config`

**Checkpoints**:
- [ ] CP1: PATCH returns 200 — verify: output contains `HTTP_STATUS:200`
- [ ] CP2: Response reflects new value — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('updated' if d.get('autoMerge')==False else 'not_updated')"`
- [ ] CP3: config.yml on disk updated to `auto_merge: false` — verify: grep shows `auto_merge: false`
- [ ] CP4: config.yml restored to `auto_merge: true` — verify: third call restored

**Cleanup**: Done as part of step 3 (restoration call)

---

### TC-06-03: PATCH /config — update deepDreamCron
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P2

**Preconditions**:
- [ ] config.yml exists

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"deepDreamCron": "0 22 * * *"}' http://localhost:3000/config`
2. `grep "deep_dream_cron" /tmp/jarvis-e2e-vault/config.yml`
3. Restore: `curl -s -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"deepDreamCron": "0 20 * * *"}' http://localhost:3000/config`

**Checkpoints**:
- [ ] CP1: PATCH returns 200 — verify: HTTP 200
- [ ] CP2: Response has updated cron — verify: `echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('deepDreamCron')=='0 22 * * *' else 'mismatch')"`
- [ ] CP3: config.yml on disk updated — verify: grep shows `deep_dream_cron: 0 22 \* \* \*`

**Cleanup**: Done as part of restoration call

---

### TC-06-04: PATCH /config — invalid cron string, 400
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P2 — Input Validation

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"deepDreamCron": "not-a-cron"}' http://localhost:3000/config`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"weeklyReviewCron": "0 60 * * *"}' http://localhost:3000/config`

**Checkpoints**:
- [ ] CP1: Invalid cron returns 400 — verify: first output contains `HTTP_STATUS:400`
- [ ] CP2: Invalid minute (60) returns 400 — verify: second output contains `HTTP_STATUS:400`
- [ ] CP3: Error response has `code` field — verify: JSON with error code

**Cleanup**: None

---

### TC-06-05: PATCH /config — maxMemoryLines out of range, 400
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P2

**Preconditions**: None

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"maxMemoryLines": 10}' http://localhost:3000/config`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
   -d '{"maxMemoryLines": 1000}' http://localhost:3000/config`

**Checkpoints**- [ ] CP1: Below minimum (10) returns 400 — verify: first output contains `HTTP_STATUS:400`
- [ ] CP2: Above maximum (1000) returns 400 — verify: second output contains `HTTP_STATUS:400`

**Cleanup**: None

---

### TC-06-06: GET /config — missing config.yml returns defaults
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P2

**Preconditions**:
- [ ] config.yml does NOT exist at `/tmp/jarvis-e2e-vault/config.yml`

**Steps**:
1. `mv /tmp/jarvis-e2e-vault/config.yml /tmp/jarvis-e2e-vault/config.yml.bak 2>/dev/null || true`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $API_KEY" http://localhost:3000/config`
3. `mv /tmp/jarvis-e2e-vault/config.yml.bak /tmp/jarvis-e2e-vault/config.yml 2>/dev/null || true`

**Checkpoints**:
- [ ] CP1: Returns 200 with default values — verify: HTTP 200
- [ ] CP2: `autoMerge` defaults to `true` — verify: response has `true`
- [ ] CP3: `maxMemoryLines` defaults to 200 — verify: response has 200
- [ ] CP4: Original config restored — verify: file exists

**Cleanup**:
```bash
test -f /tmp/jarvis-e2e-vault/config.yml || mv /tmp/jarvis-e2e-vault/config.yml.bak /tmp/jarvis-e2e-vault/config.yml 2>/dev/null || true
```