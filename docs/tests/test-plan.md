# jarvis-server-ts — Manual Test Plan

## 1. Overview

**System:** jarvis-server-ts (TypeScript/Bun/NestJS/Temporal)
**Epic:** 13 — Python → TypeScript Migration
**Reference:** `_bmad-output/implementation-artifacts/test-design-epic-13.md`
**Date:** 2026-05-12

Manual testing covers two tiers:

| Tier | Description | Coverage |
|------|-------------|----------|
| **Tier 1** | Critical path smoke — verifies the automated E2E suite against live infrastructure | P0 scenarios in E2E suite |
| **Tier 2** | Real LLM + real GitHub vault — validates actual agent output quality and git-ops with PR creation | P2/P3 gaps from test design |

## 2. Scope

### In-Scope
- JARVIS_API_KEY auth on all endpoints
- Dream pipeline (light + deep) end-to-end
- Vault git-ops (local mode — no remote; github mode — real PR)
- Temporal coordinator bootstrap and signal delivery
- Memory context assembly
- Health indicators

### Out-of-Scope
- Plugin MCP server (covered by `npx vitest run` in jarvis-claude-plugin)
- MemU service internals (external, tested through proxy)
- PostgreSQL schema migrations (covered by integration tests)

## 3. Design References

| Document | Path | Covers |
|----------|------|--------|
| Epic 13 Test Design | `_bmad-output/implementation-artifacts/test-design-epic-13.md` | Full P0/P1/P2/P3 coverage plan, risk matrix, effort estimates |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | System components, data flow |
| Testing Strategy | `_bmad-output/planning-artifacts/design/testing-strategy.md` | Test levels, tooling |
| jarvis-module-map | `docs/systems/jarvis-module-map.md` | Module boundaries, key services |

## 4. Test Environment

### Tier 1 — API Mock Infrastructure

```
Infrastructure: docker-compose.e2e.yml
 Ports:         Postgres :5433, Redis :6380, Temporal :7234+8234, MemU :8001, API Mock :11435
 Build:         bun install --frozen-lockfile (Bun)
 Auth:          API_KEY=jarvis-e2e-test-key (from .env.e2e)
 Vault:         /tmp/jarvis-e2e-vault (seeded by E2ETestSetup.ensureVaultCloned())
 LLM:           api-mock-server on :11435 (programmable stubs)
```

**Setup:**
```bash
cd /Users/tannt/Works/GIT/Personal/Sources/the-garden/components/jarvis-server-ts
docker compose -f docker-compose.e2e.yml up -d --wait
bun run test:e2e  # smoke: 20/21 suites, 102/103 tests passing
```

### Tier 2 — Real LLM + GitHub Vault

```
Infrastructure: docker-compose.manual-test.yml
 Ports:         Postgres :15432, Redis :16379, Temporal :17233+18233, MemU :18001, jarvis-server :8100
 Build:         docker compose build --no-cache jarvis-server
 Auth:          JARVIS_API_KEY=manual-test-api-key
 Vault:         Cloned from JARVIS_MANUAL_GH_REPO into /app/ai-memory (vault-init sidecar)
 LLM:           Real OpenAI-compatible endpoint (JARVIS_MANUAL_OPENAI_URL/TOKEN/MODEL)
 GitHub:        Real GH_TOKEN for PR creation (MEMORY_STORAGE_MODE=github)
```

**Prerequisites (already configured in machine env):**
```bash
# Verified values (source ~/.zshrc or machine env):
#   JARVIS_MANUAL_GH_REPO=https://github.com/parasite2060/ai-memory-manual-test
#   JARVIS_MANUAL_GH_TOKEN=<ghp_...>
#   JARVIS_MANUAL_OPENAI_URL=https://api.minimax.io/v1
#   JARVIS_MANUAL_OPENAI_TOKEN=<token>
#   JARVIS_MANUAL_OPENAI_MODEL=MiniMax-M2.7
cp .env.manual-test.example .env.manual-test
# Values auto-populated from machine env by docker compose or manually set above
```

**Setup:**
```bash
docker compose -f docker-compose.manual-test.yml --env-file .env.manual-test build --no-cache jarvis-server
docker compose -f docker-compose.manual-test.yml --env-file .env.manual-test up -d --wait
# Verify: curl -s http://localhost:8100/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('healthy' if d.get('application',{}).get('status')=='up' else 'unhealthy')"
```

## 5. Test Case Index

### Tier 1 — Critical Path (API Mock)

