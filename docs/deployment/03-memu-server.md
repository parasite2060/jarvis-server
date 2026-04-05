# Setup: MemU Server (Semantic Memory)

MemU is the semantic memory engine that powers Jarvis's `memory_search` and `memory_add` capabilities. It stores memories in PostgreSQL with pgvector embeddings and uses Temporal for async workflow orchestration.

**MemU is included in the Docker Compose stack** — you don't install it separately. This guide explains how it's configured and what it needs.

## Architecture

```
jarvis-server ──► memu-server ──► PostgreSQL (memu database + pgvector)
                       │
memu-ui ──────────►    └──► Temporal (workflow orchestration)
  (web interface)
```

- **jarvis-server** proxies `memory_search` and `memory_add` requests to memu-server
- **memu-ui** provides a web interface for browsing and managing memories
- **memu-server** handles the actual embedding, storage, and retrieval

## What MemU Needs

MemU requires:

1. **PostgreSQL** with pgvector — uses the `memu` database (separate from Jarvis's `jarvis` database)
2. **Temporal** — for async memorization workflows
3. **LLM provider** — for generating embeddings and text processing

All three are provided by the Docker Compose stack.

## Environment Variables

MemU server receives its config through the compose file, mapped from your `.env`:

| Compose Var (internal) | Your `.env` Var | Description |
|------------------------|-----------------|-------------|
| `OPENAI_API_KEY` | `LLM_API_KEY` | API key for embeddings and LLM |
| `OPENAI_BASE_URL` | `LLM_BASE_URL` | OpenAI-compatible base URL |
| `EMBEDDING_BASE_URL` | `LLM_EMBEDDING_BASE_URL` | Embedding endpoint |
| `EMBEDDING_MODEL` | `LLM_EMBEDDING_MODEL` | Embedding model name |
| `DEFAULT_LLM_MODEL` | `LLM_MODEL` | Chat model for summarization |
| `POSTGRES_HOST` | `DB_HOST` | PostgreSQL host |
| `POSTGRES_PASSWORD` | `DB_PASSWORD` | PostgreSQL password |
| `POSTGRES_USER` | `DB_USER` | PostgreSQL user (default: jarvis) |
| `POSTGRES_DB` | — | Always `memu` (hardcoded in compose) |
| `TEMPORAL_HOST` | — | Always `temporal` (Docker network) |

You don't need to configure MemU separately — it reads from the same `.env` file through compose variable mapping.

## Database Setup

MemU needs a `memu` database in your PostgreSQL instance with pgvector enabled:

```sql
CREATE DATABASE memu OWNER jarvis;
\c memu
CREATE EXTENSION IF NOT EXISTS vector;
```

This must be done **before** starting the stack. MemU runs its own Alembic migrations on startup to create tables.

## MemU UI

The MemU web interface is available at `http://your-host:8011`. It provides:

- Memory browsing and search
- Category management
- Memory deletion and editing
- API documentation

The nginx config inside the memu-ui container proxies `/api/` requests to memu-server automatically.

## Known Issue: psycopg-binary Patch

The current memu-server Docker image has a compatibility issue with psycopg-binary returning bytes instead of strings for PostgreSQL version detection. The deployment template includes a `patches/sitecustomize.py` workaround that is bind-mounted into the container.

This patch is mounted automatically by the compose file:
```yaml
volumes:
  - ./patches/sitecustomize.py:/app/.venv/lib/python3.13/site-packages/sitecustomize.py:ro
```

## Verification

After starting the stack:

```bash
# Check memu-server health (from the Docker host)
docker exec jarvis-memu-server-1 python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/').read().decode())"

# Check via memu-ui
curl http://your-host:8011/

# Test memory search via jarvis-server proxy
curl -s -H "Authorization: Bearer YOUR_JARVIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"test","method":"rag"}' \
  http://your-host:8000/memory/search
```

## Related

- [memU-server source](https://github.com/parasite2060/memU-server)
- [memU-ui source](https://github.com/parasite2060/memU-ui)
- [memU library](https://github.com/parasite2060/memU) (memu-py)
