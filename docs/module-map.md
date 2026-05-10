# Jarvis Module Map

**Status:** approved by TanNT 2026-05-07 — Story 13.0 done
**Created:** 2026-05-07
**Authority:** [`./application-design.md`](./application-design.md) (Clean Architecture rules) + [`../../../../_bmad-output/planning-artifacts/architecture.md`](../../../../_bmad-output/planning-artifacts/architecture.md) (Jarvis architecture)
**Story:** 13.0 — gates all Epic 13 implementation work
**Locked decisions:** A.1=Command (sync invalidation per activity); A.3=sibling subfolder layout (`temporal/`, `agents/`, `scoring/`).
**Superseded by TanNT 2026-05-08 binding ruling "follow §1 exactly":** A.2 (grouped activities → §1 prescribes per-activity files); A.4 (no TriggerLightDreamCommand layer → §1 prescribes commands/ folder with the trigger command + handler).

---

## Purpose

This document is the **structure-review checkpoint** before any code lands in `src/modules/` or new code lands in `src/shared/`. It enumerates:

1. The proposed business module tree (`src/modules/`).
2. Shared infrastructure extensions to `src/shared/`.
3. Domain entities, repository interfaces, API interfaces.
4. Mapping from each Python file in `components/jarvis-server/app/` to its TypeScript home.
5. Every cross-business-module flow as a typed Command or Event (per `../../../../_bmad-output/planning-artifacts/architecture.md §1.4 principle 8`).
6. Worked naming examples per app-design §7.2.
7. App-design section cross-references for every rule applied.

Until TanNT signs off, no code is written under `src/modules/` and no new files are added to `src/shared/` (Story 13.1 unblocks once approved).

---

## 1. Proposed `src/modules/` tree

Six business modules. Names + directory layout below.

