/**
 * POST /dream E2E spec (Story 13.14 AC #8).
 *
 * Boots AppModule via E2ETestSetup against `docker-compose.e2e.yml` infra
 * (Postgres). TemporalClientService is spy-stubbed so we can assert the
 * signal-coordinator call without a real Temporal cluster.
 *
 * Q8 SM pick: reuse 13.13 e2e fixtures (E2ETestSetup already boots the full
 * AppModule including DreamModule). signalCoordinator spy captures call shape.
 */
import * as request from 'supertest';
import { E2ETestSetup } from './setup/e2e-setup';
import { ErrorCode } from '../src/utils/error.code';
import { TemporalClientService } from '../src/shared/temporal/temporal-client.service';

describe('Dream Trigger E2E', () => {
  let setup: E2ETestSetup;
  let temporalSpy: jest.SpyInstance;

  jest.setTimeout(30000);

  beforeAll(async () => {
    setup = new E2ETestSetup();
    await setup.init();
    const temporal = setup.app.get(TemporalClientService);
    // Stub: real Temporalite not available in e2e infra. Stub the SDK call
    // so we can assert the call shape without a live cluster.
    temporalSpy = jest.spyOn(temporal, 'signalCoordinator').mockResolvedValue(undefined);
  }, 90000);

  afterAll(async () => {
    await setup.teardown();
  }, 30000);

  beforeEach(async () => {
    await setup.cleanup();
    temporalSpy.mockClear();
  });

  describe('POST /dream', () => {
    it('empty body — returns 202 + queued status, signals coord-singleton with manual trigger', async () => {
      // Act
      const response = await request(setup.httpServer).post('/dream').send({});

      // Assert HTTP response
      expect(response.status).toBe(202);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.status).toBe('queued');

      // Assert signal payload
      expect(temporalSpy).toHaveBeenCalledTimes(1);
      expect(temporalSpy).toHaveBeenCalledWith(
        'deep',
        expect.objectContaining({
          trigger: 'manual',
          source_date_iso: null,
        }),
      );
      // target_date should be a valid ISO YYYY-MM-DD string (today UTC)
      const [, payload] = temporalSpy.mock.calls[0] as [string, any];
      expect(payload.target_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('with sourceDate (camelCase) — returns 202 + queued status, signals with manual-backfill trigger', async () => {
      // Act
      const response = await request(setup.httpServer).post('/dream').send({ sourceDate: '2026-04-20' });

      // Assert HTTP response
      expect(response.status).toBe(202);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.status).toBe('queued');

      // Assert signal payload
      expect(temporalSpy).toHaveBeenCalledWith('deep', {
        trigger: 'manual-backfill',
        source_date_iso: '2026-04-20',
        target_date: '2026-04-20',
      });
    });

    it('with source_date (snake_case — plugin wire compatibility, Q7 SM pick)', async () => {
      // Act
      const response = await request(setup.httpServer).post('/dream').send({ source_date: '2026-04-20' });

      // Assert HTTP response
      expect(response.status).toBe(202);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.status).toBe('queued');

      // Assert signal payload matches camelCase path
      expect(temporalSpy).toHaveBeenCalledWith('deep', {
        trigger: 'manual-backfill',
        source_date_iso: '2026-04-20',
        target_date: '2026-04-20',
      });
    });

    it('invalid sourceDate format — returns 400 (ValidationPipe)', async () => {
      // Act
      const response = await request(setup.httpServer).post('/dream').send({ sourceDate: 'not-a-date' });

      // Assert
      expect(response.status).toBe(400);
    });

    it('invalid sourceDate out-of-range — returns 400 (regex rejects)', async () => {
      // Act
      const response = await request(setup.httpServer).post('/dream').send({ sourceDate: '2026-13-99' });

      // Assert
      expect(response.status).toBe(400);
    });
  });
});
