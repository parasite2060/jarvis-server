/**
 * ConfigController — Story 13.13 (functional bodies).
 *
 * `GET /config` returns the current config with defaults applied.
 * `PATCH /config` validates + merges + writes + dispatches `CronChangedEvent`
 * for cron diffs.
 *
 * Mirrors Python `app/api/routes/config.py:62-128`. Wire format camelCase
 * per MC1 + Story 13.6 Q1.
 */
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { GetConfigUseCase } from './usecases/get-config.usecase';
import { UpdateConfigUseCase } from './usecases/update-config.usecase';
import { UpdateConfigRequest } from './models/requests/update-config.request';
import { ConfigPresenter } from './models/presenters/config.presenter';

@Controller()
export class ConfigController {
  constructor(
    private readonly getConfigUseCase: GetConfigUseCase,
    private readonly updateConfigUseCase: UpdateConfigUseCase,
  ) {}

  @Get('config')
  async getConfig(): Promise<ConfigPresenter> {
    return this.getConfigUseCase.execute();
  }

  @Patch('config')
  async updateConfig(@Body() request: UpdateConfigRequest): Promise<ConfigPresenter> {
    return this.updateConfigUseCase.execute(request);
  }
}