```
src/modules/
├── conversation/
│   ├── conversation.controller.ts            ◄── single controller (app-design §7.6)
│   ├── conversation.module.ts
│   ├── usecases/
│   │   ├── ingest-transcript.usecase.ts
│   │   ├── get-position.usecase.ts
│   │   └── index.ts                          ◄── exports `UseCases` array only (app-design §7.4)
│   ├── events/
│   │   ├── conversation-ingested.event.ts    ◄── intra-module + cross-module trigger for light dream
│   │   └── index.ts                          (no handlers in this module — see §5)
│   └── models/
│       ├── requests/
│       │   ├── ingest-transcript.request.ts
│       │   └── get-position.request.ts
│       ├── responses/
│       │   └── ingest-transcript.response.ts
│       └── presenters/
│           └── transcript-position.presenter.ts
│
├── memory/
│   ├── memory.controller.ts                  ◄── /memory/search, /memory/add, /memory/soul, /memory/identity
│   ├── memory.module.ts
│   ├── usecases/
│   │   ├── search-memory.usecase.ts
│   │   ├── add-memory.usecase.ts
│   │   ├── get-soul.usecase.ts
│   │   ├── get-identity.usecase.ts
│   │   └── index.ts
│   ├── commands/                             ◄── handlers for cross-module commands targeting memory
│   │   ├── handlers/
│   │   │   └── (none in MVP — memory is leaf)
│   │   └── index.ts
│   ├── events/
│   │   └── index.ts                          (none in MVP)
│   └── models/{requests,responses,presenters}/
│
├── context/
│   ├── context.controller.ts                 ◄── GET /memory/context
│   ├── context.module.ts
│   ├── usecases/
│   │   ├── assemble-context.usecase.ts
│   │   └── index.ts
│   ├── commands/
│   │   ├── invalidate-context-cache.command.ts   ◄── exposed for OTHER modules to dispatch
│   │   ├── handlers/
│   │   │   ├── invalidate-context-cache.handler.ts
│   │   │   └── index.ts                      ◄── exports `CommandHandlers` array only
│   │   └── index.ts                          ◄── exports `Commands` array only
│   └── models/{requests,responses,presenters}/
│
├── vault/
│   ├── vault.controller.ts                   ◄── /memory/files/manifest, /memory/files/{path}
│   ├── vault.module.ts
│   ├── usecases/
│   │   ├── get-manifest.usecase.ts
│   │   ├── get-vault-file.usecase.ts
│   │   ├── write-vault-file.usecase.ts       ◄── invoked via WriteVaultFileCommand from dream
│   │   └── index.ts
│   ├── commands/
│   │   ├── write-vault-file.command.ts       ◄── exposed for dream module
│   │   ├── handlers/
│   │   │   ├── write-vault-file.handler.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── events/
│   │   ├── vault-file-updated.event.ts       ◄── fire-and-forget; manifest cache invalidation
│   │   └── index.ts
│   └── models/{requests,responses,presenters}/
│
├── dream/
│   ├── dream.controller.ts                   ◄── POST /dream
│   ├── dream.module.ts
│   ├── usecases/
│   │   ├── trigger-light-dream.usecase.ts    ◄── invoked via TriggerLightDreamCommand from conversation
│   │   ├── trigger-deep-dream.usecase.ts     ◄── invoked from POST /dream and from Temporal Schedule
│   │   ├── trigger-weekly-review.usecase.ts  ◄── invoked from Temporal Schedule
│   │   └── index.ts
│   ├── commands/
│   │   ├── trigger-light-dream.command.ts    ◄── exposed for conversation module
│   │   ├── handlers/
│   │   │   ├── trigger-light-dream.handler.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── events/
│   │   ├── dream-completed.event.ts          ◄── fire-and-forget; consumers: context (cache invalidation)
│   │   └── index.ts
│   ├── temporal/
│   │   ├── workflows/                        ◄── SANDBOXED — workflows MUST NOT import from src/modules/ or src/shared/
│   │   │   ├── dream-coordinator.workflow.ts
│   │   │   ├── light-dream.workflow.ts
│   │   │   ├── deep-dream.workflow.ts
│   │   │   ├── weekly-review.workflow.ts
│   │   │   └── schedule-signal-relay.workflow.ts
│   │   └── activities/                       ◄── NestJS providers; injected with shared services
│   │       ├── light/
│   │       │   ├── load-transcript.activity.ts
│   │       │   ├── run-extraction.activity.ts
│   │       │   ├── run-record.activity.ts
│   │       │   ├── persist-session-log.activity.ts
│   │       │   ├── update-transcript-position.activity.ts
│   │       │   ├── invalidate-context-cache.activity.ts
│   │       │   ├── commit-and-pr.activity.ts
│   │       │   ├── mark-dream-outcome.activity.ts            ◄── TS-port enhancement (Story 13.10 Q13); §1 amended 2026-05-08 by TanNT (Q8)
│   │       │   └── index.ts
│   │       ├── deep/
│   │       │   ├── gather-inputs.activity.ts
│   │       │   ├── run-phase1-light-sleep.activity.ts
│   │       │   ├── score-candidates.activity.ts
│   │       │   ├── run-phase2-rem-sleep.activity.ts
│   │       │   ├── run-phase3-deep-sleep.activity.ts
│   │       │   ├── run-health-check.activity.ts
│   │       │   ├── run-health-fix.activity.ts
│   │       │   ├── write-files.activity.ts
│   │       │   ├── align-memu.activity.ts
│   │       │   ├── commit-and-pr.activity.ts
│   │       │   ├── invalidate-context-cache.activity.ts
│   │       │   ├── mark-deep-dream-outcome.activity.ts       ◄── TS-port enhancement (Story 13.11 Q13); §1 amended 2026-05-08 by TanNT (Q8)
│   │       │   └── index.ts
│   │       ├── weekly/
│   │       │   ├── gather-dailys.activity.ts
│   │       │   ├── gather-indexes.activity.ts
│   │       │   ├── run-weekly-review-agent.activity.ts
│   │       │   ├── write-review-file.activity.ts
│   │       │   ├── commit-and-pr.activity.ts
│   │       │   ├── invalidate-context-cache.activity.ts
│   │       │   ├── mark-weekly-review-outcome.activity.ts    ◄── TS-port enhancement (Story 13.12 Q8); §1 amended 2026-05-08 by TanNT (Q8)
│   │       │   └── index.ts
│   │       └── index.ts                      ◄── re-exports each subfolder's array
│   ├── agents/
│   │   ├── light-extraction.agent.ts         ◄── deepagents-based; built via DeepAgentFactory
│   │   ├── light-record.agent.ts
│   │   ├── deep-phase1.agent.ts
│   │   ├── deep-phase2.agent.ts
│   │   ├── deep-phase3.agent.ts
│   │   ├── health-fix.agent.ts
│   │   └── weekly-review.agent.ts
│   ├── scoring/
│   │   └── calculate-candidate-score.ts      ◄── pure deterministic TS — NOT an LLM call
│   └── models/{requests,responses,presenters}/
│
└── config/
    ├── config.controller.ts                  ◄── GET /config, PATCH /config
    ├── config.module.ts
    ├── usecases/
    │   ├── get-config.usecase.ts
    │   ├── update-config.usecase.ts
    │   └── index.ts
    ├── events/
    │   ├── cron-changed.event.ts             ◄── consumed by dream module to re-register Temporal Schedules
    │   └── index.ts
    └── models/{requests,responses,presenters}/
```

### Module rationale

| Module | Why it exists | Bounded context |
|---|---|---|
| `conversation` | Owns transcript ingestion + position tracking. Single producer of `ConversationIngestedEvent`. | Inbound writes from the plugin. |
| `memory` | Owns the MemU proxy + the simple read endpoints (SOUL/IDENTITY/MEMORY raw). Calls `vault` via `GetVaultFileCommand` (CommandBus) for SOUL/IDENTITY/MEMORY raw reads. | Semantic search facade. |
| `context` | Owns the assembled session-start payload + its cache + the cache-invalidation command. | Read-side composition. |
| `vault` | Owns vault file I/O (manifest + read + write). Wraps `VAULT_PATH` filesystem access. | Filesystem boundary. |
| `dream` | Owns dream pipelines (light/deep/weekly) — Temporal workflows + activities + deepagents agents + scoring. | Async processing core. |
| `config` | Owns vault `config.yml` get/patch + cron change notification. | Config surface. |

A `health/` business module is NOT created — the boilerplate's `src/shared/health/` is sufficient. We add a custom `TemporalIndicator` there, but the controller stays where the boilerplate puts it.

---

## 2. Proposed `src/shared/` extensions

The boilerplate already provides `config/`, `logger/`, `health/`, `common/`, `postgres/`, `mongo/`, `api/`, `event/`, `domain/`. Jarvis adds:

