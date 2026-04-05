# Jarvis — Production Deployment

Deploy the full Jarvis stack using pre-built Docker images from GitHub Container Registry.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                Docker Host (your server)                   │
│                                                           │
│  ┌──────────────┐  ┌───────────────┐                      │
│  │ jarvis-server│  │ jarvis-worker │                      │
│  │   :8000      │  │  (ARQ tasks)  │                      │
│  └──────┬───────┘  └───────┬───────┘                      │
│         │                  │                              │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────────────┐    │
│  │  memu-server │──│   temporal   │  │   memu-ui    │    │
│  │  (internal)  │  │  (internal)  │  │    :8011     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└──────────┬────────────────┬──────────────────────────────┘
           │                │
    ┌──────┴──────┐  ┌──────┴──────┐  ┌───────────┐
    │ PostgreSQL  │  │    Redis    │  │  GitHub   │
    │ + pgvector  │  │             │  │ ai-memory │
    └─────────────┘  └─────────────┘  └───────────┘
         external         external       git repo
```

> **jarvis-server** handles HTTP API requests (context assembly, transcript ingestion, memory proxy).
> **jarvis-worker** runs the ARQ task worker that processes dream jobs (light dream after each session, deep dream on schedule). Both use the same Docker image with different entrypoints.
> **temporal** is used by memu-server for its memorize workflows — not by jarvis-server directly.

## Prerequisites

Complete these in order before deploying:

| # | Prerequisite | Guide | What You Get |
|---|-------------|-------|-------------|
| 1 | **ai-memory repository** | [Setup Guide](./01-ai-memory-repo.md) | GitHub repo with vault structure + PAT for server access |
| 2 | **PostgreSQL 17 + pgvector** | (Your own setup) | Database with `jarvis` and `memu` schemas, vector extension enabled |
| 3 | **Redis** | (Your own setup) | Redis instance accessible from the Docker host |
| 4 | **OpenAI-compatible LLM** | [Setup Guide](./02-openai-compatible-llm.md) | API key, endpoint, chat + embedding model deployments |
| 5 | **Docker host** | [Setup Guide](./03-docker-host.md) | Linux machine with Docker Engine + Compose + git |
| 6 | **Claude Code plugin** | [Setup Guide](./04-claude-code-plugin.md) | Plugin installed in Claude Code, connected to the server |

### PostgreSQL Requirements

- PostgreSQL 17 with `pgvector` extension
- Two databases: `jarvis` (server state) and `memu` (semantic search)
- A user with full access to both databases
- `CREATE EXTENSION vector` enabled in the `memu` database
- Accessible from the Docker host over the network

### Redis Requirements

- Redis 7+ accessible from the Docker host
- Password authentication recommended

## Quick Start

```bash
# 1. Copy the deployment template to your server
#    (from the jarvis-server repo: docs/deployment/templates-deployment/)
mkdir -p /opt/jarvis
cp -r docs/deployment/templates-deployment/* /opt/jarvis/
cd /opt/jarvis

# 2. Set up ai-memory repo (see prerequisite 1)
#    (from the jarvis-server repo: docs/deployment/templates-ai-memory/)
git clone https://x-access-token:YOUR_PAT@github.com/YOUR_USER/ai-memory.git /opt/ai-memory

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in all REQUIRED values

# 4. Start the stack
docker compose -f docker-compose.prod.yml up -d

# 5. Verify
curl http://localhost:8000/health
# → {"status":"ok","data":{"version":"0.1.0"}}
```

## Templates

This repo includes ready-to-copy templates:

| Template | Path | Description |
|----------|------|-------------|
| **Deployment** | `docs/deployment/templates-deployment/` | `docker-compose.prod.yml`, `.env.example`, patches — copy to your server |
| **ai-memory** | `docs/deployment/templates-ai-memory/` | Full vault structure with all files — use to initialize your ai-memory repo |

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | Yes | PostgreSQL server IP/hostname |
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `REDIS_URL` | Yes | Redis connection URL (e.g., `redis://:password@host:6379/0`) |
| `LLM_API_KEY` | Yes | API key for OpenAI-compatible provider |
| `LLM_BASE_URL` | Yes | Provider base URL (e.g., `https://api.openai.com/v1/`) |
| `LLM_EMBEDDING_BASE_URL` | Yes | Embedding endpoint base URL |
| `LLM_ENDPOINT` | Yes | Provider endpoint URL |
| `LLM_MODEL` | Yes | Chat model name (e.g., `gpt-4o`) |
| `JARVIS_API_KEY` | Yes | API key for authenticating plugin requests |
| `JARVIS_GITHUB_PAT` | Yes | GitHub PAT for ai-memory repo (contents + PRs) |

See `.env.example` for the full list with optional variables and defaults.

## Services

| Service | Port | Image | Description |
|---------|------|-------|-------------|
| jarvis-server | 8000 | jarvis-server | Core API — context injection, transcript ingestion, memory proxy |
| jarvis-worker | — | jarvis-server | ARQ task worker — processes light and deep dream jobs from Redis |
| memu-server | internal | memu-server | Semantic memory search engine (pgvector) |
| memu-ui | 8011 | memu-ui | MemU web interface |
| temporal | internal | temporalio | Workflow orchestration for memu-server memorize pipelines |
| temporal-ui | 8088* | temporalio | Temporal admin dashboard (*opt-in, see below) |

> `jarvis-server` and `jarvis-worker` use the **same Docker image** (`ghcr.io/parasite2060/jarvis-server`). The server runs `uvicorn`, the worker runs `arq`. Without the worker, transcripts are ingested but dreams never process.
> `temporal` is a dependency of `memu-server`, not jarvis-server. It orchestrates MemU's embedding and storage workflows.

## Operations

### Start / Stop

```bash
docker compose -f docker-compose.prod.yml up -d      # start
docker compose -f docker-compose.prod.yml down        # stop
docker compose -f docker-compose.prod.yml logs -f     # follow logs
```

### With Temporal UI (admin dashboard)

```bash
docker compose -f docker-compose.prod.yml --profile admin up -d
# Access at http://your-host:8088
```

### Update Images

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Check Status

```bash
docker compose -f docker-compose.prod.yml ps
curl http://localhost:8000/health
```

### Worker Logs

```bash
# Check if the ARQ worker is processing dream jobs
docker compose -f docker-compose.prod.yml logs -f jarvis-worker
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| jarvis-server unhealthy | `docker logs jarvis-jarvis-server-1` — check DB connection |
| Dreams table empty | Check `jarvis-worker` is running: `docker compose -f docker-compose.prod.yml ps jarvis-worker` |
| Dreams stuck in queue | `docker logs jarvis-jarvis-worker-1` — check Redis connection and LLM API key |
| memu-server crash loop | Check `sitecustomize.py` patch is mounted, check PG connection |
| temporal won't start | Verify PostgreSQL is accessible and credentials are correct (temporal is a memu-server dependency) |
| Dreams not creating PRs | Check `JARVIS_GITHUB_PAT` has `contents:write` + `pull_requests:write` |
| Context not injected | Check plugin's `serverUrl` matches the server address + port |
