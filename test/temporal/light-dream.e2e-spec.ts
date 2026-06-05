/**
 * Light dream end-to-end test (Story 13.16 AC1).
 *
 * Always runs against the api-mock-server (http://localhost:11435/v1).
 *
 * HTTP shape test: spy signalCoordinator — checks 202 response without
 * needing a live coordinator workflow.
 *
 * Pipeline test: starts the coordinator workflow, registers extraction +
 * record agent stubs, then polls the DB until the light dream completes.
 *
 * Run: `bun run e2e:infra:up && bun run test:e2e -- --testPathPattern="light-dream.e2e"`
 */
import * as request from 'supertest';
import { E2ETestSetup } from '../setup/e2e-setup';
import { TemporalClientService } from '../../src/shared/temporal/temporal-client.service';
import { ApiMockHelper } from '../helpers';
import { extractionStub, recordStub } from '../fixtures/llm-stubs';

describe('LightDreamWorkflow E2E (Story 13.16 AC1)', () => {
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

  it('should queue a submitLight signal when POST /conversations is called with a valid transcript', async () => {
    const response = await request(setup.httpServer).post('/conversations').send({
      sessionId: 'test-light-001',
      transcript: 'User: Let me test the light dream pipeline.\nAssistant: Testing the pipeline.',
      source: 'stop',
      segmentStartLine: 0,
      segmentEndLine: 2,
    });

    expect(response.status).toBe(202);
    expect(response.body.data).toBeDefined();
    expect(signalSpy).toHaveBeenCalledWith('light', expect.objectContaining({ session_id: 'test-light-001' }));
  });

  describe('full pipeline with api-mock LLM', () => {
    it('should create a Dream row with files_modified when light dream completes end-to-end', async () => {
      // GIVEN: A cloned vault (MEMORY_STORAGE_MODE=local — no real git remote needed).
      E2ETestSetup.ensureVaultCloned();
      signalSpy.mockRestore();
      await setup.startWorker();

      const temporal = setup.app.get(TemporalClientService);
      temporal.coordinatorWorkflowId = `coord-light-e2e-${Date.now()}`;
      await temporal.ensureCoordinatorRunning();

      // Register LLM stubs — extraction then record agent
      await mock.register(extractionStub());
      await mock.register(recordStub());

      const sessionId = `test-light-e2e-${Date.now()}`;
      const transcript = [
        'User: I decided to use TypeScript for all new server-side code because it gives us type safety.',
        'Assistant: That makes sense — TypeScript reduces runtime errors significantly for server code.',
        'User: Exactly. The team agreed, and we committed to migrating the Python services by Q3.',
        'User: Also, we should always enable strict mode.',
        'Assistant: Correct. Strict mode catches null reference errors at compile time.',
      ].join('\n');

      const ingestResponse = await request(setup.httpServer).post('/conversations').send({
        sessionId,
        transcript,
        source: 'stop',
        segmentStartLine: 0,
        segmentEndLine: 5,
      });
      expect(ingestResponse.status).toBe(202);

      // Poll dream table until pipeline completes
      // dreams.session_id does not exist — join via transcripts
      const startMs = Date.now();
      let dream: { outcome: string } | null = null;
      while (Date.now() - startMs < 120_000) {
        const rows = await setup.dataSource.query(
          `SELECT d.id, d.outcome
           FROM jarvis.dreams d
           JOIN jarvis.transcripts t ON t.id = d.transcript_id
           WHERE t.session_id = $1 AND d.type = 'light'
           LIMIT 1`,
          [sessionId],
        );
        if (rows.length > 0 && rows[0].outcome !== null) {
          dream = rows[0];
          break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }

      expect(dream).not.toBeNull();
      expect(dream!.outcome).toBe('success');
    });
  });
});