```
src/shared/
├── temporal/                                 ◄── NEW
│   ├── temporal.module.ts                    @Global
│   ├── temporal-client.service.ts            ◄── client + signalCoordinator(...) + registerSchedules(...)
│   ├── temporal-worker.service.ts            ◄── worker bootstrap + collectActivities(app) helper
│   └── decorators/
│       └── temporal-activity.decorator.ts    ◄── @TemporalActivity('name') for collector
│
├── git/                                      ◄── NEW
│   ├── git.module.ts                         @Global
│   ├── git-ops.service.ts                    ◄── simple-git wrapper (pull/branch/commit/push) + gh CLI for PR
│   └── errors.ts                             ◄── GitOpsRebaseConflictError, etc.
│
├── agents/                                   ◄── NEW
│   ├── agents.module.ts                      @Global
│   └── deep-agent.factory.ts                 ◄── createDeepAgent + AzureChatOpenAI; tools wired by caller
│
└── secret-redaction/                         ◄── NEW
    ├── secret-redaction.module.ts            @Global
    ├── secret-scrubber.service.ts
    └── patterns.ts                           ◄── versioned regex catalogue
```

The boilerplate's `src/shared/event/` (Kafka auto-publisher) is **kept but neutered** — Jarvis MVP does not publish to Kafka. Story 13.16.5 decides whether to delete the Kafka path entirely or replace it with a no-op. For MVP, domain events are EventBus-only (in-process).

The boilerplate's `src/shared/mongo/` is **deleted in Story 13.16.5** — Jarvis is Postgres-only.

---

## 3. Domain layer (`src/shared/domain/`)

### 3.1 Entities (`src/shared/domain/entities/`)

Plain TypeScript classes — no framework imports, no decorators, no DB-specific code (app-design §1.7).

| Entity | Properties | Source |
|---|---|---|
| `Conversation` | `id`, `sessionId`, `transcript`, `source`, `segmentStartLine`, `segmentEndLine`, `isContinuation`, `createdAt` | Mirrors `transcripts` table |
| `Dream` | `id`, `sessionId?`, `date?`, `kind` (`light`\|`deep`\|`weekly`), `outcome` (`success`\|`partial`\|`failed`), `sessionLog?` (JSONB), `filesModified`, `prUrl?`, `createdAt`, `completedAt?` | Mirrors `dreams` table |
| `DreamPhase` | `id`, `dreamId`, `phase` (enum), `runPrompt`, `outputJson`, `conversationHistory`, `tokenUsageInput`, `tokenUsageOutput`, `toolCallCount`, `startedAt`, `completedAt?`, `durationMs?`, `outcome` | Mirrors `dream_phases` table |
| `FileManifestEntry` | `path`, `hash`, `updatedAt` | Mirrors `file_manifest` table |
| `ContextCache` (value object) | `key`, `payload`, `expiresAt` | In-memory only — lifetime-managed by `@nestjs/cache-manager` |

### 3.2 Repository interfaces (`src/shared/domain/repositories/`)

DI tokens are Symbols (app-design §1.6). Implementations in `src/shared/postgres/repository/`; wired in `postgres.module.ts`.

| Token | Interface | Methods |
|---|---|---|
| `CONVERSATION_REPOSITORY` | `IConversationRepository` | `insertTranscript`, `findBySessionId`, `getLastProcessedLine`, `setLastProcessedLine`, `findRecentBySession` (60s dedup window) |
| `DREAM_REPOSITORY` | `IDreamRepository` | `createDream`, `updateDreamOutcome`, `persistSessionLog`, `findByDate`, `findById` |
| `DREAM_PHASE_REPOSITORY` | `IDreamPhaseRepository` | `recordPhase`, `findByDreamId`, `findRecentPhasesByKind` (for budget audit) |
| `FILE_MANIFEST_REPOSITORY` | `IFileManifestRepository` | `upsertEntry`, `getAll`, `getByPath`, `deleteByPath` |

Note: there is **no `ContextCacheRepository`** — context cache lives entirely in `@nestjs/cache-manager` in-memory; no Postgres persistence (architecture.md §6.6 — Redis removed in Epic 12 and not reintroduced).

### 3.3 API interfaces (`src/shared/domain/apis/`)

External service contracts. Implementations in `src/shared/api/impl/`; wired in `api.module.ts`.

| Token | Interface | Implementation |
|---|---|---|
| `MEMU_API` | `IMemuApi` (search, memorize) | `MemuApiService` (`@nestjs/axios` HttpService) |
| `AZURE_OPENAI_API` | `IAzureOpenAIApi` (rare direct usage; usually goes through DeepAgentFactory) | `AzureOpenAIApiService` |
| `GITHUB_API` | `IGitHubApi` (`createPullRequest`, `findPullRequestByBranch`) | `GitHubApiService` (gh CLI subprocess wrapper) — could be implemented via Octokit later |

`MEMU_API`, `AZURE_OPENAI_API`, `GITHUB_API` are Symbol tokens. Use cases inject the interface, never the impl.

---

## 4. Python → TypeScript file absorption

Each Python file in `components/jarvis-server/app/` maps to one or more TS targets.

### 4.1 Top-level + bootstrap

| Python | TypeScript | Notes |
|---|---|---|
| `app/main.py` | `src/main.ts` (boilerplate-default) + Temporal worker bootstrap added | Story 13.8 |
| `app/config.py` | `src/shared/config/config.schema.ts` + `config.service.ts` | Story 13.1 |
| `app/run_worker.py` | absorbed into `src/main.ts` (worker is co-located) | Story 13.8 |
| `app/temporal_client.py` | `src/shared/temporal/temporal-client.service.ts` | Story 13.8 |
| `app/temporal_worker.py` | `src/shared/temporal/temporal-worker.service.ts` | Story 13.8 |
| `app/temporal_schedules.py` | `src/shared/temporal/temporal-client.service.ts :: registerSchedules()` | Story 13.13 |

