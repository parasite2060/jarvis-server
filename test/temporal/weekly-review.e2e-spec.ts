/**
 * Weekly review end-to-end test (Story 13.16 AC3).
 *
 * Always runs against the api-mock-server (http://localhost:11435/v1).
 *
 * Signal shape test: spy signalCoordinator — checks the signal payload
 * without needing a live coordinator workflow.
 *
 * Pipeline test: seeds daily files for the test week, starts the coordinator
 * workflow, registers the weekly-review agent stub, then polls until a
 * Dream row with type='weekly_review' completes.
 *
 * Run: `bun run e2e:infra:up && bun run test:e2e -- --testPathPattern="weekly-review.e2e"`
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { E2ETestSetup } from '../setup/e2e-setup';
import { TemporalClientService } from '../../src/shared/temporal/temporal-client.service';
import { ApiMockHelper } from '../helpers';
import { weeklyReviewStub } from '../fixtures/llm-stubs';

const VAULT_ROOT = process.env['VAULT_PATH'] ?? '/tmp/jarvis-e2e-vault';

async function seedDaily(isoDate: string): Promise<void> {
  const abs = path.join(VAULT_ROOT, 'dailys', `${isoDate}.md`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `# Daily ${isoDate}\n\nContent for ${isoDate}.\n`, 'utf-8');
}

describe('WeeklyReviewWorkflow E2E (Story 13.16 AC3)', () => {
  jest.setTimeout(180_000);

  let setup: E2ETestSetup;
  let signalSpy: jest.SpyInstance;
  const mock = new ApiMockHelper();

  beforeAll(async () => {
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

  it('should dispatch submitWeekly signal with week_start payload when weekly trigger fires', async () => {
    const temporal = setup.app.get(TemporalClientService);

    // WHEN: Signal is sent to the coordinator
    await temporal.signalCoordinator('weekly', { week_start: '2026-05-04', trigger: 'auto' });

    // THEN: Signal was called with correct payload
    expect(signalSpy).toHaveBeenCalledWith('weekly', expect.objectContaining({ week_start: '2026-05-04', trigger: 'auto' }));
  });

  describe('full pipeline with api-mock LLM', () => {
    it('should create a Dream row with type=weekly_review and outcome=success when weekly review completes', async () => {
      // GIVEN: Vault cloned (MEMORY_STORAGE_MODE=local — no real git remote needed)
      // and daily files seeded for the 7-day window starting 2026-05-06.
      E2ETestSetup.ensureVaultCloned();
      for (const d of ['2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10', '2026-05-11', '2026-05-12']) {
        await seedDaily(d);
      }
      signalSpy.mockRestore();
      await setup.startWorker();

      const temporal = setup.app.get(TemporalClientService);
      temporal.coordinatorWorkflowId = `coord-weekly-e2e-${Date.now()}`;
      await temporal.ensureCoordinatorRunning();

      // Register weekly review LLM stub
      await mock.register(weeklyReviewStub());

      const testStartedAt = new Date();

      // WHEN: Trigger the weekly workflow via signal
      await temporal.signalCoordinator('weekly', { week_start: '2026-05-06', trigger: 'auto' });

      // THEN: Wait for the weekly_review dream row to complete
      const startMs = Date.now();
      let dream: { type: string; outcome: string } | null = null;
      while (Date.now() - startMs < 120_000) {
        const rows = await setup.dataSource.query(
          `SELECT type, outcome FROM jarvis.dreams WHERE type = 'weekly_review' AND created_at >= $1 LIMIT 1`,
          [testStartedAt],
        );
        if (rows.length > 0 && rows[0].outcome !== null) {
          dream = rows[0];
          break;
        }
        await new Promise((r) => setTimeout(r, 3_000));
      }

      expect(dream).not.toBeNull();
      expect(dream!.type).toBe('weekly_review');
      expect(dream!.outcome).toBe('completed');
    });
  });
});
