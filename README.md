# Jarvis Server

The backend brain of Project Jarvis — a personal AI memory system that learns how you think, not just what you said.

Jarvis Server is a Python FastAPI service that ingests conversation transcripts, extracts decisions and patterns through a two-tier "dreaming" engine, and maintains a persistent personality model stored as version-controlled markdown files.

## Architecture

```
Claude Code Plugin ──► Jarvis Server ──► PostgreSQL (jarvis schema)
                           │
                           ├──► MemU Server (semantic search via pgvector)
                           ├──► Redis + ARQ (async dream pipeline)
                           ├──► OpenAI-compatible LLM (GPT extraction)
                           ├──► Temporal (workflow orchestration)
                           └──► ai-memory repo (git-tracked vault)
```

**Design philosophy:** Thin stateless plugin talks to a smart homelab server. All intelligence lives here.

## Features

- **Context Assembly** — Assembles SOUL.md + IDENTITY.md + MEMORY.md + daily logs into a single payload for Claude Code session injection, cached with 30-minute TTL
- **Transcript Ingestion** — Receives JSONL transcripts from Claude Code hooks, parses user/assistant messages, stores in PostgreSQL
- **Light Dreaming** — After each session, extracts decisions (with reasoning), preferences, patterns, corrections, and facts via LLM. Appends to MEMORY.md and daily logs, creates git PR
- **Deep Dreaming** — Nightly consolidation: deduplicates, resolves contradictions, strengthens patterns (3+ occurrences), rewrites MEMORY.md under 200 lines, creates git PR
- **MemU Proxy** — Single gateway for semantic memory search and storage. Plugin calls Jarvis, Jarvis proxies to MemU
- **File Manifest** — Serves vault file hashes and content for the plugin's local file sync worker
- **Git Operations** — Manages ai-memory repo: branching, committing, pushing, PR creation via `gh` CLI

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check with version |
| GET | `/memory/context` | API Key | Assembled context payload (cached) |
| GET | `/memory/files/manifest` | API Key | File manifest with SHA-256 hashes |
| GET | `/memory/files/{path}` | API Key | Raw vault file content |
| POST | `/conversations` | API Key | Ingest JSONL transcript |
| POST | `/memory/search` | API Key | Semantic search (proxied to MemU) |
| POST | `/memory/add` | API Key | Store a memory (proxied to MemU) |
| POST | `/dream` | API Key | Trigger manual deep dream |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | FastAPI (async) |
| Runtime | Python 3.12+ / Uvicorn |
| Database | PostgreSQL + SQLAlchemy (async) + Alembic |
| Task Queue | ARQ + Redis |
| Workflows | Temporal |
| AI | Any OpenAI-compatible API (Azure OpenAI, OpenAI, etc.) |
| Semantic Store | MemU (pgvector) |
| HTTP Client | httpx (async) |
| Logging | structlog (JSON) |
| Git | gh CLI |

## Project Structure

```
app/
├── api/
│   ├── deps.py                 # Auth & DB dependencies
│   └── routes/
│       ├── health.py           # GET /health
│       ├── conversations.py    # POST /conversations
│       ├── files.py            # File manifest endpoints
│       └── memory_proxy.py     # MemU proxy endpoints
├── core/
│   └── logging.py              # Structlog configuration
├── models/
│   ├── db.py                   # Async session factory
│   ├── tables.py               # Transcript, Dream, ExtractedMemory ORM models
│   └── conversation_schemas.py # Pydantic request/response models
├── services/
│   ├── context_cache.py        # In-memory cache with 30-min TTL
│   ├── context_assembly.py     # Vault context assembly
│   ├── memory_files.py         # Safe file I/O with path traversal protection
│   ├── transcript_parser.py    # JSONL transcript parsing
│   ├── memory_updater.py       # MEMORY.md and daily log updates
│   ├── vault_updater.py        # Extended vault folder updates
│   ├── azure_openai.py         # GPT extraction client
│   ├── memu_client.py          # MemU REST API client
│   ├── deep_dream.py           # Deep dream consolidation pipeline
│   ├── git_ops.py              # Git branch/commit/push/PR operations
│   └── file_manifest.py        # Manifest building and DB sync
├── tasks/
│   └── worker.py               # ARQ worker (light_dream_task, deep_dream_task)
├── config.py                   # Pydantic Settings
└── main.py                     # App factory with lifespan
alembic/
└── versions/                   # Database migrations
tests/                          # pytest-asyncio test suite
```

## Prerequisites

Before deploying Jarvis, you need the following ready:

