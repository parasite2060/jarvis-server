/**
 * Unit specs for `DreamRepositoryImpl` (Story 13.2 / Task 10).
 *
 * pg-mem caveat — pg-mem does NOT model PostgreSQL custom schemas. The
 * production `DreamSchema` declares `schema: 'jarvis'`; for pg-mem tests we
 * clone the EntitySchema with the `schema` option stripped so tables land in
 * the default namespace. Real `jarvis.dreams` schema verification is the
 * integration spec at `test/integration/dream-repository.e2e-spec.ts`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntitySchema } from 'typeorm';
import { createPgMemDataSource, PgMemTestHelper } from '../../../../test/helpers/pg-mem.helper';
import { DreamRepositoryImpl } from './dream.repository.impl';
import { DreamSchema } from '../schema/dream.schema';
import { Dream } from 'src/shared/domain/entities/dream.entity';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DBConnections } from '../utils/constaint';

const PgMemDreamSchema = new EntitySchema<Dream>({
  ...DreamSchema.options,
  schema: undefined,
});

describe('DreamRepositoryImpl', () => {
  let target: DreamRepositoryImpl;
  let dataSource: DataSource;
  let helper: PgMemTestHelper;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource([PgMemDreamSchema]);
    helper = new PgMemTestHelper(dataSource);

    const repository = dataSource.getRepository(PgMemDreamSchema);

    moduleRef = await Test.createTestingModule({
      providers: [
        DreamRepositoryImpl,
        {
          provide: getRepositoryToken(DreamSchema, DBConnections.INTERNAL),
          useValue: repository,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<DreamRepositoryImpl>(DreamRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await helper.clearTable(PgMemDreamSchema);
  });

  describe('createDream', () => {
    it('should persist a dream and return autoincrement id', async () => {
      // Arrange
      const input: Partial<Dream> = { type: 'light', trigger: 'plugin' };

      // Act
      const result = await target.createDream(input);

      // Assert
      expect(result.id).toBeDefined();
      expect(result.type).toBe('light');
      expect(result.trigger).toBe('plugin');
      expect(result.status).toBe('queued');
    });
  });

  describe('updateDreamOutcome', () => {
    it('should update outcome and status when both provided', async () => {
      // Arrange
      const dream = await target.createDream({ type: 'light', trigger: 'plugin' });

      // Act
      await target.updateDreamOutcome(dream.id, 'wrote_files', 'completed');

      // Assert
      const updated = await target.findById(dream.id);
      expect(updated?.outcome).toBe('wrote_files');
      expect(updated?.status).toBe('completed');
    });

    it('should leave status untouched when only outcome is provided', async () => {
      // Arrange
      const dream = await target.createDream({ type: 'light', trigger: 'plugin', status: 'running' });

      // Act
      await target.updateDreamOutcome(dream.id, 'no_new_content');

      // Assert
      const updated = await target.findById(dream.id);
      expect(updated?.outcome).toBe('no_new_content');
      expect(updated?.status).toBe('running');
    });
  });

  describe('persistSessionLog', () => {
    it('should round-trip a JSONB session log identically', async () => {
      // Arrange
      const dream = await target.createDream({ type: 'light', trigger: 'plugin' });
      const sessionLog = { conversationId: 'c-1', memories: [{ kind: 'decision', text: 'x' }] };

      // Act
      await target.persistSessionLog(dream.id, sessionLog);

      // Assert
      const reloaded = await target.findById(dream.id);
      expect(reloaded?.sessionLog).toEqual(sessionLog);
    });
  });

  describe('findByDate', () => {
    it('should return only dreams whose createdAt falls on the requested UTC day', async () => {
      // Arrange
      const target1 = await target.createDream({ type: 'light', trigger: 'plugin' });
      const target2 = await target.createDream({ type: 'deep', trigger: 'cron' });
      const other = await target.createDream({ type: 'weekly', trigger: 'cron' });
      await dataSource.getRepository(PgMemDreamSchema).update({ id: target1.id }, { createdAt: new Date('2026-05-07T03:00:00.000Z') });
      await dataSource.getRepository(PgMemDreamSchema).update({ id: target2.id }, { createdAt: new Date('2026-05-07T20:00:00.000Z') });
      await dataSource.getRepository(PgMemDreamSchema).update({ id: other.id }, { createdAt: new Date('2026-05-08T00:30:00.000Z') });

      // Act
      const result = await target.findByDate('2026-05-07');

      // Assert
      expect(result.map((d) => d.id).sort()).toEqual([target1.id, target2.id].sort());
    });
  });

  describe('findById', () => {
    it('should return null when the dream does not exist', async () => {
      // Act
      const result = await target.findById(999_999);

      // Assert
      expect(result).toBeNull();
    });
  });
});
