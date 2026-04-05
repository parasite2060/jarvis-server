---
type: guide
tags: [documentation, vault]
created: 2026-03-30
updated: 2026-03-30
---

# Vault Guide

This document explains the ai-memory vault structure, file purposes, frontmatter standards, and how the Jarvis dreaming engine interacts with files.

## Vault Structure

```
ai-memory/
├── SOUL.md          # Principles, values, decision philosophy
├── IDENTITY.md      # Role, tech stack, working style, projects
├── MEMORY.md        # Accumulated patterns and facts (<200 lines)
├── dailys/          # Daily session logs (YYYY-MM-DD.md)
├── decisions/       # Decision records with reasoning
├── projects/        # Active project context
├── patterns/        # Recurring coding/architecture/process patterns
├── templates/       # Reusable templates and prompts
├── topics/          # MEMORY.md overflow for deep entries
├── config.yml       # Dream configuration (non-secrets only)
├── _guide.md        # This file — vault documentation
└── .gitignore       # OS and editor file exclusions
```

## File Purposes

### Core Files (always injected at session start)

- **SOUL.md** — Your worldview, decision principles, opinions, tensions, and boundaries. Defines *who you are* to the AI assistant. Rarely changes.
- **IDENTITY.md** — Your professional role, tech stack, working style, and active projects. Updated as your context evolves.
- **MEMORY.md** — An index of accumulated patterns, decisions, facts, and recent extractions. Hard-capped at 200 lines. This is the primary working memory file.

### Extended Vault Folders

- **dailys/** — One file per day (`YYYY-MM-DD.md`). Light dream creates these; deep dream rewrites them into comprehensive day summaries. Today and yesterday are injected at session start.
- **decisions/** — Individual decision records with reasoning ("chose X because Y"). Referenced on-demand via `_index.md`.
- **projects/** — Per-project context files. Referenced on-demand via `_index.md`.
- **patterns/** — Recurring patterns that emerge across sessions. Referenced on-demand via `_index.md`.
- **templates/** — Reusable templates and prompts. Referenced on-demand via `_index.md`.
- **topics/** — Overflow from MEMORY.md when entries need more detail than one line allows.

### Configuration

- **config.yml** — Dream engine settings. No secrets — API keys and credentials are managed by the Jarvis server's environment variables.

## Frontmatter Standard

All vault markdown files MUST have YAML frontmatter at the top of the file:

```yaml
---
type: soul | identity | memory | daily | decision | project | pattern | template | topic | index | guide
tags: [relevant, tags]
created: YYYY-MM-DD
updated: YYYY-MM-DD
last_reviewed: YYYY-MM-DD  # Deep dream updates this nightly
---
```

- `type` identifies the file category for the dreaming engine
- `tags` enable semantic grouping and search
- `created` is set once when the file is first created
- `updated` is set whenever the file content changes
- `last_reviewed` is updated by the deep dream engine nightly

## _index.md Format

Each extended vault folder contains an `_index.md` that serves as a table of contents. The `_index.md` files are injected at session start so the AI knows what detailed records exist.

Entry format:

```
- [Title](file.md) -- one-line summary under 100 chars
```

Example:

```
- [Architecture Choices](architecture-choices.md) -- Clean Architecture, monolith-first, service extraction criteria
- [Tool Selections](tool-selections.md) -- NestJS, PostgreSQL, Azure OpenAI, Docker Compose
```

## Dreaming Engine Interaction

### Light Dream (per-session, automatic)

Triggered after each Claude Code session ends:

1. Receives the session transcript from the plugin hook
2. GPT-5.2 extracts decisions, preferences, patterns, corrections, and facts
3. Appends extracted entries to MEMORY.md under `## Recent` with an absolute date header
4. Creates or appends to `dailys/YYYY-MM-DD.md` with session extractions
5. Tags content for vault routing (decisions/, patterns/, projects/, templates/)
6. Creates a git branch `dream/light-YYYY-MM-DD-HHMMSS` and opens a PR

### Deep Dream (nightly at 3AM GMT+7, or manual via /dream)

Performs comprehensive memory consolidation:

1. Queries MemU for all memories added during the day
2. Reads current MEMORY.md, daily log, SOUL.md, and all vault files
3. GPT-5.2 consolidates: deduplicates, resolves contradictions, strengthens patterns, prunes stale entries
4. Rewrites MEMORY.md (clean, organized, capped at 200 lines)
5. Rewrites the daily log as a comprehensive day summary
6. Updates files in decisions/, projects/, patterns/, templates/
7. Regenerates all `_index.md` files
8. Creates a git branch `dream/deep-YYYY-MM-DD` and opens a PR

## MEMORY.md Rules

- **200-line hard cap** — Deep dream enforces this limit; light dream flags when approaching 180 lines
- **Absolute dates only** — Use "2026-03-30", never "yesterday" or "today"
- **Imperative voice** — Write "Use X for Y" not "The project uses X"
- **One line per entry, under 150 characters** — MEMORY.md is an index, not a dump
- **CORRECTION prefix** — For changed facts: "CORRECTION: Was [old] -> Now [new] (date)"
- **Strong Patterns promotion** — Entries reinforced 3+ times across sessions are promoted to the `## Strong Patterns` section

## User Editing

You can directly edit any file in this vault. Changes take effect at the next Claude Code session start. The dreaming engine respects manual edits and will not overwrite intentional changes during consolidation.
