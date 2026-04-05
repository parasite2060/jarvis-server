# Setup: Claude Code Plugin

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- Jarvis server running and accessible
- Node.js 20+

## 1. Install the Plugin

### From Marketplace (recommended)

```
/plugin marketplace add parasite2060/jarvis-claude-plugin
/plugin install jarvis-claude-plugin@jarvis-plugins
```

### Manual

```bash
git clone https://github.com/parasite2060/jarvis-claude-plugin.git
claude code --plugin-dir /path/to/jarvis-claude-plugin
```

## 2. Configure

On first load, Claude Code prompts for:

| Setting | Value |
|---------|-------|
| `serverUrl` | `http://<JARVIS_HOST>:8000` |
| `apiKey` | Your `JARVIS_API_KEY` from the server `.env` |
| `cacheDir` | `~/.jarvis-cache/ai-memory` (default) |
| `workerPort` | `37777` (default) |

## 3. Verify

Start a new session and ask: *"What do you know about me?"*

Claude should reference content from your SOUL.md, IDENTITY.md, and MEMORY.md.

Also test:
```
/recall what framework did I choose?
/dream
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| No context injected | Is the server running? `curl http://<HOST>:8000/health` |
| Authentication failed | Does `apiKey` match `JARVIS_API_KEY` in server `.env`? |
| Worker not starting | Check port 37777 isn't in use |
