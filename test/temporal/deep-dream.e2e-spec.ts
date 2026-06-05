/**
 * Deep dream end-to-end test (Story 13.16 AC2).
 *
 * Always runs against the api-mock-server (http://localhost:11435/v1).
 *
 * HTTP shape tests: spy signalCoordinator — only checks request/response
 * shape without needing a live coordinator workflow.
 *
 * Pipeline test: seeds vault dailys, starts the coordinator workflow, registers
 * phase 1/2/3 + health-fix agent stubs, then polls until all dream_phases rows
 * complete.
 *
 * Run: `bun run e2e:infra:up && bun run test:e2e -- --testPathPattern="deep-dream.e2e"`
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as request from 'supertest';
import { E2ETestSetup } from '../setup/e2e-setup';
import { TemporalClientService } from '../../src/shared/temporal/temporal-client.service';
import { ApiMockHelper } from '../helpers';
import { ErrorCode } from '../../src/utils/error.code';
import { phase1Stub, phase2Stub, phase3Stub, healthFixStub } from '../fixtures/llm-stubs';

const VAULT_ROOT = process.env['VAULT_PATH'] ?? '/tmp/jarvis-e2e-vault';

async function seedDaily(isoDate: string): Promise<void> {
  const abs = path.join(VAULT_ROOT, 'dailys', `${isoDate}.md`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `# Daily ${isoDate}\n\nContent for ${isoDate}.\n`, 'utf-8');
}

describe('DeepDreamWorkflow E2E (Story 13.16 AC2)', () => {
  jest.setTimeout(300_000);

  let setup: E2ETestSetup;
  let signalSpy: jest.SpyInstance;
  const mock = new ApiMockHelper();

  beforeAll(async () => {
    // Seed dailys for the deep-dream test window (past 30 days to ensure coverage)
    E2ETestSetup.ensureVaultCloned();
    for (let i = 1; i <= 30; i++) {
      const d = new Date('2026-05-08T00:00:00Z');
      d.setDate(d.getDate() - i);
      await seedDaily(d.toISOString().slice(0, 10));
    }

    setup = new E2ETestSetup();
    await setup.init();
    const temporal = setup.app.get(TemporalClientService);
    signalSpy = jest.spyOn(temporal, 'signalCoordinator').mockResolvedValue(undefined);
  }, 90_000);

  afterAll(async () => {
    await setup.teardown();
  }, 30_000);

  beforeEach(async () => {
    await setup.cleanup();
    await mock.clear();
    signalSpy.mockClear();
  });

  afterEach(async () => {
    await mock.clear();
  });

  it('should return 202 with queued status when POST /dream is called', async () => {
    // WHEN
    const response = await request(setup.httpServer).post('/dream').send({});

    // THEN
    expect(response.status).toBe(202);
    expect(response.body.code).toBe(ErrorCode.SUCCESS);
    expect(response.body.data.status).toBe('queued');
  });

  it('should dispatch submitDeep signal with correct payload when POST /dream is called with sourceDate', async () => {
    const sourceDate = '2026-04-20';

    // WHEN
    const response = await request(setup.httpServer).post('/dream').send({ sourceDate });

    // THEN
    expect(response.status).toBe(202);
    expect(signalSpy).toHaveBeenCalledWith(
      'deep',
      expect.objectContaining({
        trigger: 'manual-backfill',
        source_date_iso: sourceDate,
        target_date: sourceDate,
      }),
    );
  });

  it('should return 400 when POST /dream is called with invalid sourceDate format', async () => {
    // WHEN
    const response = await request(setup.httpServer).post('/dream').send({ sourceDate: 'not-a-date' });

    // THEN
    expect(response.status).toBe(400);
  });

  describe('full pipeline with api-mock LLM', () => {
    it('should create dream_phases rows for all three phases when deep dream completes end-to-end', async () => {
      // GIVEN: Vault seeded with dailys (30 days) and coordinator workflow running.
      signalSpy.mockRestore();
      await setup.startWorker();

      const temporal = setup.app.get(TemporalClientService);
      temporal.coordinatorWorkflowId = `coord-deep-e2e-${Date.now()}`;
      await temporal.ensureCoordinatorRunning();

      await mock.register(phase1Stub());
      await mock.register(phase2Stub());
      await mock.register(phase3Stub());
      await mock.register(healthFixStub());

      const testStartedAt = new Date();
      // Use a sourceDate that exists in the seeded dailys (2026-05-08).
      // Using today's date (2026-05-11) would fail with emptyInputs since
      // the vault only has dailys up to 2026-05-08 in local mode.
      const sourceDate = '2026-05-07';

      // WHEN: Trigger deep dream pipeline via HTTP
      const triggerResponse = await request(setup.httpServer).post('/dream').send({ sourceDate });
      expect(triggerResponse.status).toBe(202);

      // THEN: Poll until all three phases complete
      const startMs = Date.now();
      let phases: Array<{ phase: string; status: string }> = [];
      while (Date.now() - startMs < 240_000) {
        phases = await setup.dataSource.query(
          `SELECT dp.phase, dp.status
           FROM jarvis.dream_phases dp
           JOIN jarvis.dreams d ON d.id = dp.dream_id
           WHERE d.type = 'deep' AND d.created_at >= $1
           ORDER BY dp.started_at`,
          [testStartedAt],
        );
        const hasAllPhases = ['phase1_light_sleep', 'phase2_rem_sleep', 'phase3_deep_sleep'].every((p) =>
          phases.some((r) => r.phase === p && r.status === 'completed'),
        );
        if (hasAllPhases) break;
        await new Promise((r) => setTimeout(r, 3_000));
      }

      expect(phases.some((p) => p.phase === 'phase1_light_sleep' && p.status === 'completed')).toBe(true);
      expect(phases.some((p) => p.phase === 'phase2_rem_sleep' && p.status === 'completed')).toBe(true);
      expect(phases.some((p) => p.phase === 'phase3_deep_sleep' && p.status === 'completed')).toBe(true);
    });
  });
});