| TC-ID | Name | Priority | Category | Design Ref |
|-------|------|----------|----------|------------|
| TC-01-01 | GET /health — all indicators up | Critical | Infra | test-design-epic-13.md §P0 |
| TC-01-02 | POST /dream — 202 + queued status | Critical | Dream Pipeline | test-design-epic-13.md §P0 |
| TC-01-03 | POST /dream with sourceDate — submitDeep signal | Critical | Dream Pipeline | test-design-epic-13.md §P0 |
| TC-01-04 | POST /dream with invalid sourceDate — 400 | Critical | Error Handling | test-design-epic-13.md §P0 |
| TC-01-05 | POST /conversations — ingest + dedup | Critical | Conversation | test-design-epic-13.md §P0 |
| TC-01-06 | GET /memory/context — 200 + structure | Critical | Memory | test-design-epic-13.md §P0 |
| TC-01-07 | Error envelope — flat shape, correct fields | Critical | Error Handling | test-design-epic-13.md §P0 |
| TC-01-08 | POST /dream deep pipeline — phases rows created | Critical | Temporal | test-design-epic-13.md §P0 |
| TC-01-09 | POST /dream light pipeline — daily log updated | Critical | Temporal | test-design-epic-13.md §P0 |
| TC-01-10 | Vault manifest — file serving + structure | High | Vault | test-design-epic-13.md §P1 |
| TC-01-11 | Memory search — results returned | High | Memory | test-design-epic-13.md §P1 |

### Tier 2 — Real LLM + Real GitHub (P2/P3 gaps)

| TC-ID | Name | Priority | Category | Design Ref |
|-------|------|----------|----------|------------|
| TC-02-01 | Real LLM — deep dream end-to-end with real token generation | Critical | LLM Integration | test-design-epic-13.md §P2 |
| TC-02-02 | Real LLM — light dream end-to-end with daily log update | Critical | LLM Integration | test-design-epic-13.md §P2 |
| TC-02-03 | Real LLM — weekly review generates memories | High | LLM Integration | test-design-epic-13.md §P1 |
| TC-02-04 | GitHub mode — MEMORY_STORAGE_MODE=github, real PR created | High | GitOps | test-design-epic-13.md §P2 |
| TC-02-05 | Vault sync — 30-min periodic sync, context cache invalidated | High | Vault | test-design-epic-13.md §R-005 |
| TC-02-06 | GET /config + PATCH /config — verify config.yml updated | Medium | Config | test-design-epic-13.md §P2 |
| TC-02-07 | Context assembly — warm <500ms, cold <3s | Medium | Performance | test-design-epic-13.md §P3 |
| TC-02-08 | VaultSyncService — pull → manifest → sync → invalidate cycle | Medium | Vault | test-design-epic-13.md §P2 |

## 6. Test Data

### Vault Seed (Tier 1)
- Vault path: `/tmp/jarvis-e2e-vault`
- Seeded by `E2ETestSetup.ensureVaultCloned()` with SOUL.md, IDENTITY.md, MEMORY.md, config.yml, dailys/ (30 days)

### Real Vault (Tier 2)
- Cloned from `JARVIS_MANUAL_GH_REPO` by vault-init sidecar into `/app/ai-memory`
- Real conversation history, decisions, lessons from production use

### LLM Stubs (Tier 1)
- Registered via `ApiMockHelper` in test helpers
- Phase stubs: `phase1Stub()`, `phase2Stub()`, `phase3Stub()`, `healthFixStub()` from `test/fixtures/llm-stubs.ts`

### Real LLM (Tier 2)
- Endpoint: `JARVIS_MANUAL_OPENAI_URL`
- Model: `JARVIS_MANUAL_OPENAI_MODEL`
- Key: `JARVIS_MANUAL_OPENAI_TOKEN`

## 7. Pass/Fail Criteria

| Category | Pass Criteria |
|----------|---------------|
| Functional | All checkpoints pass; no 500 errors; correct status codes |
| Quality | Response structure matches expected schema; no truncation |
| Resilience | Temporal workflows complete; vault ops succeed; no data loss |
| Performance | Context assembly warm <500ms, cold <3s (Tier 2) |

## 8. Known Limitations

- LLM non-determinism: Tier 2 tests verify structure and presence of sections, not exact content. Run 3x for majority pass.
- Timing: Temporal workflows may take 2-5 minutes. Poll intervals: 10s, timeout 5 min.
- Vault: Tier 2 github mode requires valid GH_TOKEN with repo scope.
- One E2E suite skipped by design: `conversation.e2e-spec.ts` — waitFor() not signaled by api-mock.

## 9. Exit Criteria

- [ ] Tier 1: All 11 TCs pass (11/11)
- [ ] Tier 2: All 8 TCs pass (8/8)
- [ ] P0 pass rate = 100%
- [ ] P1 pass rate ≥ 95%