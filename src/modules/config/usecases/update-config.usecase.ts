/**
 * UpdateConfigUseCase — placeholder body (Story 13.10.5 / Q1).
 *
 * Module-map §1 lines 170-180 prescribes this use case. Story 13.13
 * (Temporal Schedules) wires:
 *   - cron validation via `cron-parser`
 *   - YAML write via vault `WriteVaultFileCommand`
 *   - `CronChangedEvent` publish (consumed by dream module to re-register
 *     Temporal Schedules)
 */
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class UpdateConfigUseCase {
  private readonly logger = new Logger(UpdateConfigUseCase.name);

  /**
   * Placeholder — Story 13.13 wires functional body. Returns a no-op
   * acknowledgement.
   */
  async execute(_input: Record<string, unknown>): Promise<{ ok: boolean }> {
    this.logger.warn({
      message: 'config.updateConfig.notImplemented',
      event: 'config.updateConfig.notImplemented',
      story: '13.13',
    });
    return { ok: true };
  }
}
