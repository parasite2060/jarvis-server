# Copilot Commit Message Instructions

VS Code uses this file to generate commit messages for staged changes in this repository. Follow these rules exactly — every commit on the default branch is parsed by [release-please](https://github.com/googleapis/release-please) to decide version bumps and `CHANGELOG.md` entries.

## Format

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

**Rules:**

- Use **imperative present tense**: `add`, not `added` or `adds`
- **Lowercase** the description (do not capitalize the first letter)
- **No trailing period** on the description
- Header line ≤ 72 characters
- Wrap body at 100 characters; explain the *why*, not the *what*
- **Never** add `Co-Authored-By:` trailers for AI agents (Copilot, Claude, etc.) — they pollute the changelog

## Allowed Types

| Type | Version Bump | Appears in Changelog | Use For |
|------|--------------|----------------------|---------|
| `feat` | **minor** | ✅ Features | New user-facing functionality |
| `fix` | **patch** | ✅ Bug Fixes | Bug fixes |
| `deps` | **patch** | ✅ Dependencies | Dependency upgrades |
| `perf` | none | ✅ Performance | Performance improvements |
| `revert` | none | ✅ Reverts | Reverting a prior commit |
| `refactor` | none | hidden | Code restructuring without behavior change |
| `docs` | none | hidden | Documentation only |
| `test` | none | hidden | Adding or updating tests |
| `style` | none | hidden | Formatting, whitespace, semicolons |
| `chore` | none | hidden | Tooling, configs, housekeeping |
| `build` | none | hidden | Build system, package scripts |
| `ci` | none | hidden | CI/CD workflow changes (`.github/workflows/**`) |

**Breaking changes** (any type with `!` after the scope, or a `BREAKING CHANGE:` footer) trigger a **major** version bump.

## Scopes

Use scopes to identify the affected module. Prefer existing scopes over inventing new ones. Common scopes:

- `auth` — authentication / authorization
- `blog`, `comment`, `audit-log` — feature modules
- `db`, `migration` — database / TypeORM migrations
- `kafka`, `redis`, `mongo` — infrastructure integrations
- `config`, `health` — cross-cutting
- `docker` — Dockerfile / compose
- `release` — release-please config / manifest

Scope is optional — omit it for repo-wide changes. Never invent a scope just to fill the slot.

## Examples

**Features:**
```
feat(blog): add full-text search endpoint
feat(auth): support refresh token rotation
```

**Fixes:**
```
fix(comment): prevent N+1 query on comment listing
fix(kafka): handle reconnect after broker restart
```

**Breaking change:**
```
feat(auth)!: replace API keys with OAuth2 bearer tokens

BREAKING CHANGE: clients must obtain a token via /auth/oauth2/token
before calling protected endpoints. The X-API-Key header is no longer
accepted.
```

**Non-releasing types (won't trigger a release PR):**
```
deps: upgrade @nestjs/core to 11.0.12
chore: tighten tsconfig strict flags
ci: add Trivy image scan to CI pipeline
docs: document release-please prerelease flow
test(blog): add e2e coverage for full-text search
```

**Force a specific version** (rare — only for version corrections):
```
chore: cut 2.0.0

Release-As: 2.0.0
```

## Anti-Patterns — Do NOT Generate These

- ❌ `update code` — no type, no scope, vague description
- ❌ `Feat: Added new endpoint.` — wrong case, past tense, trailing period
- ❌ `feat: stuff` / `fix: bug` — non-descriptive; say *what* and *which*
- ❌ Mixing unrelated changes under one type — pick the dominant change, mention secondary work in the body
- ❌ `feat: WIP` — no work-in-progress commits
- ❌ `chore` for a real bug fix or feature — release-please will skip it from the changelog
- ❌ `feat` for a refactor with no user-visible change — that's `refactor`
- ❌ Hiding a breaking change behind `feat:` or `fix:` without `!` and `BREAKING CHANGE:` footer

## Generation Procedure

When generating a commit message for staged changes:

1. **Read the diff first** — pick the type from the actual change, not file paths alone. A change inside `.github/workflows/**` is `ci`; a change to `Dockerfile` is `build` (or `feat(docker)` if it adds capability); a change under `src/**` is usually `feat`, `fix`, `refactor`, or `perf`.
2. **Pick the narrowest correct type:**
   - New endpoint, new option, new module → `feat`
   - Behavior was wrong, now correct → `fix`
   - Same behavior, faster → `perf`
   - Same behavior, cleaner code → `refactor`
   - Only `package.json` / `bun.lock` version bumps → `deps`
   - Only `*.md` → `docs`
   - Only test files → `test`
3. **Choose a scope** from the list above when the change is module-specific; omit it for repo-wide changes.
4. **Write the description as a command** that completes the sentence *"If applied, this commit will …"*. Stay under 72 characters.
5. **Add a body** when the *why* isn't obvious from the diff: linked issue, perf number, security context, migration note.
6. **Flag breaking changes** with `!` after the scope **and** a `BREAKING CHANGE:` footer describing the migration impact.
7. **Never** add `Co-Authored-By:`, `Generated-by:`, or any other AI attribution trailer.
