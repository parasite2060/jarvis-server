/**
 * Unit specs for `ConversationRepositoryImpl` (Story 13.2 / Task 10).
 *
 * pg-mem caveat — pg-mem does NOT model PostgreSQL custom schemas (`SET
 * search_path` is a no-op). The production `TranscriptSchema` declares
 * `schema: 'jarvis'`; for pg-mem tests we clone the EntitySchema with the
 * `schema` option stripped so tables land in the default namespace. The
 * real-schema (`jarvis.transcripts`) verification path is the integration
 * spec at `test/integration/conversation-repository.e2e-spec.ts`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntitySchema } from 'typeorm';
import { createPgMemDataSource, PgMemTestHelper } from '../../../../test/helpers/pg-mem.helper';
import { ConversationRepositoryImpl } from './conversation.repository.impl';
import { TranscriptSchema } from '../schema/transcript.schema';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DBConnections } from '../utils/constaint';

const PgMemTranscriptSchema = new EntitySchema<Conversation>({
  ...TranscriptSchema.options,
  schema: undefined,
});

describe('ConversationRepositoryImpl', () => {
  let target: ConversationRepositoryImpl;
  let dataSource: DataSource;
  let helper: PgMemTestHelper;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource([PgMemTranscriptSchema]);
    helper = new PgMemTestHelper(dataSource);

    const repository = dataSource.getRepository(PgMemTranscriptSchema);

    moduleRef = await Test.createTestingModule({
      providers: [
        ConversationRepositoryImpl,
        {
          provide: getRepositoryToken(TranscriptSchema, DBConnections.INTERNAL),
          useValue: repository,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<ConversationRepositoryImpl>(ConversationRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await helper.clearTable(PgMemTranscriptSchema);
  });

  describe('insertTranscript', () => {
    it('should persist a transcript and return autoincrement id', async () => {
      // Arrange
      const input: Partial<Conversation> = {
        sessionId: 'sess-1',
        rawContent: 'hello world',
        source: 'plugin',
      };

      // Act
      const result = await target.insertTranscript(input);

      // Assert
      expect(result.id).toBeDefined();
      expect(result.sessionId).toBe('sess-1');
      expect(result.rawContent).toBe('hello world');
      await helper.assertRecordExists(PgMemTranscriptSchema, { id: result.id }, input);
    });
  });

  describe('findBySessionId', () => {
    it('should return all transcripts for a session in createdAt order', async () => {
      // Arrange
      await target.insertTranscript({ sessionId: 'sess-2', rawContent: 'first' });
      await target.insertTranscript({ sessionId: 'sess-2', rawContent: 'second' });
      await target.insertTranscript({ sessionId: 'sess-other', rawContent: 'unrelated' });

      // Act
      const result = await target.findBySessionId('sess-2');

      // Assert
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.rawContent)).toEqual(['first', 'second']);
    });

    it('should return empty array when no transcripts match', async () => {
      // Act
      const result = await target.findBySessionId('missing');

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('getLastProcessedLine', () => {
    it('should return 0 when no transcripts exist for the session', async () => {
      // Act
      const result = await target.getLastProcessedLine('missing');

      // Assert
      expect(result).toBe(0);
    });

    it('should return the lastProcessedLine of the most recent transcript', async () => {
      // Arrange
      await target.insertTranscript({
        sessionId: 'sess-3',
        rawContent: 'older',
        lastProcessedLine: 50,
      });
      await target.insertTranscript({
        sessionId: 'sess-3',
        rawContent: 'newer',
        lastProcessedLine: 120,
      });

      // Act
      const result = await target.getLastProcessedLine('sess-3');

      // Assert
      expect(result).toBe(120);
    });
  });

  describe('setLastProcessedLine', () => {
    it('should update lastProcessedLine for every transcript in the session', async () => {
      // Arrange
      await target.insertTranscript({ sessionId: 'sess-4', rawContent: 'a', lastProcessedLine: 10 });
      await target.insertTranscript({ sessionId: 'sess-4', rawContent: 'b', lastProcessedLine: 20 });

      // Act
      await target.setLastProcessedLine('sess-4', 200);

      // Assert
      const rows = await target.findBySessionId('sess-4');
      expect(rows.map((r) => r.lastProcessedLine)).toEqual([200, 200]);
      expect(await target.getLastProcessedLine('sess-4')).toBe(200);
    });
  });

  describe('findRecentBySession', () => {
    it('should return only transcripts within the time window', async () => {
      // Arrange
      const now = Date.now();
      const old = await target.insertTranscript({ sessionId: 'sess-5', rawContent: 'old' });
      const fresh = await target.insertTranscript({ sessionId: 'sess-5', rawContent: 'fresh' });
      await dataSource.getRepository(PgMemTranscriptSchema).update({ id: old.id }, { createdAt: new Date(now - 5 * 60_000) });
      await dataSource.getRepository(PgMemTranscriptSchema).update({ id: fresh.id }, { createdAt: new Date(now - 10_000) });

      // Act
      const result = await target.findRecentBySession('sess-5', 60_000);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.rawContent).toBe('fresh');
    });
  });
});
