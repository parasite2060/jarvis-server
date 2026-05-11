/**
 * No-direct-env-access guard (Story 13.1 AC #3 / Task 10).
 *
 * Path chosen: a unit-level test that walks `src/` and asserts no file outside
 * the allowlist reads `process.env` directly or imports `ConfigService` from
 * `@nestjs/config`. Lighter-weight than authoring a custom ESLint plugin —
 * one regex sweep is enough for the small surface this story owns.
 *
 * Allowlist captures (a) the typed-accessor itself, (b) the bootstrap entry
 * point, (c) boilerplate config helpers that pre-date Jarvis and will be
 * cleaned up in Story 13.16.5. New Jarvis code under `src/modules/` and the
 * Jarvis additions in `src/shared/` MUST NOT read env directly.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '..', '..');

const PROCESS_ENV_REGEX = /\bprocess\.env\b/;
const NESTJS_CONFIG_IMPORT_REGEX = /from\s+['"]@nestjs\/config['"]/;

// Files allowed to read env / use @nestjs/config directly. Paths are POSIX,
// repo-relative from src/. Update only when a new boilerplate file is needed
// and it can't be expressed via AppConfigService — flag it in PR.
const ALLOWLIST: string[] = [
  // The typed accessor itself + the validation schema + the module wiring.
  'shared/config/config.service.ts',
  'shared/config/config.schema.ts',
  'shared/config/config.module.ts',
  // Bootstrap / process-level entry point.
  'main.ts',
  // Boilerplate config factories — pre-Jarvis, scheduled for cleanup in 13.16.5.
  'utils/config/logger.config.ts',
  'shared/postgres/configs.ts',
  'shared/postgres/datasource.logger.ts',
  'shared/postgres/utils/database.logger.ts',
  // Sample module — slated for deletion in 13.16.5.
  'modules/audit-log/audit-log.controller.ts',
  // GitOpsService spreads `process.env` into the `gh` subprocess env to
  // preserve PATH / HOME / locale; no Jarvis config value is read from
  // `process.env` directly (GH_TOKEN comes from `appConfig.ghToken`).
  // Story 13.7.
  'shared/git/git-ops.service.ts',
  // GitHub backend passes GH_TOKEN from config, but inherits the rest of
  // the subprocess env from process.env so gh CLI has access to PATH/HOME.
  'shared/git/backends/github.backend.ts',
];

async function walk(dir: string, accumulator: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await walk(full, accumulator);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.arch-spec.ts')) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    accumulator.push(full);
  }
  return accumulator;
}

function toRelative(absPath: string): string {
  return path.relative(SRC_ROOT, absPath).split(path.sep).join('/');
}

describe('no direct env access outside the typed accessor', () => {
  let candidateFiles: string[];

  beforeAll(async () => {
    candidateFiles = await walk(SRC_ROOT);
  });

  it('should never read process.env from a non-allowlisted file', async () => {
    // Arrange
    const offending: string[] = [];

    // Act
    for (const file of candidateFiles) {
      const rel = toRelative(file);
      if (ALLOWLIST.includes(rel)) continue;
      const source = await fs.readFile(file, 'utf-8');
      if (PROCESS_ENV_REGEX.test(source)) {
        offending.push(rel);
      }
    }

    // Assert
    expect(offending).toEqual([]);
  });

  it('should never import ConfigService from @nestjs/config in a non-allowlisted file', async () => {
    // Arrange
    const offending: string[] = [];

    // Act
    for (const file of candidateFiles) {
      const rel = toRelative(file);
      if (ALLOWLIST.includes(rel)) continue;
      const source = await fs.readFile(file, 'utf-8');
      if (NESTJS_CONFIG_IMPORT_REGEX.test(source)) {
        offending.push(rel);
      }
    }

    // Assert
    expect(offending).toEqual([]);
  });
});
