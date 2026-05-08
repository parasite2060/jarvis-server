/**
 * GetConfigUseCase — placeholder body (Story 13.10.5 / Q1).
 *
 * Module-map §1 lines 170-180 prescribes this use case at
 * `src/modules/config/usecases/`. Story 13.13 (Temporal Schedules) wires the
 * functional body — reads `ai-memory/config.yml` via `GetVaultFileCommand`
 * (cross-module to vault) and returns the parsed cron config.
 *
 * Here we only scaffold the class so the module structure conforms to §1.
 */
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GetConfigUseCase {
  private readonly logger = new Logger(GetConfigUseCase.name);

  /**
   * Placeholder — returns an empty object until Story 13.13 wires the
   * vault config.yml read. Throwing would break a future smoke test that
   * just instantiates the use case via the DI container; returning empty
   * is benign and explicit.
   */
  async execute(): Promise<Record<string, unknown>> {
    this.logger.warn({
      message: 'config.getConfig.notImplemented',
      event: 'config.getConfig.notImplemented',
      story: '13.13',
    });
    return {};
  }
}
