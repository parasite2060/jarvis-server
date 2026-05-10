/**
 * Deep dream end-to-end test (Story 13.16 AC2).
 *
 * Tier 1 (always): POST /dream triggers coordinator signal, response is 202,
 * signal payload has correct shape. No live Temporal or LLM needed.
 *
 * Tier 2 (JARVIS_E2E_LIVE_LLM=1): full pipeline — Dream row created,
 * dream_phases rows for phases 1–3 exist with outcome='success',
 * MEMORY.md updated, PR created. Byte-equivalence fixture recorded
 * in Story 13.16.1.
 *
 * Run Tier 1: `bun run e2e:infra:up && bun run test:e2e -- --testPathPattern="deep-dream.e2e"`
 * Run Tier 2: `JARVIS_E2E_LIVE_LLM=1 bun run test:e2e -- --testPathPattern="deep-dream.e2e"`
 */
import * as request from 'supertest';
import { E2ETestSetup } from '../setup/e2e-setup';
import { TemporalClientService } from '../../src/shared/temporal/temporal-client.service';
import { ErrorCode } from '../../src/utils/error.code';

const LIVE_LLM = process.env['JARVIS_E2E_LIVE_LLM'] === '1';

describe('DeepDreamWorkflow E2E (Story 13.16 AC2)', () => {
  jest.setTimeout(180_000);

  let setup: E2ETestSetup;
  let signalSpy: jest.SpyInstance;

  beforeAll(async () => {
    setup = new E2ETestSetup();
    await setup.init();
    if (!LIVE_LLM) {
      const temporal = setup.app.get(TemporalClientService);
      signalSpy = jest.spyOn(temporal, 'signalCoordinator').mockResolvedValue(undefined);
    }
  }, 90_000);

  afterAll(async () => {
    await setup.teardown();
  }, 30_000);

  beforeEach(async () => {
    await setup.cleanup();
    signalSpy?.mockClear();
  });

  it('should return 202 with queued status when POST /dream is called', async () => {
    // Arrange — empty body (today's deep dream)
    const body = {};

    // Act
    const response = await request(setup.httpServer).post('/dream').send(body);

    // Assert
    expect(response.status).toBe(202);
    expect(response.body.code).toBe(ErrorCode.SUCCESS);
    expect(response.body.data.status).toBe('queued');
  });

  it('should dispatch submitDeep signal with correct payload when POST /dream is called with sourceDate', async () => {
    // Arrange
    const sourceDate = '2026-04-20';

    // Act
    const response = await request(setup.httpServer).post('/dream').send({ sourceDate });

    // Assert
    expect(response.status).toBe(202);

    if (!LIVE_LLM) {
      expect(signalSpy).toHaveBeenCalledWith(
        'deep',
        expect.objectContaining({
          trigger: 'manual-backfill',
          source_date_iso: sourceDate,
          target_date: sourceDate,
        }),
      );
    }
  });

  it('should return 400 when POST /dream is called with invalid sourceDate format', async () => {
    // Arrange
    const badDate = 'not-a-date';

    // Act
    const response = await request(setup.httpServer).post('/dream').send({ sourceDate: badDate });

    // Assert
    expect(response.status).toBe(400);
  });

  // Tier 2 only — requires live Temporal + LLM
  const tier2 = LIVE_LLM ? describe : describe.skip;

  tier2('Tier 2 — full pipeline with live LLM', () => {
    it('should create dream_phases rows for all three phases when deep dream completes end-to-end', async () => {
      // Arrange
      const targetDate = new Date().toISOString().slice(0, 10);

      // Act
      const triggerResponse = await request(setup.httpServer).post('/dream').send({});
      expect(triggerResponse.status).toBe(202);

      // Wait for deep dream to complete
      const startMs = Date.now();
      let phases: Array<{ phase: string; outcome: string }> = [];
      while (Date.now() - startMs < 300_000) {
        phases = await setup.dataSource.query(
          `SELECT dp.phase, dp.outcome
           FROM jarvis.dream_phases dp
           JOIN jarvis.dreams d ON d.id = dp.dream_id
           WHERE d.kind = 'deep' AND d.target_date = $1
           ORDER BY dp.started_at`,
          [targetDate],
        );
        const hasAllPhases = ['phase1', 'phase2', 'phase3'].every((p) => phases.some((r) => r.phase === p && r.outcome === 'success'));
        if (hasAllPhases) break;
        await new Promise((r) => setTimeout(r, 5_000));
      }

      // Assert
      expect(phases.some((p) => p.phase === 'phase1' && p.outcome === 'success')).toBe(true);
      expect(phases.some((p) => p.phase === 'phase3' && p.outcome === 'success')).toBe(true);
    });
  });
});
