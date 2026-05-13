# TC-02: Tier 2 — Real LLM + GitHub Vault

End-to-end validation with real LLM (not api-mock) and real GitHub vault.
**Requires**: `.env.manual-test` with real credentials. See `test-plan.md §4 Tier 2 Setup`.

## Prerequisites
- [ ] `.env.manual-test` created with all 5 `JARVIS_MANUAL_*` vars filled
- [ ] `docker-compose.manual-test.yml --env-file .env.manual-test up -d --wait` completed
- [ ] `curl -s http://localhost:8100/health` returns 200 with `application.status=up`
- [ ] MemU service healthy: `curl -s http://localhost:18001/ | python3 -c "import sys,json; print('memu_ok')"` (no error)

---

### TC-02-01: Real LLM — deep dream end-to-end with real token generation
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P2 — Real LLM via api-mock-server bypass

**Preconditions**:
- [ ] jarvis-server running on localhost:8100
- [ ] Real LLM endpoint accessible at `JARVIS_MANUAL_OPENAI_URL`
- [ ] Vault has dailys/ directory with at least 7 days of entries (verify: `ls /app/ai-memory/dailys/*.md | wc -l`)
- [ ] JARVIS_API_KEY=manual-test-api-key

**Steps**:
1. `DREAM_ID=$(curl -s -X POST -H "Authorization: Bearer manual-test-api-key" -H "Content-Type: application/json" -d '{"sourceDate":"2026-05-07"}' http://localhost:8100/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`
2. echo "Dream ID: $DREAM_ID"
3. Poll every 30s for up to 5 minutes:
   `sleep 30 && psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT status FROM jarvis.dreams WHERE id=$DREAM_ID;"`
4. Once completed, check phases:
   `psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT phase, status, token_count FROM jarvis.dream_phases WHERE dream_id=$DREAM_ID ORDER BY phase;"`
5. Check vault for new/updated files:
   `cd /app/ai-memory && git log --oneline -5`

**Checkpoints**:
- [ ] CP1: POST /dream returns 202 — verify: HTTP 202
- [ ] CP2: Dream completes within 5 minutes — verify: status becomes `completed`
- [ ] CP3: At least 3 phase rows exist — verify: count ≥ 3
- [ ] CP4: Phase 1 has token_count > 0 — verify: real tokens consumed
- [ ] CP5: Git commit exists on main — verify: `git log --oneline | wc -l` > seed commit count
- [ ] CP6: No phase has status `failed` — verify: all phases are `completed` or `skipped`

**Cleanup**:
```bash
psql -h localhost -p 15432 -U postgres -d jarvis_manual -c "DELETE FROM jarvis.dream_phases WHERE dream_id=<DREAM_ID>;"
psql -h localhost -p 15432 -U postgres -d jarvis_manual -c "DELETE FROM jarvis.dreams WHERE id=<DREAM_ID>;"
cd /app/ai-memory && git checkout -- . && git clean -fd  # revert vault changes from this test
```

---

### TC-02-02: Real LLM — light dream end-to-end with daily log update
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P2 — Real LLM light dream

**Preconditions**:
- [ ] jarvis-server running on localhost:8100
- [ ] Real LLM accessible
- [ ] Vault at /app/ai-memory has dailys/ directory

**Steps**:
1. `DREAM_ID=$(curl -s -X POST -H "Authorization: Bearer manual-test-api-key" -H "Content-Type: application/json" -d '{"type":"light"}' http://localhost:8100/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`
2. Poll every 30s for up to 3 minutes:
   `sleep 30 && psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT status FROM jarvis.dreams WHERE id=$DREAM_ID;"`
3. Check daily log updated:
   `ls -la /app/ai-memory/dailys/*.md | tail -5`

**Checkpoints**:
- [ ] CP1: POST returns 202 — verify: HTTP 202
- [ ] CP2: Dream type is `light` — verify: `psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT type FROM jarvis.dreams WHERE id=$DREAM_ID;"` returns `light`
- [ ] CP3: Dream completes within 3 minutes — verify: status `completed`
- [ ] CP4: Daily log file modified during this test — verify: `stat /app/ai-memory/dailys/$(date +%Y-%m-%d).md` shows recent mtime
- [ ] CP5: At least 1 phase completed — verify: phase count ≥ 1

**Cleanup**:
```bash
DREAM_ID=$(psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT id FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1;")
psql -h localhost -p 15432 -U postgres -d jarvis_manual -c "DELETE FROM jarvis.dream_phases WHERE dream_id=$DREAM_ID;"
psql -h localhost -p 15432 -U postgres -d jarvis_manual -c "DELETE FROM jarvis.dreams WHERE id=$DREAM_ID;"
cd /app/ai-memory && git checkout -- . && git clean -fd
```

---

### TC-02-03: Real LLM — weekly review generates memories
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Weekly review workflow E2E

**Preconditions**:
- [ ] jarvis-server running on localhost:8100
- [ ] Real LLM accessible
- [ ] Vault has at least 7 days of dailys