| # | Prerequisite | Setup Guide | Template |
|---|-------------|-------------|----------|
| 1 | **ai-memory repository** — Private GitHub repo with vault structure (SOUL.md, IDENTITY.md, MEMORY.md, etc.) and a fine-grained PAT for server access | [Guide](docs/deployment/01-ai-memory-repo.md) | [Template files](docs/deployment/templates-ai-memory/) |
| 2 | **PostgreSQL 17 + pgvector** — Two databases: `jarvis` (server state) and `memu` (semantic search). `vector` extension enabled on `memu` database | — | — |
| 3 | **Redis 7+** — For async task queue (ARQ). Password authentication recommended | — | — |
| 4 | **OpenAI-compatible API** — Any provider with an OpenAI-compatible endpoint: Azure OpenAI, OpenAI, local models via Ollama/vLLM, etc. Needs a chat model and an embedding model | [Guide](docs/deployment/02-openai-compatible-llm.md) | — |
| 5 | **MemU server** — Semantic memory engine (included in Docker Compose). Needs the `memu` database with pgvector | [Guide](docs/deployment/03-memu-server.md) | — |
| 6 | **Docker host** — Linux machine with Docker Engine + Compose plugin + git installed | — | [Deployment files](docs/deployment/templates-deployment/) |
| 7 | **Claude Code plugin** — Connects Claude Code sessions to Jarvis for context injection, transcript capture, and memory tools | [Guide](docs/deployment/04-claude-code-plugin.md) | — |
| 8 | **Cloudflare Tunnel** *(optional)* — Expose the server securely over the internet with Zero Trust Service Token authentication | [Guide](docs/deployment/05-cloudflare-tunnel.md) | — |

## Deployment

For production deployment with pre-built GHCR images, see the **[Deployment Guide](docs/deployment/README.md)** — includes quick start, environment variables, operations, and troubleshooting.

## Quick Start (Development)

### With Docker Compose

```bash
cp .env.example .env  # fill in required values
docker compose up -d
```

This starts all 6 services: jarvis-server, memu-server, memu-ui, postgres, temporal, redis.

### Local Development

```bash
# Prerequisites: Python 3.12+, PostgreSQL, Redis
pip install -e ".[dev]"

# Run migrations
alembic upgrade head

# Start server
uvicorn app.main:app --reload --port 8000
```

## Configuration

Environment variables (via `.env`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **Database** | | | |
| `DB_HOST` | No | `postgres` | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_USER` | No | `jarvis` | PostgreSQL user |
| `DB_PASSWORD` | Yes | — | PostgreSQL password |
| `DB_NAME` | No | `jarvis` | PostgreSQL database |
| **Redis** | | | |
| `REDIS_URL` | No | `redis://redis:6379/0` | Redis connection URL |
| **LLM** | | | |
| `LLM_API_KEY` | Yes | — | API key for OpenAI-compatible provider |
| `LLM_ENDPOINT` | Yes | — | Provider endpoint URL |
| `LLM_MODEL` | Yes | — | Chat model name (e.g., `gpt-4o`) |
| `LLM_BASE_URL` | Yes | — | OpenAI-compatible base URL (`/v1/`) |
| `LLM_EMBEDDING_BASE_URL` | Yes | — | Embedding endpoint base URL |
| `LLM_EMBEDDING_MODEL` | No | `text-embedding-3-large` | Embedding model name |
| **Jarvis** | | | |
| `JARVIS_API_KEY` | Yes | — | API key for plugin authentication |
| `JARVIS_LOG_LEVEL` | No | `INFO` | Log level |
| `JARVIS_MEMORY_PATH` | No | `/app/ai-memory` | Path to ai-memory git repo |
| `JARVIS_GITHUB_PAT` | Yes | — | GitHub PAT for ai-memory repo |
| **MemU** | | | |
| `MEMU_BASE_URL` | No | `http://memu-server:8000` | MemU server URL |

## Database Schema

**Schema:** `jarvis`

| Table | Description |
|-------|-------------|
| `transcripts` | Raw and parsed conversation transcripts |
| `dreams` | Dream pipeline execution records (light/deep) |
| `extracted_memories` | Individual memories extracted by dreams |
| `file_manifest` | Vault file hashes for sync |
| `context_cache` | Persistent context cache metadata |

Migrations managed by Alembic. Run automatically on server startup.

## Docker Images

Pre-built images are published to GitHub Container Registry on every push to `main`:

```bash
docker pull ghcr.io/parasite2060/jarvis-server:latest
```

## Related Repositories

| Repository | Description |
|-----------|-------------|
| [jarvis-claude-plugin](https://github.com/parasite2060/jarvis-claude-plugin) | Claude Code plugin (hooks, MCP server, commands) |
| [memU-server](https://github.com/parasite2060/memU-server) | Semantic memory search engine |
| [memU-ui](https://github.com/parasite2060/memU-ui) | MemU web interface |
| [memU](https://github.com/parasite2060/memU) | Memory framework library (memu-py) |

## License

Private — all rights reserved.
