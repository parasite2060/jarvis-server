/**
 * loadCronConfigFromVault — Story 13.13 / Q10 helper.
 *
 * Resolves `GetConfigUseCase` from the Nest app, reads the current vault
 * config (defaults applied on read failure per Python parity), and returns
 * the cron pair for `TemporalClientService.registerSchedules({ ... })`.
 *
 * Keeps `TemporalClientService` (a SHARED service) free of business-module
 * concerns — it accepts cron values as method args; the helper bridges
 * config-module use case → shared schedule API only at the boot edge.
 */
import { INestApplication } from '@nestjs/common';
import { GetConfigUseCase } from 'src/modules/config/usecases/get-config.usecase';

export interface CronConfig {
  deepDreamCron: string;
  weeklyReviewCron: string;
}

export async function loadCronConfigFromVault(app: INestApplication): Promise<CronConfig> {
  const useCase = app.get(GetConfigUseCase);
  const presenter = await useCase.execute();
  return {
    deepDreamCron: presenter.deepDreamCron,
    weeklyReviewCron: presenter.weeklyReviewCron,
  };
}