**Steps**:
1. `DREAM_ID=$(curl -s -X POST -H "Authorization: Bearer manual-test-api-key" -H "Content-Type: application/json" -d '{"type":"weekly-review"}' http://localhost:8100/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`
2. Poll every 30s for up to 5 minutes:
   `sleep 30 && psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT status FROM jarvis.dreams WHERE id=$DREAM_ID;"`
3. After completion, check MemU server directly:
   `curl -s http://localhost:18001/ | python3 -c "import sys,json; print(json.load(sys.stdin).get('memories_added','n/a'))"`

**Checkpoints**:
- [ ] CP1: POST returns 202 — verify: HTTP 202
- [ ] CP2: Dream type is `weekly-review` — verify: type check
- [ ] CP3: Dream completes within 5 minutes — verify: status `completed`
- [ ] CP4: `memories_added` or outcome field shows count > 0 — verify: outcome JSON has memory count
- [ ] CP5: MemU server is responsive — verify: `curl http://localhost:18001/` returns 200

**Cleanup**:
```bash
DREAM_ID=$(psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT id FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1;")
psql -h localhost -p 15432 -U postgres -d jarvis_manual -c "DELETE FROM jarvis.dream_phases WHERE dream_id=$DREAM_ID;"
psql -h localhost -p 15432 -U postgres -d jarvis_manual -c "DELETE FROM jarvis.dreams WHERE id=$DREAM_ID;"
```

---

### TC-02-04: GitHub mode — MEMORY_STORAGE_MODE=github, real PR created
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P2 — JARVIS_E2E_GH_TOKEN gate, real git ops

**Preconditions**:
- [ ] `MEMORY_STORAGE_MODE=github` set in `.env.manual-test`
- [ ] `JARVIS_MANUAL_GH_TOKEN` has `repo` scope (for PR creation)
- [ ] `JARVIS_MANUAL_GH_REPO` points to real ai-memory repo
- [ ] jarvis-server running on localhost:8100

**Steps**:
1. `cd /app/ai-memory && git status` — confirm clean state
2. Trigger deep dream:
   `DREAM_ID=$(curl -s -X POST -H "Authorization: Bearer manual-test-api-key" -H "Content-Type: application/json" -d '{"sourceDate":"2026-05-07"}' http://localhost:8100/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`
3. Wait for completion: `sleep 120 && psql -h localhost -p 15432 -U postgres -d jarvis_manual -t -c "SELECT status FROM jarvis.dreams WHERE id=$DREAM_ID;"`
4. Check for PR:
   `gh pr list --repo $(echo $JARVIS_MANUAL_GH_REPO | sed 's|.*github.com/||' | sed 's|\.git||') --state=open --json number,title,state | python3 -c "import sys,json; print(json.load(sys.stdin))"`

**Checkpoints**:
- [ ] CP1: Deep dream completes with `completed` status — verify: status query
- [ ] CP2: Git branch created — verify: `cd /app/ai-memory && git branch -a | grep -E "jarvis|feature|dream"`
- [ ] CP3: At least 1 commit on feature branch — verify: `git log --oneline origin/main..HEAD | wc -l` > 0
- [ ] CP4: PR created on GitHub — verify: `gh pr list` returns ≥ 1 open PR
- [ ] CP5: PR title contains dream ID or date reference — verify: PR title matches pattern
- [ ] CP6: No conflicts during merge — verify: PR state is `OPEN`, not `Merge conflict`

**Cleanup**:
```bash
# Merge and close PR
PR_NUM=$(gh pr list --repo <repo> --state=open --json number --jq '.[0].number')
gh pr merge <PR_NUM> --squash --delete-branch || true
# Reset vault to main
cd /app/ai-memory && git checkout main && git pull --ff-only origin main
```

---

### TC-02-05: Vault sync — 30-min periodic sync, context cache invalidated
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §R-005 — VaultSyncService integration

**Preconditions**:
- [ ] jarvis-server running on localhost:8100
- [ ] VaultSyncService interval set to 1800s (30 min) — verify in config
- [ ] Vault at /app/ai-memory has existing dailys

**Steps**:
1. `curl -s -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/health | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('application',{}).get('details',{}).get('vaultSync',{}))"`
2. Trigger manual sync: look for POST or admin endpoint (or wait for interval)
3. Add a test file to vault: `echo "# Manual Test" > /app/ai-memory/test-tc-02-05.md && cd /app/ai-memory && git add test-tc-02-05.md && git commit -m "test: manual file for TC-02-05"`
4. Wait for sync cycle OR trigger if endpoint exists
5. Check context cache invalidation: `curl -s -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/memory/context | python3 -c "import sys,json;d=json.load(sys.stdin);print('context_ok')"`
6. Verify vault manifest updated: `curl -s -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/vault/manifest | python3 -c "import sys,json;d=json.load(sys.stdin);print('ok' if any('test-tc-02-05' in e.get('path','') for e in d) else 'not_yet_synced')"`