### 4.2 Routes → Controllers

| Python | TypeScript |
|---|---|
| `app/api/routes/health.py` | `src/shared/health/health.controller.ts` (boilerplate) — Jarvis adds custom indicators |
| `app/api/routes/conversations.py` | `src/modules/conversation/conversation.controller.ts` |
| `app/api/routes/memory.py` | `src/modules/memory/memory.controller.ts` (search/add/soul/identity) + `src/modules/context/context.controller.ts` (context) + `src/modules/vault/vault.controller.ts` (files/manifest, files/{path}) — split because the Python single-router conflated three bounded contexts |
| `app/api/routes/files.py` | merged into `src/modules/vault/vault.controller.ts` (already covered above) |
| `app/api/routes/dream.py` | `src/modules/dream/dream.controller.ts` |
| `app/api/routes/config.py` | `src/modules/config/config.controller.ts` |
| `app/api/deps.py` | `src/shared/common/guards/api-key.guard.ts` + middleware (Story 13.1) |

### 4.3 Services → Use cases / shared services

| Python | TypeScript | Layer |
|---|---|---|
| `app/services/context_assembly.py` | `src/modules/context/usecases/assemble-context.usecase.ts` | Use case |
| `app/services/context_cache.py` | absorbed into `assemble-context.usecase.ts` via `@nestjs/cache-manager` decorators | — |
| `app/services/cron_parser.py` | absorbed into `src/modules/config/usecases/update-config.usecase.ts` (croniter → `cron-parser` npm) | Use case |
| `app/services/deep_dream.py` | exploded into `src/modules/dream/temporal/activities/deep/*` (one activity per phase) | Activities |
| `app/services/dream_agent.py` | `src/shared/agents/deep-agent.factory.ts` + `src/modules/dream/agents/*.agent.ts` | Shared + Module |
| `app/services/dream_models.py` | Zod schemas under `src/modules/dream/agents/schemas/*.schema.ts` | Module-internal |
| `app/services/dream_telemetry.py` | absorbed into `src/shared/postgres/repository/dream-phase.repository.impl.ts` | Repository |
| `app/services/file_manifest.py` | `src/modules/vault/usecases/get-manifest.usecase.ts` | Use case |
| `app/services/git_ops.py` | `src/shared/git/git-ops.service.ts` | Shared service |
| `app/services/memory_files.py` | split: simple reads → `src/modules/memory/usecases/get-soul.usecase.ts` + `get-identity.usecase.ts`; vault writes → `src/modules/vault/usecases/write-vault-file.usecase.ts` | Use cases |
| `app/services/memory_updater.py` | absorbed into `src/modules/dream/temporal/activities/deep/write-files.activity.ts` | Activity |
| `app/services/memu_client.py` | `src/shared/api/impl/memu-api.service.ts` | Shared API impl |
| `app/services/secret_scrubber.py` | `src/shared/secret-redaction/secret-scrubber.service.ts` | Shared service |
| `app/services/transcript_parser.py` | absorbed into `src/modules/conversation/usecases/ingest-transcript.usecase.ts` | Use case |
| `app/services/transcript_shape.py` | absorbed into `ingest-transcript.usecase.ts` | Use case |
| `app/services/vault_updater.py` | `src/modules/vault/usecases/write-vault-file.usecase.ts` (writes are now command-driven from dream) | Use case |

### 4.4 Workflows + Activities → Temporal layer

| Python | TypeScript |
|---|---|
| `app/workflows/coordinator.py` | `src/modules/dream/temporal/workflows/dream-coordinator.workflow.ts` |
| `app/workflows/light_dream_workflow.py` | `src/modules/dream/temporal/workflows/light-dream.workflow.ts` |
| `app/workflows/deep_dream_workflow.py` | `src/modules/dream/temporal/workflows/deep-dream.workflow.ts` |
| `app/workflows/weekly_review_workflow.py` | `src/modules/dream/temporal/workflows/weekly-review.workflow.ts` |
| `app/workflows/schedule_relay.py` | `src/modules/dream/temporal/workflows/schedule-signal-relay.workflow.ts` |
| `app/activities/light/*.py` (7 files) | `src/modules/dream/temporal/activities/light/*.activity.ts` (7 files, name-equivalent) |
| `app/activities/deep/*.py` (11 files) | `src/modules/dream/temporal/activities/deep/*.activity.ts` (11 files, name-equivalent) |
| `app/activities/weekly/*.py` (5 files) | `src/modules/dream/temporal/activities/weekly/*.activity.ts` (5 files, name-equivalent) |

Activities are NestJS `@Injectable()` services decorated with `@TemporalActivity('name')`. The decorator registers them with `TemporalWorkerService`'s collector at module init.

### 4.5 Models → Domain entities + TypeORM schemas

| Python | TypeScript |
|---|---|
| `app/models/tables.py` | `src/shared/postgres/schema/*.schema.ts` (one file per entity) — Story 13.2 |
| `app/models/db.py` | absorbed into TypeORM module bootstrap (`src/shared/postgres/postgres.module.ts`) |
| `app/models/conversation_schemas.py` | request/response DTOs in `src/modules/conversation/models/` |
| `app/models/config_schemas.py` | request/response DTOs in `src/modules/config/models/` |
| `app/models/memory_proxy_schemas.py` | request/response DTOs in `src/modules/memory/models/` |

