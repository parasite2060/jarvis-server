/**
 * ConfigController — GET /config + PATCH /config (Story 13.10.5 scaffold).
 *
 * Module-map §1 lines 170-180 prescribes this controller. Story 13.13
 * (Temporal Schedules) wires functional bodies (cron read + cron-changed
 * event publish). Here we expose the routes with placeholder responses so
 * NestJS boot validates the routes and the module structure conforms to §1.
 */
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { GetConfigUseCase } from './usecases/get-config.usecase';
import { UpdateConfigUseCase } from './usecases/update-config.usecase';
import { UpdateConfigRequest } from './models/requests/update-config.request';

@Controller()
export class ConfigController {
  constructor(
    private readonly getConfigUseCase: GetConfigUseCase,
    private readonly updateConfigUseCase: UpdateConfigUseCase,
  ) {}

  @Get('config')
  async getConfig(): Promise<Record<string, unknown>> {
    return this.getConfigUseCase.execute();
  }

  @Patch('config')
  async updateConfig(@Body() request: UpdateConfigRequest): Promise<{ ok: boolean }> {
    return this.updateConfigUseCase.execute(request as Record<string, unknown>);
  }
}
