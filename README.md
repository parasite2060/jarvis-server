# Jarvis Server

The backend brain of Project Jarvis — a personal AI memory system that learns how you think, not just what you said.

Jarvis Server is a Python FastAPI service that ingests conversation transcripts, extracts decisions and patterns through a two-tier "dreaming" engine, and maintains a persistent personality model stored as version-controlled markdown files.

## Architecture

```
Claude Code Plugin ──► Jarvis Server ──► PostgreSQL (jarvis schema)
                           │
                           ├──► MemU Server (semantic search via pgvector)
                           ├──► Redis + ARQ (async dream pipeline)
                           ├──► Azure OpenAI (GPT extraction)
                           ├──► Temporal (workflow orchestration)
                           └──► ai-memory repo (git-tracked vault)
```

**Design philosophy:** Thin stateless plugin talks to a smart homelab server. All intelligence lives here.

## Features

- **Context Assembly** — Assembles SOUL.md + IDENTITY.md + MEMORY.md + daily logs into a single payload for Claude Code session injection, cached with 30-minute TTL
- **Transcript Ingestion** — Receives JSONL transcripts from Claude Code hooks, parses user/assistant messages, stores in PostgreSQL
- **Light Dreaming** — After each session, extracts decisions (with reasoning), preferences, patterns, corrections, and facts via Azure OpenAI. Appends to MEMORY.md and daily logs, creates git PR
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
| AI | Azure OpenAI (GPT-5.2+) |
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

## Quick Start

### With Docker Compose (recommended)

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
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password |
| `JARVIS_API_KEY` | Yes | — | API key for authentication |
| `AZURE_OPENAI_API_KEY` | Yes | — | Azure OpenAI key |
| `AZURE_OPENAI_ENDPOINT` | Yes | — | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | — | Azure deployment name |
| `POSTGRES_HOST` | No | `postgres` | PostgreSQL host |
| `POSTGRES_PORT` | No | `5432` | PostgreSQL port |
| `POSTGRES_USER` | No | `jarvis` | PostgreSQL user |
| `POSTGRES_DB` | No | `jarvis` | PostgreSQL database |
| `REDIS_URL` | No | `redis://redis:6379/0` | Redis connection URL |
| `MEMU_BASE_URL` | No | `http://memu-server:8000` | MemU server URL |
| `AI_MEMORY_REPO_PATH` | No | `/app/ai-memory` | Path to ai-memory git repo |
| `JARVIS_LOG_LEVEL` | No | `INFO` | Log level |

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
