/**
 * Conversation module E2E (Story 13.3 / AC #13).
 *
 * Boots the full AppModule against `docker-compose.e2e.yml` Postgres, then
 * exercises POST /conversations + GET /conversations/position end-to-end.
 * The `TemporalClientService` global is overridden with a Jest spy so we can
 * assert the signal-coordinator call without retrofitting the real Temporal
 * SDK (Story 13.8 owns that). The `SecretScrubberService` stays as the
 * pass-through stub.
 */
import * as request from 'supertest';
import { E2ETestSetup } from './setup/e2e-setup';
import { ErrorCode } from '../src/utils/error.code';
import { TemporalClientService } from '../src/shared/temporal/temporal-client.service';

describe('Conversation E2E Tests', () => {
  let setup: E2ETestSetup;
  let temporalSpy: jest.SpyInstance;

  jest.setTimeout(30000);

  beforeAll(async () => {
    setup = new E2ETestSetup();
    await setup.init();
    const temporal = setup.app.get(TemporalClientService);
    // Story 13.8 retrofit: signalCoordinator now opens a real connection.
    // The e2e infra has no Temporal cluster wired, so we stub the
    // implementation to a no-op resolved promise — this keeps the soft-fail
    // path in IngestTranscriptUseCase from triggering and lets us assert
    // the call shape (kind + snake_case payload).
    temporalSpy = jest.spyOn(temporal, 'signalCoordinator').mockResolvedValue(undefined);
  }, 90000);

  afterAll(async () => {
    await setup.teardown();
  }, 30000);

  beforeEach(async () => {
    await setup.cleanup();
    temporalSpy.mockClear();
  });

  describe('POST /conversations', () => {
    it('should ingest a transcript, return 202, and signal the coordinator with snake_case payload keys', async () => {
      // Arrange
      const body = {
        sessionId: 'sess-e2e-1',
        transcript: 'hello world',
        source: 'stop',
        segmentStartLine: 0,
        segmentEndLine: 1,
      };

      // Act
      const response = await request(setup.httpServer).post('/conversations').send(body);

      // Assert
      expect(response.status).toBe(202);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.transcriptId).toEqual(expect.any(Number));
      expect(response.body.data.duplicate).toBe(false);

      // Row persisted with status='queued' (signal succeeded → setStatus called).
      const rows = await setup.dataSource.query(
        `SELECT id, session_id, source, status, is_continuation FROM jarvis.transcripts WHERE session_id = $1`,
        [body.sessionId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('stop');
      expect(rows[0].status).toBe('queued');
      expect(rows[0].is_continuation).toBe(false);

      // Coordinator signal called with kind='light' and snake_case payload.
      expect(temporalSpy).toHaveBeenCalledTimes(1);
      expect(temporalSpy).toHaveBeenCalledWith('light', {
        transcript_id: rows[0].id,
        session_id: 'sess-e2e-1',
      });
    });

    it('should return 200 with duplicate=true on a second POST within the dedup window', async () => {
      // Arrange — first ingest
      const body = { sessionId: 'sess-e2e-2', transcript: 'first', source: 'stop' };
      const first = await request(setup.httpServer).post('/conversations').send(body);
      expect(first.status).toBe(202);
      const firstId = first.body.data.transcriptId;
      temporalSpy.mockClear();

      // Act — duplicate within 60s
      const second = await request(setup.httpServer).post('/conversations').send(body);

      // Assert
      expect(second.status).toBe(200);
      expect(second.body.data.transcriptId).toBe(firstId);
      expect(second.body.data.duplicate).toBe(true);

      const rows = await setup.dataSource.query(`SELECT id FROM jarvis.transcripts WHERE session_id = $1`, [body.sessionId]);
      expect(rows).toHaveLength(1);
      expect(temporalSpy).not.toHaveBeenCalled();
    });

    it('should persist is_continuation=true when prior transcripts exist for the session', async () => {
      // Arrange — first ingest with one source
      await request(setup.httpServer).post('/conversations').send({ sessionId: 'sess-e2e-3', transcript: 'first', source: 'stop' });

      // Act — second ingest with a different source (skips dedup; chain count > 0 → continuation)
      const second = await request(setup.httpServer)
        .post('/conversations')
        .send({ sessionId: 'sess-e2e-3', transcript: 'second', source: 'compact' });
      expect(second.status).toBe(202);

      // Assert
      const rows = await setup.dataSource.query(`SELECT id, source, is_continuation FROM jarvis.transcripts WHERE session_id = $1 ORDER BY id ASC`, [
        'sess-e2e-3',
      ]);
      expect(rows).toHaveLength(2);
      expect(rows[0].is_continuation).toBe(false);
      expect(rows[1].is_continuation).toBe(true);
    });
  });

  describe('GET /conversations/position', () => {
    it('should return last_line=0 with status 200 (NOT 404) when no transcript exists', async () => {
      // Act
      const response = await request(setup.httpServer).get('/conversations/position').query({ session_id: 'sess-missing' });

      // Assert — RAW snake_case body (NOT wrapped in HttpApiResponse) per MC1.
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ session_id: 'sess-missing', last_line: 0 });
    });

    it('should return the persisted last_processed_line value when set via SQL fixture', async () => {
      // Arrange — POST then bump last_processed_line directly (mimicking Story 13.10).
      await request(setup.httpServer).post('/conversations').send({ sessionId: 'sess-e2e-pos', transcript: 'x', source: 'stop' });
      await setup.dataSource.query(`UPDATE jarvis.transcripts SET last_processed_line = 250 WHERE session_id = $1`, ['sess-e2e-pos']);

      // Act
      const response = await request(setup.httpServer).get('/conversations/position').query({ session_id: 'sess-e2e-pos' });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ session_id: 'sess-e2e-pos', last_line: 250 });
    });
  });
});
