import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { UseCases } from './usecases';

/**
 * ConfigModule — vault `config.yml` get/patch + cron change notification
 * (Story 13.10.5 scaffold; Story 13.13 wires functional bodies).
 *
 * Per module-map §1 lines 170-180. Empty `imports: []` per app-design §7.5
 * (CqrsModule + ConfigModule + LoggerModule are global from boilerplate).
 *
 * NB: this is the **business module** at `src/modules/config/` — DISTINCT
 * from `src/shared/config/` (the boilerplate env-var loader). They have
 * different scopes and both stay.
 */
@Module({
  controllers: [ConfigController],
  providers: [...UseCases],
})
export class ConfigModule {}