### 4.6 Core

| Python | TypeScript |
|---|---|
| `app/core/logging.py` | `src/shared/logger/` (boilerplate-default pino) |
| `app/core/exceptions.py` | `src/shared/common/filters/exception.filter.ts` (boilerplate-default) + `src/utils/error.code.ts` (boilerplate-default) |

---

## 5. Cross-module flows — every arrow as a typed Command or Event

This is the heart of the structure-review checkpoint. Per [`../../../../_bmad-output/planning-artifacts/architecture.md §1.4 principle 8`](../../../../_bmad-output/planning-artifacts/architecture.md): **business modules MUST NOT call other business modules directly**. Every cross-module arrow below is either a `CommandBus.execute(...)` (sync, returns Presenter) or an `EventBus.publish(...)` (fire-and-forget).

### 5.1 Diagram

```
┌────────────────┐    submitLight signal       ┌─────────────────────────┐
│  conversation  │ ──────(Temporal client)───► │ Temporal coordinator    │
└────────────────┘                             │ (dream module's worker) │
                                                └─────────────────────────┘
                                                          │
┌────────────────┐  TriggerLightDreamCommand              │ child workflow
│  conversation  │ ──────────────────────────►┌────────┐  ▼
└────────────────┘  (alt path — see §5.2.1)   │ dream  │  ◄── light/deep/weekly workflow runs
                                              └────────┘
                                                  │  ↓ activities (in-process, NestJS DI):
                                                  │   ├─► WriteVaultFileCommand → vault module handler
                                                  │   ├─► uses MemuApi (shared, direct injection — OK)
                                                  │   ├─► uses GitOpsService (shared, direct injection — OK)
                                                  │   └─► uses DeepAgentFactory (shared, direct injection — OK)
                                                  ↓
                                              DreamCompletedEvent (publish)
                                                  ↓
                                              context module's EventsHandler invalidates cache
                                                  AND
                                              vault module's EventsHandler refreshes manifest
                                                  AND
                                              dream module's EventsHandler updates last-dream metric

┌────────────────┐    InvalidateContextCacheCommand        ┌──────────┐
│ dream activity │ ─────(if more granular control needed)─►│ context  │
└────────────────┘                                          └──────────┘
                                                            (sync handler — clears cache)

┌────────────────┐    CronChangedEvent                     ┌──────────┐
│  config        │ ────────────────────────────────────►   │  dream   │
└────────────────┘                                          └──────────┘
                                                            (re-registers Temporal Schedule)
```

### 5.2 Cross-module flow catalogue

Every typed cross-module hop, source/target, payload shape, return type, sync vs. fire-and-forget.

#### 5.2.1 `conversation` → `dream`: trigger light dream

| Field | Value |
|---|---|
| **Mechanism** | `TemporalClientService.signalCoordinator('submitLight', payload)` (PRIMARY) — see note |
| **Payload** | `{ sessionId: string, transcriptId: string }` |
| **Source** | `IngestTranscriptUseCase` in `src/modules/conversation/usecases/` |
| **Handler** | The `dreamCoordinatorWorkflow` consumes the signal; `dream` module owns the coordinator |
| **Return** | void (signal — fire-and-forget at the HTTP boundary; Temporal makes it durable) |
| **Why not a CommandBus call?** | The trigger is durable through Temporal's signal queue, not in-process. CommandBus is in-process only. The shared `TemporalClientService` is the right boundary — `conversation` injects `TemporalClientService` from `src/shared/temporal/`, which is allowed (shared service injection per architecture.md §8.9). |
| **Note for reviewers** | Flag explicitly in the module map so reviewers don't confuse "conversation calls dream-the-shared-service" with "conversation calls dream-the-business-module directly". The shared Temporal service IS the cross-module API. |

> **Alternative (rejected for MVP):** A `TriggerLightDreamCommand` dispatched via CommandBus would also work — its handler in `dream` module would forward to Temporal. But that adds a layer for no durability gain. Keep the direct shared-service path.

#### 5.2.2 `dream` → `context`: invalidate context cache

| Field | Value |
|---|---|
| **Command** | `InvalidateContextCacheCommand` |
| **Payload** | `{ reason: 'lightDream' \| 'deepDream' \| 'weeklyReview' \| 'manual', timestamp: Date }` |
| **Source** | `invalidate-context-cache.activity.ts` in `src/modules/dream/temporal/activities/{light,deep,weekly}/` |
| **Handler** | `InvalidateContextCacheHandler` in `src/modules/context/commands/handlers/` |
| **Return** | void (sync — handler completes before activity returns) |
| **Why CommandBus, not EventBus?** | The activity needs to know the cache invalidation succeeded before marking the dream done. A failed invalidation is non-fatal (cache will TTL out in 30 min) but is logged. Sync handler gives observable success/failure. |
| **Defines** | `src/modules/context/commands/invalidate-context-cache.command.ts` (the Command class is owned by the target module — context — and exported for callers). |

#### 5.2.3 `dream` → `vault`: write a vault file

