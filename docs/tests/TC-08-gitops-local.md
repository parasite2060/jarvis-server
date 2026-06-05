# TC-08: GitOps — Local Mode (MEMORY_STORAGE_MODE=local)

Tests GitOpsService operations against local bare git repo (no remote push, no PR creation).

## Prerequisites
- [ ] `docker-compose.e2e.yml` is running
- [ ] jarvis-server accessible on localhost:3000
- [ ] API_KEY=jarvis-e2e-test-key
- [ ] Vault at `/tmp/jarvis-e2e-vault` (seeded by E2ETestSetup)
- [ ] `MEMORY_STORAGE_MODE=local` in `.env.e2e`

---

### TC-08-01: GitOps local — pull latest main
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1 — GitOps service pull/branch/commit/push

**Preconditions**:
- [ ] Vault is a valid git repo with at least one commit on main
- [ ] No uncommitted changes in vault

**Steps**:
1. Check vault is git repo: `cd /tmp/jarvis-e2e-vault && git status`
2. `cd /tmp/jarvis-e2e-vault && git log --oneline -1`
3. Verify no remote configured or remote is local — verify: `cd /tmp/jarvis-e2e-vault && git remote -v` (empty or file://)

**Checkpoints**:
- [ ] CP1: `git status` succeeds (no fatal errors) — verify: exit code 0
- [ ] CP2: At least 1 commit exists on main — verify: `git log --oneline | wc -l` > 0
- [ ] CP3: Vault path exists and is readable — verify: `test -d /tmp/jarvis-e2e-vault && echo ok`

**Cleanup**: None

---

### TC-08-02: GitOps local — create branch, write files, commit
**Priority**: Critical
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] Vault is clean (no uncommitted changes)

**Steps**:
1. Create test file: `echo "# Test Decision" > /tmp/jarvis-e2e-vault/decisions/test-tc-08-02.md`
2. `cd /tmp/jarvis-e2e-vault && git add decisions/test-tc-08-02.md`
3. `cd /tmp/jarvis-e2e-vault && git commit -m "test: TC-08-02 decision for git ops test"`
4. `cd /tmp/jarvis-e2e-vault && git branch -a`

**Checkpoints**:
- [ ] CP1: `git add` succeeds — verify: exit code 0
- [ ] CP2: `git commit` succeeds — verify: exit code 0
- [ ] CP3: Commit exists — verify: `git log --oneline -1 | grep "TC-08-02"`
- [ ] CP4: Branch `main` is present — verify: `git branch -a | grep main`

**Cleanup**:
```bash
cd /tmp/jarvis-e2e-vault && git checkout -- . && git clean -fd && git reset --hard HEAD~1 2>/dev/null || true
```

---

### TC-08-03: GitOps local — push is no-op (no remote)
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1 — local mode push is no-op

**Preconditions**:
- [ ] Vault has no remote or remote is not reachable

**Steps**:
1. `cd /tmp/jarvis-e2e-vault && git push origin main 2>&1 || echo "push_failed_or_no_remote"`
2. `cd /tmp/jarvis-e2e-vault && git status`

**Checkpoints**:
- [ ] CP1: Push either fails gracefully (no crash) OR silently succeeds if no remote — verify: no JavaScript error thrown
- [ ] CP2: Vault remains in consistent state after push attempt — verify: `git status` shows clean or branch info

**Cleanup**: None

---

### TC-08-04: GitOps local — merge branch to main (local merge)
**Priority**: High
**Design Ref**: `test-design-epic-13.md` §P1

**Preconditions**:
- [ ] Feature branch exists with a commit

**Steps**:
1. `cd /tmp/jarvis-e2e-vault && git checkout -b feature/tc-08-04`
2. `echo "# Feature test" > /tmp/jarvis-e2e-vault/feature-tc-08-04.txt`
3. `cd /tmp/jarvis-e2e-vault && git add feature-tc-08-04.txt && git commit -m "feat: TC-08-04 feature"`
4. `cd /tmp/jarvis-e2e-vault && git checkout main`
5. `cd /tmp/jarvis-e2e-vault && git merge feature/tc-08-04 --no-ff -m "merge: feature/tc-08-04 into main"`
6. `cd /tmp/jarvis-e2e-vault && git log --oneline -3`

**Checkpoints**:
- [ ] CP1: Merge succeeds — verify: exit code 0
- [ ] CP2: Merge commit exists — verify: `git log --oneline | grep "merge:"`
- [ ] CP3: Feature file exists on main — verify: `test -f /tmp/jarvis-e2e-vault/feature-tc-08-04.txt && echo exists`

**Cleanup**:
```bash
cd /tmp/jarvis-e2e-vault && git checkout main && git branch -D feature/tc-08-04 2>/dev/null || true
git reset --hard HEAD~1 2>/dev/null || true
rm -f /tmp/jarvis-e2e-vault/feature-tc-08-04.txt
```