---
name: spec-jarvis-tc02-bugfixes
description: Fix 4 bugs found during TC-02 manual testing
status: done
tags: [bugfix, epic-13, dream-pipeline]
created: 2026-05-12
owner: jarvis
---

# Spec: TC-02 Bug Fixes

## Context

During TC-02 manual test execution, 4 bugs were identified in the dream pipeline:

- **B-01**: `TriggerDeepDreamUseCase` — `transcriptId: 0` → FK violation for manual triggers
- **B-02**: `DreamController` — `transcriptId: 0` for light manual triggers (line 63)
- **B-03**: `gatherDailys` creates internal `weekly_review` dream when `transcript_id=null`, causing DB dream ID mismatch with coordinator-dispatched dream
- **B-04**: Vault sync — no manual trigger endpoint; `/vault/manifest` returns 404

B-01 was fixed prior to this spec.

---

## B-02: DreamController light trigger transcriptId

### Root Cause
Line 63 of `dream.controller.ts`:
```typescript
transcriptId: 0,  // ← wrong: FK constraint rejects transcript_id=0
```
Manual light dream triggers use `sessionId='manual'` which means no transcript. The correct value is `null`.

### Fix
```typescript
transcriptId: null,  // mirrors TriggerDeepDreamUseCase pattern
```

### Files
- `src/modules/dream/dream.controller.ts` line 63

### Verification
```bash
# After fix, verify no FK violation on light manual trigger:
curl -X POST -H "x-api-key: manual-test-api-key" \
  -H "Content-Type: application/json" \
  -d '{"type":"light"}' http://localhost:8100/dream
# Should return 202 with dreamId, not 500
```

---

## B-03: gatherDailys creates duplicate internal dream

### Root Cause

`gatherDailys` activity (in `weekly/gather-dailys.activity.ts`) creates its own `weekly_review` dream row inside the activity's transaction when `transcript_id === null`:

```typescript
const dream = dreamRepo.create({
  type: 'weekly_review',
  trigger,
  status: 'processing',
  startedAt: new Date(),
});
const saved = await dreamRepo.save(dream);
dreamId = saved.id;
```

This is problematic because:
1. The coordinator already created a `weekly_review` dream BEFORE dispatching the child workflow
2. `gatherDailys` creates a SECOND dream with the same type
3. The coordinator tracks `dream_id` from its own dispatch, but `gatherDailys` writes phase rows to its own internal dream ID
4. Result: coordinator's dream stays `queued`, the internal dream runs to completion

### Fix
Remove the internal dream creation from `gatherDailys`. The activity should use the `dream_id` passed in the payload (`WeeklyReviewPayload.dream_id`) to write phase rows directly. The DB record was already created by the use case BEFORE the coordinator was signaled.

### Files
- `src/modules/dream/temporal/activities/weekly/gather-dailys.activity.ts`

### Changes

1. Remove the transaction and internal dream creation
2. Use `payload.dream_id` directly (already in `WeeklyReviewPayload`)
3. Update phase row insertion to use `payload.dream_id`

### Verification
```bash
# Trigger weekly review, verify:
# - dream record created with status=queued BEFORE coordinator signal
# - coordinator's dream (not internal) gets phase rows
# - coordinator's dream transitions to status=processing, then completed
```

---

## B-04: Vault sync — no manual trigger, /vault/manifest 404

### Root Cause
Two separate issues:
1. No manual trigger endpoint for vault sync
2. `/vault/manifest` endpoint not implemented or wrong path

### Fix (scope TBD — requires reading source)
1. Find the vault manifest endpoint or implement it
2. Find if a manual sync trigger exists or add one
3. If neither exists, document as known limitation

### Files (TBD — requires source reading)
- Likely in `src/modules/vault/` or similar

### Verification
```bash
# After fix:
curl -H "x-api-key: manual-test-api-key" http://localhost:8100/vault/manifest
# Should return JSON manifest

# Manual sync trigger (TBD endpoint):
curl -X POST -H "x-api-key: manual-test-api-key" http://localhost:8100/vault/sync
# Should trigger sync and return 202
```

---

## Tasks

- [ ] B-02: Fix DreamController light trigger transcriptId
- [ ] B-03: Remove internal dream creation from gatherDailys
- [ ] B-04: Investigate and fix vault sync endpoints
- [ ] Run `bun run typecheck` after all changes
- [ ] Run `bun run lint` after all changes
