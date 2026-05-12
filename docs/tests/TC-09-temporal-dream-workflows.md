# TC-09: Temporal System — Dream Coordinator Bootstrap and Signal Delivery

Verifies Temporal health indicator, coordinator workflow signal delivery, and dream phase tracking.

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running (Temporal on :7234)
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key
- [ ] Vault at `/tmp/jarvis-e2e-vault` seeded

---

### TC-09-01: GET /health — Temporal indicator status
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — GET /health all indicators

**Preconditions**:
- [ ] Temporal server healthy on :7234

**Steps**:
1. `curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('application',{}).get('details',{}), indent=2))"`

**Checkpoints**:
- [ ] CP1: `temporal` indicator present — verify: `temporal` key exists in details
- [ ] CP2: `temporal.status` is `up` — verify: status equals `up`
- [ ] CP3: `postgres.status` is `up` — verify: status equals `up`
- [ ] CP4: `application.status` is `up` — verify: status equals `up`

**Cleanup**: None

---

### TC-09-02: POST /dream — submitDeep signal dispatched
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /dream temporal deep spec

**Preconditions**:
- [ ] Temporal namespace `jarvis` exists on Temporal server
- [ ] Task queue `jarvis-dream` registered

**Steps**:
1. `DREAM_ID=$(curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sourceDate":"2026-05-08"}' http://localhost:3000/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`
2. echo "Dream ID: $DREAM_ID"
3. Poll status: `sleep 30 && psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT status FROM jarvis.dreams WHERE id=$DREAM_ID;"`

**Checkpoints**:
- [ ] CP1: POST returns 202 — verify: HTTP 202
- [ ] CP2: Dream row created — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.dreams WHERE id=$DREAM_ID;"` returns 1
- [ ] CP3: After 60s, status is `queued` or `processing` — verify: status is not `null`
- [ ] CP4: After 5min, status is `completed` or `failed` (not stuck) — verify: status is terminal

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dream_phases WHERE dream_id=<DREAM_ID>;" 2>/dev/null
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dreams WHERE id=<DREAM_ID>;" 2>/dev/null
```

---

### TC-09-03: POST /dream with type=light — light dream pipeline
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — Light dream workflow E2E

**Preconditions**:
- [ ] Vault has dailys/ directory with today and yesterday entries

**Steps**:
1. `DREAM_ID=$(curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"type":"light"}' http://localhost:3000/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`
2. Poll every 30s: `sleep 30 && psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT status, type FROM jarvis.dreams WHERE id=$DREAM_ID;"`

**Checkpoints**:
- [ ] CP1: POST returns 202 — verify: HTTP 202
- [ ] CP2: Dream type is `light` — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT type FROM jarvis.dreams WHERE id=$DREAM_ID;"` returns `light`
- [ ] CP3: Dream completes within 3 minutes — verify: status `completed`
- [ ] CP4: At least 1 phase row exists — verify: count ≥ 1

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dream_phases WHERE dream_id=<DREAM_ID>;" 2>/dev/null
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dreams WHERE id=<DREAM_ID>;" 2>/dev/null
```

---

### TC-09-04: Deep dream — phase_1, phase_2, phase_3 rows created
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P0 — POST /dream temporal deep spec

**Preconditions**:
- [ ] Vault seeded with 30 days of dailys (for deep dream window)

**Steps**:
1. Trigger deep dream: `curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sourceDate":"2026-05-08"}' http://localhost:3000/dream`
2. Wait 3 minutes: `sleep 180`
3. Check phases: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT phase, status, token_count FROM jarvis.dream_phases WHERE dream_id=(SELECT id FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1) ORDER BY phase;"`

**Checkpoints**:
- [ ] CP1: At least 3 phase rows exist — verify: count ≥ 3
- [ ] CP2: Phase sequence is phase_1, phase_2, phase_3 — verify: phases listed
- [ ] CP3: No phase has status `failed` — verify: all phases `completed` or `skipped`
- [ ] CP4: At least one phase has `token_count > 0` — verify: tokens consumed

**Cleanup**:
```bash
DREAM_ID=$(psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT id FROM jarvis.dreams ORDER BY created_at DESC LIMIT 1;")
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dream_phases WHERE dream_id=$DREAM_ID;" 2>/dev/null
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dreams WHERE id=$DREAM_ID;" 2>/dev/null
```

---

### TC-09-05: POST /dream — idempotency, second call is queued not duplicated
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — Idempotency

**Preconditions**:
- [ ] Vault seeded

**Steps**:
1. `ID1=$(curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sourceDate":"2026-05-08"}' http://localhost:3000/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`
2. `sleep 2`
3. `ID2=$(curl -s -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"sourceDate":"2026-05-08"}' http://localhost:3000/dream | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['dreamId'])")`

**Checkpoints**:
- [ ] CP1: Both calls return 202 — verify: both HTTP 202
- [ ] CP2: Two distinct dream IDs created — verify: `echo "$ID1 $ID2" | awk '{print ($1!=$2?"different":"same")}'`
- [ ] CP3: Both dreams tracked in DB — verify: `psql -h localhost -p 5433 -U postgres -d e2e_test_db -t -c "SELECT count(*) FROM jarvis.dreams WHERE source_date_iso='2026-05-08';"` returns ≥ 2

**Cleanup**:
```bash
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dream_phases WHERE dream_id IN (SELECT id FROM jarvis.dreams WHERE source_date_iso='2026-05-08');"
psql -h localhost -p 5433 -U postgres -d e2e_test_db -c "DELETE FROM jarvis.dreams WHERE source_date_iso='2026-05-08';"
```

---

### TC-09-06: GET /health — Temporal not-connected state
**Priority**: Medium
**Design Ref**: `test-design-epic-13.md` §P1 — Temporal health indicator not-connected

**Preconditions**:
- [ ] jarvis-server running with Temporal health indicator

**Steps**:
1. `curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/health | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('application',{}).get('details',{}).get('temporal',{}); print(f'status={t.get(\"status\")} message={t.get(\"message\",\"\")}')"`

**Checkpoints**:
- [ ] CP1: Temporal status is `up` — verify: status is `up` (server connected)
- [ ] CP2: Temporal indicator present — verify: `temporal` key exists

**Cleanup**: None