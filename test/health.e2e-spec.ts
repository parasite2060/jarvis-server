/**
 * /health smoke e2e (Story 13.1 AC #9).
 *
 * Boots a slim app with `HealthModule` + Postgres against the
 * `docker-compose.e2e.yml` infra and asserts that GET /health returns 200
 * with `application`, `postgres`, and `temporal` present. AppModule is NOT
 * imported here because:
 *   - The boilerplate's @nestjs-redis/kit Redis indicator hits a known
 *     Node-VM dynamic-import limitation under Jest. Redis stays wired in
 *     production (Decision C — deferred to Story 13.16.5) and AppModule
 *     covers the Redis path via blog/comment/audit-log e2e tests already.
 *   - This test focuses on the indicators 13.1 owns: app, postgres, temporal.
 *
 * The full AppModule /health path is exercised manually via `bun run start:dev`
 * (AC #12) — see Dev Agent Record.
 *
 * The boilerplate uses a NAMED DataSource (`DBConnections.INTERNAL`) so we pass
 * it explicitly to `pingCheck` instead of relying on the implicit default.
 */
import { Controller, Get, Inject, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
  TerminusModule,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import * as request from 'supertest';
import { DataSource } from 'typeorm';

import { AppConfigModule } from '../src/shared/config/config.module';
import { AppConfigService } from '../src/shared/config/config.service';
import { TemporalHealthIndicator } from '../src/shared/health/indicators/temporal.indicator';
import { TemporalClientService } from '../src/shared/temporal/temporal-client.service';
import { DBConnections } from '../src/shared/postgres/utils/constaint';

@Controller('health')
class SlimHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly temporal: TemporalHealthIndicator,
    @Inject(getDataSourceToken(DBConnections.INTERNAL))
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @HealthCheck()
  public async check(): Promise<HealthCheckResult> {
    return await this.health.check([
      () => new InlineApplicationIndicator().check('application'),
      () => this.db.pingCheck('postgres', { connection: this.dataSource }),
      () => this.temporal.isHealthy('temporal'),
    ]);
  }
}

class InlineApplicationIndicator extends HealthIndicator {
  public check(key: string): HealthIndicatorResult {
    return super.getStatus(key, true, { message: 'Up and running' });
  }
}

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      name: DBConnections.INTERNAL,
      imports: [AppConfigModule],
      useFactory: (cfg: AppConfigService) => ({
        type: 'postgres',
        host: cfg.databaseHost,
        port: cfg.databasePort,
        username: cfg.databaseUser,
        password: cfg.databasePassword,
        database: cfg.databaseName,
        schema: cfg.databaseSchema,
        synchronize: false,
      }),
      inject: [AppConfigService],
    }),
    TerminusModule,
  ],
  controllers: [SlimHealthController],
  providers: [TemporalHealthIndicator, TemporalClientService],
})
class HealthTestModule {}

describe('Health E2E', () => {
  let app: INestApplication;

  jest.setTimeout(60000);

  beforeAll(async () => {
    // Given a slim app wired with Postgres + Terminus + TemporalHealthIndicator
    const moduleFixture = await Test.createTestingModule({
      imports: [HealthTestModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });
    await app.init();
  }, 90000);

  afterAll(async () => {
    if (!app) return;
    try {
      // The boilerplate uses a NAMED connection (DBConnections.INTERNAL) and no default
      // DataSource. TypeORM's onApplicationShutdown hook tries to close the DEFAULT
      // connection token, which isn't registered, throwing during cleanup. Drop the named
      // DataSource explicitly first, then suppress the predictable shutdown error.
      const ds = app.get<DataSource>(getDataSourceToken(DBConnections.INTERNAL));
      if (ds.isInitialized) await ds.destroy();
    } catch {
      // ignore — cleanup
    }
    try {
      await app.close();
    } catch {
      // ignore — cleanup
    }
  }, 30000);

  describe('GET /health', () => {
    it('should return 200 with application + postgres + temporal indicators', async () => {
      // When the client hits /health
      const response = await request(app.getHttpServer()).get('/health');

      // Then status is ok and the three required indicators are present
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.info).toBeDefined();
      expect(response.body.info.application).toEqual(expect.objectContaining({ status: 'up' }));
      expect(response.body.info.postgres).toEqual(expect.objectContaining({ status: 'up' }));
      // Story 13.8 retrofit: indicator now reports `not-connected` when
      // the client hasn't been used yet (no signal/coordinator-start in
      // this slim test fixture). Decision D — always `up`; the message
      // conveys actual state.
      expect(response.body.info.temporal).toEqual({
        status: 'up',
        message: 'not-connected',
      });
    });
  });
});
