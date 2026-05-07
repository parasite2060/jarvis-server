import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMongoMemoryServer, getMongooseTestModule, MongoTestHelper } from '../../../../test/helpers/mongo.helper';
import { AuditLogRepository } from './audit-log.repository.impl';
import { AuditLogDocument, AuditLogSchema } from '../schemas/audit-log.schema';
import { AuditLog, AuditLogAction } from 'src/shared/domain/entities/audit-log.entity';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('AuditLogRepository', () => {
  let target: AuditLogRepository;
  let auditLogModel: Model<AuditLogDocument>;
  let mongoServer: MongoMemoryServer;
  let moduleRef: TestingModule;
  let connection: Connection;
  let helper: MongoTestHelper;

  beforeAll(async () => {
    mongoServer = await createMongoMemoryServer();
    const mongooseModule = getMongooseTestModule(mongoServer);

    moduleRef = await Test.createTestingModule({
      imports: [mongooseModule, MongooseModule.forFeature([{ name: AuditLogDocument.name, schema: AuditLogSchema }])],
      providers: [AuditLogRepository],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<AuditLogRepository>(AuditLogRepository);
    auditLogModel = moduleRef.get<Model<AuditLogDocument>>(`${AuditLogDocument.name}Model`);
    connection = moduleRef.get<Connection>(getConnectionToken());
    helper = new MongoTestHelper(connection);
    await auditLogModel.createIndexes();
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    await mongoServer?.stop();
  });

  beforeEach(async () => {
    await auditLogModel.deleteMany({});
  });

  describe('create', () => {
    it('should create and persist audit log', async () => {
      // Arrange
      const input: Partial<AuditLog> = {
        eventCode: 'BLOG_CREATED',
        entityType: 'Blog',
        entityId: 'blog-123',
        action: 'CREATE' as AuditLogAction,
        payload: { title: 'Test Blog', content: 'Test Content' },
        actor: { id: 'user-1', name: 'John Doe' },
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      };

      // Act
      const result = await target.create(input);

      // Assert
      expect(result.id).toBeDefined();
      expect(result.eventCode).toBe('BLOG_CREATED');
      expect(result.entityType).toBe('Blog');
      expect(result.entityId).toBe('blog-123');
      expect(result.action).toBe('CREATE');
      expect(result.payload).toEqual({ title: 'Test Blog', content: 'Test Content' });
      expect(result.actor).toEqual({ id: 'user-1', name: 'John Doe' });
      expect(result.timestamp).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(result.createdAt).toBeDefined();
      await helper.assertDocumentCount('audit_logs', { entityId: 'blog-123' }, 1);
    });

    it('should create audit log with actor without id', async () => {
      // Arrange
      const input: Partial<AuditLog> = {
        eventCode: 'BLOG_DELETED',
        entityType: 'Blog',
        entityId: 'blog-456',
        action: 'DELETE' as AuditLogAction,
        payload: { reason: 'user requested' },
        actor: { name: 'System' },
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
      };

      // Act
      const result = await target.create(input);

      // Assert
      expect(result.id).toBeDefined();
      expect(result.eventCode).toBe('BLOG_DELETED');
      expect(result.entityType).toBe('Blog');
      expect(result.entityId).toBe('blog-456');
      expect(result.action).toBe('DELETE');
      expect(result.payload).toEqual({ reason: 'user requested' });
      expect(result.actor).toEqual({ name: 'System' });
      expect(result.timestamp).toEqual(new Date('2024-01-02T00:00:00.000Z'));
      expect(result.createdAt).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should find audit log by id', async () => {
      // Arrange
      const auditLog = await target.create({
        eventCode: 'BLOG_UPDATED',
        entityType: 'Blog',
        entityId: 'blog-789',
        action: 'UPDATE' as AuditLogAction,
        payload: { title: 'Updated Title' },
        actor: { id: 'user-2', name: 'Jane Doe' },
        timestamp: new Date('2024-01-03T00:00:00.000Z'),
      });

      // Act
      const result = await target.findById(auditLog.id);

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe(auditLog.id);
      expect(result?.eventCode).toBe('BLOG_UPDATED');
      expect(result?.entityType).toBe('Blog');
      expect(result?.entityId).toBe('blog-789');
      expect(result?.action).toBe('UPDATE');
      expect(result?.payload).toEqual({ title: 'Updated Title' });
      expect(result?.actor).toEqual({ id: 'user-2', name: 'Jane Doe' });
      expect(result?.timestamp).toEqual(new Date('2024-01-03T00:00:00.000Z'));
    });

    it('should return null for non-existent audit log', async () => {
      // Arrange
      const nonExistentId = '507f1f77bcf86cd799439011';

      // Act
      const result = await target.findById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByEntityId', () => {
    it('should find audit logs by entity id with pagination', async () => {
      // Arrange
      await target.create({
        eventCode: 'BLOG_CREATED',
        entityType: 'Blog',
        entityId: 'blog-100',
        action: 'CREATE' as AuditLogAction,
        payload: { title: 'Blog 100' },
        actor: { name: 'User A' },
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_UPDATED',
        entityType: 'Blog',
        entityId: 'blog-100',
        action: 'UPDATE' as AuditLogAction,
        payload: { title: 'Updated Blog 100' },
        actor: { name: 'User B' },
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_UPDATED',
        entityType: 'Blog',
        entityId: 'blog-100',
        action: 'UPDATE' as AuditLogAction,
        payload: { content: 'New content' },
        actor: { name: 'User C' },
        timestamp: new Date('2024-01-03T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_CREATED',
        entityType: 'Blog',
        entityId: 'blog-200',
        action: 'CREATE' as AuditLogAction,
        payload: { title: 'Blog 200' },
        actor: { name: 'User D' },
        timestamp: new Date('2024-01-04T00:00:00.000Z'),
      });

      // Act
      const result = await target.findByEntityId('blog-100', { page: 1, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.items[0]!.timestamp).toEqual(new Date('2024-01-03T00:00:00.000Z'));
      expect(result.items[0]!.actor.name).toBe('User C');
      expect(result.items[1]!.timestamp).toEqual(new Date('2024-01-02T00:00:00.000Z'));
      expect(result.items[1]!.actor.name).toBe('User B');
    });

    it('should respect pagination limits for findByEntityId', async () => {
      // Arrange
      await target.create({
        eventCode: 'BLOG_CREATED',
        entityType: 'Blog',
        entityId: 'blog-300',
        action: 'CREATE' as AuditLogAction,
        payload: { title: 'Blog 300' },
        actor: { name: 'User A' },
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_UPDATED',
        entityType: 'Blog',
        entityId: 'blog-300',
        action: 'UPDATE' as AuditLogAction,
        payload: { title: 'Updated' },
        actor: { name: 'User B' },
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_UPDATED',
        entityType: 'Blog',
        entityId: 'blog-300',
        action: 'UPDATE' as AuditLogAction,
        payload: { content: 'Updated content' },
        actor: { name: 'User C' },
        timestamp: new Date('2024-01-03T00:00:00.000Z'),
      });

      // Act
      const result = await target.findByEntityId('blog-300', { page: 2, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(3);
      expect(result.items[0]!.timestamp).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(result.items[0]!.actor.name).toBe('User A');
    });

    it('should return empty array for non-existent entity id', async () => {
      // Arrange
      await target.create({
        eventCode: 'BLOG_CREATED',
        entityType: 'Blog',
        entityId: 'blog-400',
        action: 'CREATE' as AuditLogAction,
        payload: { title: 'Blog 400' },
        actor: { name: 'User A' },
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      });

      // Act
      const result = await target.findByEntityId('blog-999', { page: 1, limit: 10 });

      // Assert
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('findAll', () => {
    it('should find all audit logs with pagination', async () => {
      // Arrange
      await target.create({
        eventCode: 'BLOG_CREATED',
        entityType: 'Blog',
        entityId: 'blog-1',
        action: 'CREATE' as AuditLogAction,
        payload: { title: 'Blog 1' },
        actor: { name: 'User A' },
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_UPDATED',
        entityType: 'Blog',
        entityId: 'blog-2',
        action: 'UPDATE' as AuditLogAction,
        payload: { title: 'Updated Blog 2' },
        actor: { name: 'User B' },
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_DELETED',
        entityType: 'Blog',
        entityId: 'blog-3',
        action: 'DELETE' as AuditLogAction,
        payload: { reason: 'spam' },
        actor: { name: 'User C' },
        timestamp: new Date('2024-01-03T00:00:00.000Z'),
      });

      // Act
      const result = await target.findAll({ page: 1, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.items[0]!.timestamp).toEqual(new Date('2024-01-03T00:00:00.000Z'));
      expect(result.items[0]!.action).toBe('DELETE');
      expect(result.items[1]!.timestamp).toEqual(new Date('2024-01-02T00:00:00.000Z'));
      expect(result.items[1]!.action).toBe('UPDATE');
    });

    it('should respect pagination limits for findAll', async () => {
      // Arrange
      await target.create({
        eventCode: 'BLOG_CREATED',
        entityType: 'Blog',
        entityId: 'blog-1',
        action: 'CREATE' as AuditLogAction,
        payload: { title: 'Blog 1' },
        actor: { name: 'User A' },
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_UPDATED',
        entityType: 'Blog',
        entityId: 'blog-2',
        action: 'UPDATE' as AuditLogAction,
        payload: { title: 'Updated Blog 2' },
        actor: { name: 'User B' },
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
      });
      await target.create({
        eventCode: 'BLOG_DELETED',
        entityType: 'Blog',
        entityId: 'blog-3',
        action: 'DELETE' as AuditLogAction,
        payload: { reason: 'spam' },
        actor: { name: 'User C' },
        timestamp: new Date('2024-01-03T00:00:00.000Z'),
      });

      // Act
      const result = await target.findAll({ page: 2, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(3);
      expect(result.items[0]!.timestamp).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(result.items[0]!.action).toBe('CREATE');
    });

    it('should return empty array when no audit logs exist', async () => {
      // Act
      const result = await target.findAll({ page: 1, limit: 10 });

      // Assert
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