| Field | Value |
|---|---|
| **Command** | `WriteVaultFileCommand` |
| **Payload** | `{ relativePath: string, content: string, expectedHash?: string }` (`expectedHash` for optimistic concurrency — empty string means "don't check") |
| **Source** | `write-files.activity.ts` (deep dream) and `run-record.activity.ts` (light dream) |
| **Handler** | `WriteVaultFileHandler` in `src/modules/vault/commands/handlers/` |
| **Return** | `VaultWritePresenter` — `{ relativePath, newHash, sizeBytes }` |
| **Why CommandBus?** | Cross-module — `dream` activities must not inject `vault` use cases directly. The handler centralises the FS-boundary checks (path traversal, glob restrictions for record agent). |
| **Defines** | `src/modules/vault/commands/write-vault-file.command.ts` |

> Glob restrictions: when the record agent's `writeFile` tool is invoked, the **factory closure** in `src/modules/dream/agents/light-record.agent.ts` validates the glob (e.g., `dailys/*.md`) BEFORE dispatching the command. The vault handler trusts the path because the boundary check happened upstream.

#### 5.2.4 `dream` → all: dream completed (broadcast)

| Field | Value |
|---|---|
| **Event** | `DreamCompletedEvent` |
| **Payload** | `{ dreamId: string, kind: 'light' \| 'deep' \| 'weekly', outcome: 'success' \| 'partial' \| 'failed', filesModified: string[], prUrl?: string, completedAt: Date }` |
| **Source** | The final activity in each dream workflow before the workflow ends |
| **Handlers** | (a) `context` module's `DreamCompletedEventsHandler` → invalidate context cache (alternative to §5.2.2 — pick ONE, see decision note); (b) `vault` module's `DreamCompletedEventsHandler` → refresh `file_manifest` table from disk; (c) `dream` module's own internal handler → record metrics |
| **Return** | void (fire-and-forget; each handler runs independently) |
| **Defines** | `src/modules/dream/events/dream-completed.event.ts` |

> **Decision needed from TanNT (Review Note):** §5.2.2 (CommandBus, sync, granular per activity) vs. §5.2.4 (EventBus, fire-and-forget, one-shot at workflow end) for cache invalidation. Both paths are documented; the codebase should pick ONE and stick to it. Recommendation: **use §5.2.2 (CommandBus)**. Reasoning: the activity is the right boundary because Temporal can retry it; the activity-level retry on failed invalidation is more useful than a fire-and-forget that silently fails. §5.2.4 still fires for OTHER consumers (vault manifest refresh, dream metrics) — just not for cache invalidation.

#### 5.2.5 `vault` → all: vault file updated (broadcast)

| Field | Value |
|---|---|
| **Event** | `VaultFileUpdatedEvent` |
| **Payload** | `{ relativePath: string, newHash: string, updatedAt: Date }` |
| **Source** | `WriteVaultFileHandler` after a successful write |
| **Handlers** | None in MVP. Reserved for future cache layers, search indexers, etc. |
| **Defines** | `src/modules/vault/events/vault-file-updated.event.ts` |

#### 5.2.6 `conversation` → all: transcript ingested (broadcast)

| Field | Value |
|---|---|
| **Event** | `ConversationIngestedEvent` |
| **Payload** | `{ sessionId: string, transcriptId: string, isContinuation: boolean, lineCount: number, ingestedAt: Date }` |
| **Source** | `IngestTranscriptUseCase` after persisting and signalling |
| **Handlers** | None in MVP. Reserved for future analytics. |
| **Why event, not command?** | Already-completed fact; observers can react if they want. |
| **Defines** | `src/modules/conversation/events/conversation-ingested.event.ts` |

#### 5.2.7 `config` → `dream`: cron schedule changed

| Field | Value |
|---|---|
| **Event** | `CronChangedEvent` |
| **Payload** | `{ kind: 'deepDream' \| 'weeklyReview', oldCron: string, newCron: string }` |
| **Source** | `UpdateConfigUseCase` after a successful `PATCH /config` that changed a cron field |
| **Handler** | `dream` module's `CronChangedEventsHandler` → calls `TemporalClientService.updateSchedule(...)` |
| **Return** | void (fire-and-forget — schedule re-registration is idempotent and self-healing) |
| **Defines** | `src/modules/config/events/cron-changed.event.ts` |

#### 5.2.8 `memory` → `vault`: read vault file

| Field | Value |
|---|---|
| **Command** | `GetVaultFileCommand({ path: 'SOUL.md' \| 'IDENTITY.md' \| 'MEMORY.md' })` |
| **Payload** | `{ path: string }` (relative to `AppConfigService.vaultPath`) |
| **Source** | `GetSoulUseCase`, `GetIdentityUseCase`, `GetMemoryFileUseCase` (all in `src/modules/memory/usecases/`) |
| **Handler** | `GetVaultFileHandler` in `src/modules/vault/commands/handlers/` (forwards to `GetVaultFileUseCase`) |
| **Return** | `{ content: string \| null, file_path: string }` — `null` content when missing or path-traversal-blocked (mirrors Python `read_vault_file`) |
| **Why CommandBus, not direct injection?** | Business-module → business-module direct injection forbidden (architecture.md §1.4 principle 8 + §8.9). VaultModule owns path resolution from `AppConfigService.vaultPath`. |
| **Defines** | `src/modules/vault/commands/get-vault-file.command.ts` (Story 13.4 stub; Story 13.6 retrofits the full vault module with manifest + file-by-path endpoints) |

### 5.3 What's NOT a cross-module call (don't get confused)

