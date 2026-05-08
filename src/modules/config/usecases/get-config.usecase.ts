/**
 * GetConfigUseCase — Story 13.13.
 *
 * Reads `ai-memory/config.yml` via vault module's `GetVaultFileCommand`,
 * parses YAML, applies defaults, and returns a `ConfigPresenter`.
 *
 * Mirrors Python `_read_config()` + `_to_config_data()` at
 * `app/api/routes/config.py:42-58`. Python bug #2 FIXED here:
 * `weeklyReviewCron` IS included in the response (Python's `_defaults()`
 * omitted it; the Pydantic `ConfigData` model has the field but the route
 * dropped it).
 */
import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import * as YAML from 'yaml';
import { GetVaultFileCommand, GetVaultFileResult } from 'src/modules/vault/commands/get-vault-file.command';
import { ConfigPresenter } from '../models/presenters/config.presenter';

export const DEFAULT_AUTO_MERGE = true;
export const DEFAULT_DEEP_DREAM_CRON = '0 20 * * *';
export const DEFAULT_WEEKLY_REVIEW_CRON = '0 20 * * 0';
export const DEFAULT_MAX_MEMORY_LINES = 200;

const CONFIG_PATH = 'config.yml';

interface RawConfig {
  auto_merge?: unknown;
  deep_dream_cron?: unknown;
  weekly_review_cron?: unknown;
  max_memory_lines?: unknown;
}

@Injectable()
export class GetConfigUseCase {
  private readonly logger = new Logger(GetConfigUseCase.name);

  constructor(private readonly commandBus: CommandBus) {}

  async execute(): Promise<ConfigPresenter> {
    let parsed: RawConfig = {};
    try {
      const result = await this.commandBus.execute<GetVaultFileCommand, GetVaultFileResult>(new GetVaultFileCommand({ path: CONFIG_PATH }));
      if (result.content !== null && result.content.length > 0) {
        const loaded = YAML.parse(result.content);
        if (loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded)) {
          parsed = loaded as RawConfig;
        }
      }
    } catch (err) {
      // Python parity: read failure → fall back to defaults silently.
      this.logger.warn({
        message: 'config.yml read failed — using defaults',
        event: 'config.getConfig.readFailed',
        error: (err as Error).message,
      });
    }

    const presenter = new ConfigPresenter(
      typeof parsed.auto_merge === 'boolean' ? parsed.auto_merge : DEFAULT_AUTO_MERGE,
      typeof parsed.deep_dream_cron === 'string' ? parsed.deep_dream_cron : DEFAULT_DEEP_DREAM_CRON,
      typeof parsed.weekly_review_cron === 'string' ? parsed.weekly_review_cron : DEFAULT_WEEKLY_REVIEW_CRON,
      typeof parsed.max_memory_lines === 'number' ? parsed.max_memory_lines : DEFAULT_MAX_MEMORY_LINES,
    );

    this.logger.log({
      message: 'config get completed',
      event: 'config.getConfig.completed',
    });

    return presenter;
  }
}
