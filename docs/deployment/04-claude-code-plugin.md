# Setup: Claude Code Plugin

The Jarvis Claude Code plugin connects your Claude Code sessions to the Jarvis server. It injects your memory context at session start, captures transcripts, and provides MCP tools for real-time memory search.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed (CLI, desktop app, or IDE extension)
- Jarvis server running and accessible from your machine
- Node.js 20+

## 1. Install the Plugin

### From Marketplace (recommended)

In Claude Code, run:

```
/plugin marketplace add parasite2060/jarvis-claude-plugin
/plugin install jarvis-claude-plugin@jarvis-plugins
```

### Manual

```bash
git clone https://github.com/parasite2060/jarvis-claude-plugin.git
claude code --plugin-dir /path/to/jarvis-claude-plugin
```

On first load, Claude Code will prompt you to configure the plugin.

## 3. Configure Plugin Settings

Claude Code will ask for these `userConfig` values:

| Setting | Value | Notes |
|---------|-------|-------|
| `serverUrl` | `http://<JARVIS_HOST>:8000` | Your Jarvis server address |
| `apiKey` | Your `JARVIS_API_KEY` value | Stored securely in system keychain |
| `cacheDir` | `~/.jarvis-cache/ai-memory` | Local vault file cache (default is fine) |
| `workerPort` | `37777` | Local file sync worker port (default is fine) |

The `apiKey` must match the `JARVIS_API_KEY` in your server's `.env` file.

## 4. Verify the Connection

Start a new Claude Code session. You should see:

1. **SessionStart hook** fires — context injected (SOUL + IDENTITY + MEMORY)
2. **MCP tools** available: `memory_search` and `memory_add`
3. **Commands** available: `/dream` and `/recall`

Test it:

```
# In Claude Code, ask:
"What do you know about me?"

# Claude should reference content from SOUL.md, IDENTITY.md, and MEMORY.md
```

## 5. Test MCP Tools

```
# Search memories
/recall what framework did I choose?

# Trigger a dream manually
/dream
```

## What Happens Automatically

Once configured, the plugin works invisibly:

- **Session start** — Your personality context is injected. Claude already knows you.
- **During session** — Claude proactively stores important decisions/preferences via `memory_add`.
- **Session end** — Full transcript captured and sent to the server for dreaming.
- **Before compaction** — Backup transcript captured (redundancy).
- **Background** — Local worker syncs vault files every 5 minutes for fast local reads.

## Troubleshooting

| Issue | Check |
|-------|-------|
| No context injected | Is the server running? `curl http://<HOST>:8000/health` |
| Authentication failed | Does `apiKey` in plugin match `JARVIS_API_KEY` in `.env`? |
| MCP tools not available | Run `npx --registry=https://npm.pkg.github.com @parasite2060/jarvis-mcp-server` manually to test |
| Worker not starting | Check `workerPort` isn't in use: `lsof -i :37777` |
