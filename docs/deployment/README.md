# Jarvis — Production Deployment

Deploy the full Jarvis stack using pre-built Docker images from GitHub Container Registry.

## Architecture

```
┌─────────────────────────────────────────────────┐
│            Docker Host (your server)             │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ jarvis-server│  │  memu-server │              │
│  │   :8000      │  │  (internal)  │              │
│  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                      │
│  ┌──────┴───────┐  ┌──────┴───────┐              │
│  │   temporal   │  │   memu-ui    │              │
│  │  (internal)  │  │    :8011     │              │
│  └──────────────┘  └──────────────┘              │
└──────────┬────────────────┬──────────────────────┘
           │                │
    ┌──────┴──────┐  ┌──────┴──────┐  ┌───────────┐
    │ PostgreSQL  │  │    Redis    │  │  GitHub   │
    │ + pgvector  │  │             │  │ ai-memory │
    └─────────────┘  └─────────────┘  └───────────┘
         external         external       git repo
```

## Prerequisites

Complete these in order before deploying:

| # | Prerequisite | Guide | What You Get |
|---|-------------|-------|-------------|
| 1 | **ai-memory repository** | [Setup Guide](./01-ai-memory-repo.md) | GitHub repo with vault structure + PAT for server access |
| 2 | **PostgreSQL 17 + pgvector** | (Your own setup) | Database with `jarvis` and `memu` schemas, vector extension enabled |
| 3 | **Redis** | (Your own setup) | Redis instance accessible from the Docker host |
| 4 | **Azure OpenAI** | [Setup Guide](./02-azure-openai.md) | API key, endpoint, chat + embedding model deployments |
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

| Service | Port | Description |
|---------|------|-------------|
| jarvis-server | 8000 | Core API — context injection, transcript ingestion, dreaming |
| memu-server | internal | Semantic memory search engine (pgvector) |
| memu-ui | 8011 | MemU web interface |
| temporal | internal | Workflow orchestration for dream pipelines |
| temporal-ui | 8088* | Temporal admin dashboard (*opt-in, see below) |

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

## Troubleshooting

| Symptom | Check |
|---------|-------|
| jarvis-server unhealthy | `docker logs jarvis-jarvis-server-1` — check DB connection |
| memu-server crash loop | Check `sitecustomize.py` patch is mounted, check PG connection |
| temporal won't start | Verify PostgreSQL is accessible and credentials are correct |
| Dreams not creating PRs | Check `JARVIS_GITHUB_PAT` has `contents:write` + `pull_requests:write` |
| Context not injected | Check plugin's `serverUrl` matches the server address + port |