These look like cross-module but aren't — they're either intra-module or shared-service injections:

| Looks like | Is actually | Allowed? |
|---|---|---|
| Activity injects `MemuApiService` | `src/shared/api/impl/` injection | ✅ Direct injection |
| Activity injects `GitOpsService` | `src/shared/git/` injection | ✅ Direct injection |
| Activity injects `DeepAgentFactory` | `src/shared/agents/` injection | ✅ Direct injection |
| Activity injects `SecretScrubberService` | `src/shared/secret-redaction/` injection | ✅ Direct injection |
| Activity injects `TemporalClientService` (e.g., to start a child workflow) | `src/shared/temporal/` injection | ✅ Direct injection |
| Activity injects a use case in `src/modules/dream/usecases/` | Same-module injection | ✅ Direct injection |
| `DreamController` injects `TriggerDeepDreamUseCase` | Same-module injection | ✅ Direct injection |
| Use case injects `ConversationRepository` | Domain interface from `src/shared/domain/repositories/` (impl wired in `postgres.module.ts`) | ✅ Direct injection (Symbol token) |
| **Activity injects a use case from `src/modules/<other>/`** | **CROSS-MODULE — FORBIDDEN** | **❌ Use Command/Event instead** |

---

## 6. Worked naming examples

Per app-design §7.2:

| Component | Pattern | Jarvis example |
|---|---|---|
| Module | `{name}.module.ts` | `dream.module.ts` |
| Controller | `{name}.controller.ts` | `dream.controller.ts` |
| Use Case | `{action}-{noun}.usecase.ts` | `trigger-deep-dream.usecase.ts`, `assemble-context.usecase.ts` |
| Use Case class | `{Action}{Noun}UseCase` | `TriggerDeepDreamUseCase`, `AssembleContextUseCase` |
| Command | `{action}-{noun}.command.ts` | `invalidate-context-cache.command.ts`, `write-vault-file.command.ts` |
| Command class | `{Action}{Noun}Command` | `InvalidateContextCacheCommand`, `WriteVaultFileCommand` |
| Command Handler | `{action}-{noun}.handler.ts` | `invalidate-context-cache.handler.ts` |
| Handler class | `{Action}{Noun}Handler` | `InvalidateContextCacheHandler` |
| Event | `{noun}-{verb-past}.event.ts` | `dream-completed.event.ts`, `cron-changed.event.ts` |
| Event class | `{Noun}{Verb}Event` | `DreamCompletedEvent`, `CronChangedEvent` |
| Domain Event | `{noun}-{verb-past}.domain-event.ts` | (not used in Jarvis MVP — Kafka path disabled) |
| Request Model | `{action}-{noun}.request.ts` | `ingest-transcript.request.ts`, `list-files.request.ts` |
| Request class | `{Action}{Noun}Request` | `IngestTranscriptRequest` |
| Response Model | `{action}-{noun}.response.ts` | `ingest-transcript.response.ts` |
| Response class | `{Action}{Noun}Response` | `IngestTranscriptResponse` |
| Presenter | `{noun}.presenter.ts` | `context.presenter.ts`, `vault-write.presenter.ts` |
| Presenter class | `{Noun}Presenter` | `ContextPresenter`, `VaultWritePresenter` |
| Entity | `{noun}.ts` | `conversation.ts`, `dream.ts` |
| Repository interface | `{noun}.repository.interface.ts` | `conversation.repository.interface.ts` |
| Repository impl | `{noun}.repository.impl.ts` | `conversation.repository.impl.ts` |
| Repository token | `UPPER_SNAKE` | `CONVERSATION_REPOSITORY` |
| API interface | `{name}.api.interface.ts` | `memu.api.interface.ts` |
| API impl | `{name}-api.service.ts` | `memu-api.service.ts` |
| API token | `UPPER_SNAKE` | `MEMU_API` |
| Activity file | `{action}-{noun}.activity.ts` | `load-transcript.activity.ts`, `run-phase1-light-sleep.activity.ts` |
| Activity class | `{Action}{Noun}Activity` (or grouped service `LightDreamActivities`) | `LoadTranscriptActivity` OR `LightDreamActivities.loadTranscript()` (grouped is preferred — fewer files, one DI parent per pipeline) |
| Workflow file | `{name}.workflow.ts` | `light-dream.workflow.ts` |
| Workflow function | `{name}Workflow` | `lightDreamWorkflow` |
| Agent file | `{name}.agent.ts` | `light-extraction.agent.ts` |
| Test (unit) | `{name}.spec.ts` | `trigger-deep-dream.usecase.spec.ts` |
| Test (e2e) | `{feature}.e2e-spec.ts` | `light-dream.e2e-spec.ts` |

> **Decision needed from TanNT (Review Note):** Grouped activity service (`LightDreamActivities` with N methods) vs. one-class-per-activity (`LoadTranscriptActivity`, `RunExtractionActivity`, …). Recommendation: **grouped service per pipeline** (`LightDreamActivities`, `DeepDreamActivities`, `WeeklyReviewActivities`). Reasoning: shared dependencies (repositories, MemU, agent factory) are injected once; the activity collector groups them under one provider; matches the Python implementation's organisation.

---

## 7. App-design rule cross-references

Every rule applied in this map maps to a specific app-design section. If TanNT changes a rule, this table is the audit point.

