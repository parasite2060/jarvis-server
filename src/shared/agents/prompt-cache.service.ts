/**
 * PromptCacheService — boot-time prompt loader (Story 13.10 / Task 2).
 *
 * Reads every `prompts/*.md` file from `appConfig.promptsPath` once at
 * application bootstrap and exposes them via `getPrompt(name)`. Subsequent
 * agent-build calls retrieve from this in-memory cache, NOT disk.
 *
 * # Q11 binding (RECOMMENDED — RESOLVED 2026-05-08): read-once-at-app-init
 *   Mirrors Python `dream_agent.py::_PROMPTS_DIR` resolution + the synchronous
 *   `_load_extraction_prompt` / `_load_record_prompt` helpers. Centralising
 *   the read in a single boot-time service avoids per-agent-build disk I/O
 *   and makes prompt-missing failures fail-fast at boot rather than at
 *   first dream-pipeline run.
 *
 * # Q15 binding (RESOLVED 2026-05-08): default path
 *   `${process.cwd()}/prompts` for local dev; `/app/prompts` in Docker via
 *   the `PROMPTS_PATH` env var override.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

/**
 * Prompts that MUST be present at boot. Adding a prompt here makes
 * `OnApplicationBootstrap` fail-loud when the file is missing — a typo in
 * `prompts/light-extraction.md` shouldn't surface at first dream run.
 */
const REQUIRED_PROMPTS = [
  'light-extraction',
  'light-record',
  // Story 13.11 deep-dream prompts (Q1 / Q3 / Q9 RESOLVED 2026-05-08).
  // kebab-case + camelCase tool-name body adjustments; health-fix prompt has
  // the `write_file` Python-fiction stripped per Q9.
  'deep-dream-phase1-light-sleep',
  'deep-dream-phase2-rem-sleep',
  'deep-dream-phase3-consolidate',
  'deep-dream-health-fix',
  // Story 13.12 weekly-review prompt (Q2 RESOLVED 2026-05-08).
  // kebab-case + camelCase tool-name body adjustments per 13.10 Q3 pattern;
  // `readVaultIndex` mention preserved per Q4 (TS port registers the tool).
  'weekly-review',
] as const;

@Injectable()
export class PromptCacheService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PromptCacheService.name);
  private readonly cache = new Map<string, string>();

  constructor(private readonly appConfig: AppConfigService) {}

  /**
   * Loads every `prompts/*.md` file into memory at app boot. Called by
   * NestJS lifecycle. Throws `InternalException(DREAM_PROMPT_LOAD_FAILED)`
   * if any required prompt is missing — fail-loud per design/temporal-workflows.md
   * §boot-time-validation.
   */
  onApplicationBootstrap(): void {
    const dir = this.appConfig.promptsPath;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
    } catch (err) {
      throw new InternalException(ErrorCode.DREAM_PROMPT_LOAD_FAILED, `Failed to read prompts directory '${dir}': ${(err as Error).message}`);
    }
    for (const entry of entries) {
      const name = entry.replace(/\.md$/, '');
      const fullPath = path.join(dir, entry);
      const content = fs.readFileSync(fullPath, 'utf-8');
      this.cache.set(name, content);
    }
    for (const required of REQUIRED_PROMPTS) {
      if (!this.cache.has(required)) {
        throw new InternalException(ErrorCode.DREAM_PROMPT_LOAD_FAILED, `Required prompt '${required}.md' not found in '${dir}'`);
      }
    }
    this.logger.log({
      message: 'prompt cache loaded',
      event: 'promptCache.load.completed',
      promptsPath: dir,
      count: this.cache.size,
    });
  }

  /**
   * Returns the cached prompt body. Throws if not loaded — should be
   * impossible after a successful boot.
   */
  getPrompt(name: string): string {
    const content = this.cache.get(name);
    if (content === undefined) {
      throw new InternalException(ErrorCode.DREAM_PROMPT_LOAD_FAILED, `Prompt '${name}' not loaded — check prompts directory`);
    }
    return content;
  }

  /** Test-only: directly seed the cache. Used by unit specs. */
  /* istanbul ignore next */
  _setForTest(name: string, content: string): void {
    this.cache.set(name, content);
  }
}