**Checkpoints**:
- [ ] CP1: VaultSyncService reports healthy — verify: health indicator present
- [ ] CP2: New vault file triggers sync within expected interval (check logs: `docker compose -f docker-compose.manual-test.yml logs jarvis-server 2>&1 | grep -i "vault.*sync"`)
- [ ] CP3: Context endpoint reflects updated vault — verify: new file appears in vault manifest
- [ ] CP4: Cache invalidation logged — verify: logs show `InvalidateContextCacheCommand` dispatched

**Cleanup**:
```bash
cd /app/ai-memory && git rm -f test-tc-02-05.md && git commit -m "chore: remove test file" || true
```

---

### TC-02-06: GET /config + PATCH /config — verify config.yml updated
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P2 — GET/PATCH /config E2E gap

**Preconditions**:
- [ ] jarvis-server running on localhost:8100
- [ ] config.yml exists at vault path

**Steps**:
1. `curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/config`
2. `curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH -H "Authorization: Bearer manual-test-api-key" -H "Content-Type: application/json" -d '{"maxMemoryLines":300}' http://localhost:8100/config`
3. `cat /app/ai-memory/config.yml | grep -A2 "maxMemoryLines"`
4. Restore original: `curl -s -X PATCH -H "Authorization: Bearer manual-test-api-key" -H "Content-Type: application/json" -d '{"maxMemoryLines":200}' http://localhost:8100/config`

**Checkpoints**:
- [ ] CP1: GET /config returns 200 — verify: HTTP 200
- [ ] CP2: GET /config response is JSON — verify: parses
- [ ] CP3: PATCH returns 200 — verify: HTTP 200
- [ ] CP4: config.yml on disk updated — verify: grep shows new value 300
- [ ] CP5: config.yml restored after cleanup — verify: grep shows original value 200

**Cleanup**: PATCH back to original value (done in step 4)

---

### TC-02-07: Context assembly — warm <500ms, cold <3s
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P3 — Performance NFR1

**Preconditions**:
- [ ] jarvis-server running on localhost:8100
- [ ] Vault populated with realistic content (dailys, decisions, lessons)
- [ ] MemU has indexed memories

**Steps**:
1. Cold measurement (cache miss):
   `START=$(python3 -c "import time; print(time.time()))" && curl -s -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/memory/context > /dev/null && END=$(python3 -c "import time; print(time.time())") && echo "Cold: $(python3 -c "print(round(($END-$START)*1000))")ms"`
2. Warm measurement (cache hit):
   `START=$(python3 -c "import time; print(time.time())") && curl -s -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/memory/context > /dev/null && END=$(python3 -c "import time; print(time.time())") && echo "Warm: $(python3 -c "print(round(($END-$START)*1000))")ms"`
3. Repeat warm 3x and average

**Checkpoints**:
- [ ] CP1: Cold assembly ≤ 3000ms — verify: output ≤ 3000
- [ ] CP2: Warm assembly ≤ 500ms — verify: output ≤ 500
- [ ] CP3: Warm results consistent (3 consecutive within 100ms of each other) — verify: spread ≤ 100ms

**Cleanup**: None (read-only)

---

### TC-02-08: VaultSyncService — pull → manifest → sync → invalidate cycle
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P2 — VaultSyncService integration gap

**Preconditions**:
- [ ] jarvis-server running on localhost:8100
- [ ] Vault git repo clean (verify: `cd /app/ai-memory && git status` clean)
- [ ] vault-init sidecar has completed (volume populated)

**Steps**:
1. `echo "# Test Sync Cycle $(date)" > /tmp/test-sync.md`
2. `cp /tmp/test-sync.md /app/ai-memory/test-sync.md && cd /app/ai-memory && git add test-sync.md && git commit -m "test: sync cycle"`
3. Wait for VaultSyncService interval or check logs for sync trigger:
   `docker compose -f docker-compose.manual-test.yml logs jarvis-server 2>&1 | grep -i "vault.*sync\|runSync\|pull" | tail -10`
4. Check if manifest updated:
   `curl -s -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/vault/manifest | python3 -c "import sys,json;d=json.load(sys.stdin);print('found' if any('test-sync' in e.get('path','') for e in d) else 'not_found')"`
5. Check if context cache invalidated (call context endpoint):
   `curl -s -H "Authorization: Bearer manual-test-api-key" http://localhost:8100/memory/context | python3 -c "import sys,json;print('ok')"`

**Checkpoints**:
- [ ] CP1: Vault file committed to local repo — verify: `cd /app/ai-memory && git log --oneline -1` shows test-sync commit
- [ ] CP2: Sync service logs show pull and manifest build — verify: logs contain `pull` and `manifest`
- [ ] CP3: Manifest includes new file — verify: manifest response has test-sync entry
- [ ] CP4: Context cache reflects new file within expected window — verify: new file appears in context or manifest

**Cleanup**:
```bash
cd /app/ai-memory && git checkout -- . && git clean -fd
```