| Rule applied | App-design section | Where applied in this map |
|---|---|---|
| Layered architecture (entities → use cases → controllers → infra) | §1.1, §1.2 | §1 module tree, §3 domain layer |
| Clean module shape (`controllers + usecases + commands + events + models/{requests,responses,presenters}`) | §2.1, §2.2 | §1 module tree |
| Use case returns Presenter (GET / cross-module) or Response Model (POST/PUT/DELETE) | §1.5 | §6 naming examples; §5.2.3 (`WriteVaultFileHandler` returns `VaultWritePresenter`) |
| Repository DI in `postgres.module.ts`, not business modules | §1.6 | §3.2 token table notes |
| Symbol DI tokens for repository + API interfaces | §1.6 | §3.2, §3.3 |
| Single controller per module | §7.6 | §1 — every business module has exactly one controller |
| Business module does NOT re-import global modules | §7.5 | enforced in PR review (anti-pattern in `_bmad-output/project-context.md`) |
| `index.ts` exports the array only — no re-exports of classes | §7.4 | §1 — every `usecases/`, `commands/`, `events/` folder has an `index.ts` exporting the array |
| Domain layer has zero framework imports | §1.7 | §3.1 — entities are plain TypeScript |
| Use case never returns raw entity | §1.5 | §6 — every use case maps to a Presenter or Response |
| Cross-module via CommandBus / EventBus | §1.4 patterns 2 & 3 + Jarvis architecture.md §1.4 principle 8 | §5 — every cross-module flow is a typed Command or Event |
| Module-boundary table | architecture.md §8.9 | §5.3 |

---

## Review Notes — for TanNT

Concrete questions / decisions for TanNT to sign off on before Story 13.1:

### A. Architecture decisions

1. **§5.2.4 vs §5.2.2 — cache invalidation path.** Which mechanism for "dream completed → invalidate context cache"?
   - Option A (recommended): `InvalidateContextCacheCommand` from inside each `invalidate-context-cache.activity.ts` (sync; observable success/failure; activity-level retry).
   - Option B: `DreamCompletedEvent` consumed by a `context` event handler (fire-and-forget; less observability; one path for all post-dream work).
   - **My pick: A.** Reason: the activity is the right boundary for retry semantics. Event B still fires for other consumers (manifest refresh, metrics).

2. **§6 — grouped activities vs one-class-per-activity.**
   - Option A (recommended): `LightDreamActivities` service with N methods, decorated with `@TemporalActivity('name')` per method.
   - Option B: One class per activity (`LoadTranscriptActivity`, `RunExtractionActivity`, …).
   - **My pick: A.** Matches Python organisation; fewer DI parents; shared dependencies injected once.

3. **`dream` module — sub-organisation.** I've placed `temporal/`, `agents/`, `scoring/` as sibling subfolders of `usecases/` inside `src/modules/dream/`. Alternative is a `processing/` sub-namespace grouping all three. Sibling layout reads cleaner imo, but it's worth a glance.

4. **§5.2.1 — durable trigger boundary.** I'm modelling `conversation → dream` as a direct `TemporalClientService.signalCoordinator(...)` call (shared service injection), NOT as a `TriggerLightDreamCommand` dispatched via CommandBus. The CommandBus path would add a layer for no durability gain. Confirm this is the right boundary or push back.

### B. Module boundary edge cases

5. **`dream` module's controller calling `dream` module's use case.** Standard same-module injection — explicitly allowed. Just flagging.

6. **Activity calling another activity in the same workflow.** Allowed within `src/modules/dream/`. Activities in different pipelines (light vs deep) sharing a helper — extract to a private use case under `src/modules/dream/usecases/` and inject.

7. **`vault` module's `WriteVaultFileHandler` writes to disk and dispatches `VaultFileUpdatedEvent`.** Same-module event, no cross-module call. Allowed.

### C. Things I'm NOT proposing (intentional)

- ❌ A `health/` business module — `src/shared/health/` is sufficient.
- ❌ A `scheduler/` business module — Temporal Schedules live as a service method inside `TemporalClientService` (shared).
- ❌ A `notifications/` business module — Jarvis MVP has no user-facing notifications beyond PR descriptions and `log.md` appends.
- ❌ A `metrics/` business module — observability lives in `src/shared/logger/` + `dream_phases` Postgres table; no separate module.

### D. Open questions for follow-up (NOT blocking 13.0 sign-off)

- **`audit-log` boilerplate module fate** — confirmed deleted in Story 13.16.5; no design impact here.
- **TypeORM migration baseline** — `0001-init-jarvis.ts` snapshot from Alembic state is Story 13.2's deliverable; not specified here.
- **`@nestjs/microservices` package** — flagged for evaluation in Story 13.16.5; if Temporal usage doesn't require it, removed there.

---

## Sign-off

This document is the **structure-review checkpoint** for Epic 13. By approving, TanNT confirms:

- The module tree (§1) matches expected business boundaries.
- Shared infrastructure additions (§2) are scoped correctly.
- Domain entities and repository interfaces (§3) are complete.
- Python → TypeScript file mapping (§4) is accurate.
- Every cross-module flow (§5) is modelled as a typed Command or Event with no direct cross-module injection.
- Naming examples (§6) match the boilerplate's app-design §7.2.
- The Review Note decisions (§A.1, §A.2, §A.4) align with TanNT's preferences.

After sign-off, Story 13.1 is unblocked and the rest of Epic 13 builds against this map. Subsequent design changes that affect this structure require an explicit revision to this doc, not silent drift in story files.
