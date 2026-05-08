/**
 * UpdateConfigUseCase — Story 13.13.
 *
 * Reads current `config.yml`, merges the request body, atomically writes the
 * file (temp + rename per Python parity), and dispatches `CronChangedEvent`
 * for each changed cron field. The dream module's `CronChangedEventsHandler`
 * consumes the event(s) and re-registers the affected Temporal Schedule.
 *
 * Mirrors Python `update_config()` at `app/api/routes/config.py:69-128`.
 *
 * # Q3 cross-story flag (RESOLVED 2026-05-09)
 * The 13.10.5 scaffold's JSDoc directed `WriteVaultFileCommand` for the
 * write, but `WriteVaultFileCommand` does NOT exist (verified — Story 13.6
 * shipped only `GetVaultFileCommand`; the write command was deferred).
 * Falling back to direct `fs.promises` atomic-write (Python parity at
 * `config.py:107-115`). `config.yml` is boot config — NOT vault memory —
 * so direct fs is the correct mechanism even without the cross-story
 * fix-up. Surface noted in Dev Agent Record → Cross-story flags.
 *
 * # Q13 (RESOLVED 2026-05-09)
 * Fire-and-forget event dispatch: `EventBus.publish(...)` after YAML write
 * succeeds; HTTP returns 200 immediately. The dream-side handler runs
 * async; if Temporal is degraded the schedule-update fails silently and
 * self-heals on next app boot.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandBus, EventBus } from '@nestjs/cqrs';
import * as YAML from 'yaml';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import { GetVaultFileCommand, GetVaultFileResult } from 'src/modules/vault/commands/get-vault-file.command';
import { ConfigPresenter } from '../models/presenters/config.presenter';
import { CronChangedEvent, CronChangedEventPayload, type CronKind } from '../events/cron-changed.event';
import { UpdateConfigRequest } from '../models/requests/update-config.request';
import { DEFAULT_AUTO_MERGE, DEFAULT_DEEP_DREAM_CRON, DEFAULT_MAX_MEMORY_LINES, DEFAULT_WEEKLY_REVIEW_CRON } from './get-config.usecase';

const CONFIG_PATH = 'config.yml';

interface MergedConfig {
  auto_merge: boolean;
  deep_dream_cron: string;
  weekly_review_cron: string;
  max_memory_lines: number;
}

@Injectable()
export class UpdateConfigUseCase {
  private readonly logger = new Logger(UpdateConfigUseCase.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly eventBus: EventBus,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
  ) {}

  async execute(input: UpdateConfigRequest): Promise<ConfigPresenter> {
    if (!hasAnyField(input)) {
      throw new InternalException(ErrorCode.CONFIG_VALIDATION_FAILED, 'No fields provided to update');
    }

    const current = await this.readCurrentConfig();
    const merged: MergedConfig = {
      auto_merge: input.autoMerge ?? current.auto_merge,
      deep_dream_cron: input.deepDreamCron ?? current.deep_dream_cron,
      weekly_review_cron: input.weeklyReviewCron ?? current.weekly_review_cron,
      max_memory_lines: input.maxMemoryLines ?? current.max_memory_lines,
    };

    const yamlContent = YAML.stringify(merged);
    await this.atomicWriteConfig(yamlContent);

    // Diff cron fields → publish one event per changed cron.
    const changedCrons: Array<{ kind: CronKind; oldCron: string; newCron: string }> = [];
    if (merged.deep_dream_cron !== current.deep_dream_cron) {
      changedCrons.push({ kind: 'deepDream', oldCron: current.deep_dream_cron, newCron: merged.deep_dream_cron });
    }
    if (merged.weekly_review_cron !== current.weekly_review_cron) {
      changedCrons.push({ kind: 'weeklyReview', oldCron: current.weekly_review_cron, newCron: merged.weekly_review_cron });
    }

    for (const c of changedCrons) {
      // Fire-and-forget per Q13. Handler runs async; failure is silent.
      this.eventBus.publish(new CronChangedEvent(new CronChangedEventPayload(c.kind, c.oldCron, c.newCron)));
    }

    this.logger.log({
      message: 'config update completed',
      event: 'config.updateConfig.completed',
      changedFields: collectChangedFields(input),
      cronChanges: changedCrons.map((c) => c.kind),
    });

    return new ConfigPresenter(merged.auto_merge, merged.deep_dream_cron, merged.weekly_review_cron, merged.max_memory_lines);
  }

  private async readCurrentConfig(): Promise<MergedConfig> {
    let parsed: Record<string, unknown> = {};
    try {
      const result = await this.commandBus.execute<GetVaultFileCommand, GetVaultFileResult>(new GetVaultFileCommand({ path: CONFIG_PATH }));
      if (result.content !== null && result.content.length > 0) {
        const loaded = YAML.parse(result.content);
        if (loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded)) {
          parsed = loaded as Record<string, unknown>;
        }
      }
    } catch (err) {
      // Python parity: read failure → fall back to defaults silently.
      this.logger.warn({
        message: 'config.yml read failed before update — using defaults',
        event: 'config.updateConfig.readFailed',
        error: (err as Error).message,
      });
    }

    return {
      auto_merge: typeof parsed['auto_merge'] === 'boolean' ? parsed['auto_merge'] : DEFAULT_AUTO_MERGE,
      deep_dream_cron: typeof parsed['deep_dream_cron'] === 'string' ? parsed['deep_dream_cron'] : DEFAULT_DEEP_DREAM_CRON,
      weekly_review_cron: typeof parsed['weekly_review_cron'] === 'string' ? parsed['weekly_review_cron'] : DEFAULT_WEEKLY_REVIEW_CRON,
      max_memory_lines: typeof parsed['max_memory_lines'] === 'number' ? parsed['max_memory_lines'] : DEFAULT_MAX_MEMORY_LINES,
    };
  }

  /**
   * Atomic write: write to `<path>.tmp` then `rename` to final path.
   * Mirrors Python `config.py:107-115`. `config.yml` is boot config (NOT
   * vault memory file) — direct fs is correct; no PR.
   */
  private async atomicWriteConfig(content: string): Promise<void> {
    const resolved = safeResolveVaultPath(this.appConfig.vaultPath, CONFIG_PATH);
    if (resolved === null) {
      throw new InternalException(ErrorCode.CONFIG_FILE_WRITE_FAILED, 'config.yml path resolution failed');
    }
    const tmpPath = `${resolved}.tmp`;
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, resolved);
    } catch (err) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // best-effort cleanup
      }
      throw new InternalException(ErrorCode.CONFIG_FILE_WRITE_FAILED, `config.yml atomic-write failed: ${(err as Error).message}`);
    }
  }
}

function hasAnyField(input: UpdateConfigRequest): boolean {
  return (
    input.autoMerge !== undefined || input.deepDreamCron !== undefined || input.weeklyReviewCron !== undefined || input.maxMemoryLines !== undefined
  );
}

function collectChangedFields(input: UpdateConfigRequest): string[] {
  const out: string[] = [];
  if (input.autoMerge !== undefined) out.push('autoMerge');
  if (input.deepDreamCron !== undefined) out.push('deepDreamCron');
  if (input.weeklyReviewCron !== undefined) out.push('weeklyReviewCron');
  if (input.maxMemoryLines !== undefined) out.push('maxMemoryLines');
  return out;
}
