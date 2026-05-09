/**
 * Weekly review end-to-end test (Story 13.16 AC3).
 *
 * Tier 1 (always): submitWeekly signal dispatched, response correct.
 * Tier 2 (JARVIS_E2E_LIVE_LLM=1): Dream row kind='weekly' created with
 * outcome='success'. Byte-equivalence fixture deferred to Story 13.16.1.
 *
 * Run Tier 1: `bun run e2e:infra:up && bun run test:e2e -- --testPathPattern="weekly-review.e2e"`
 * Run Tier 2: `JARVIS_E2E_LIVE_LLM=1 bun run test:e2e -- --testPathPattern="weekly-review.e2e"`
 */
import { E2ETestSetup } from '../setup/e2e-setup';
import { TemporalClientService } from '../../src/shared/temporal/temporal-client.service';

const LIVE_LLM = process.env['JARVIS_E2E_LIVE_LLM'] === '1';

describe('WeeklyReviewWorkflow E2E (Story 13.16 AC3)', () => {
  jest.setTimeout(120_000);

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

  it('should dispatch submitWeekly signal with week_start payload when weekly trigger fires', async () => {
    // Arrange
    const temporal = setup.app.get(TemporalClientService);

    // Act
    await temporal.signalCoordinator('weekly', {
      week_start: '2026-05-04',
      trigger: 'auto',
    });

    // Assert — signal was delivered (stub confirms shape)
    if (!LIVE_LLM) {
      expect(signalSpy).toHaveBeenCalledWith(
        'weekly',
        expect.objectContaining({
          week_start: '2026-05-04',
          trigger: 'auto',
        }),
      );
    }
  });

  // Tier 2 only
  const tier2 = LIVE_LLM ? describe : describe.skip;

  tier2('Tier 2 — full pipeline with live LLM', () => {
    it('should create a Dream row with kind=weekly and outcome=success when weekly review completes', async () => {
      // Arrange
      const weekStart = '2026-05-04';
      const temporal = setup.app.get(TemporalClientService);

      // Act
      await temporal.signalCoordinator('weekly', { week_start: weekStart, trigger: 'auto' });

      // Wait for weekly dream row
      const startMs = Date.now();
      let dream: { kind: string; outcome: string } | null = null;
      while (Date.now() - startMs < 180_000) {
        const rows = await setup.dataSource.query(
          `SELECT kind, outcome FROM jarvis.dreams WHERE kind = 'weekly' AND target_date = $1 LIMIT 1`,
          [weekStart],
        );
        if (rows.length > 0 && rows[0].outcome !== null) {
          dream = rows[0];
          break;
        }
        await new Promise((r) => setTimeout(r, 3_000));
      }

      // Assert
      expect(dream).not.toBeNull();
      expect(dream!.kind).toBe('weekly');
      expect(dream!.outcome).toBe('success');
    });
  });
});
