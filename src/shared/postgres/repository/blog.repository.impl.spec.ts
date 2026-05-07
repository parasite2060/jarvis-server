import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createPgMemDataSource, PgMemTestHelper } from '../../../../test/helpers/pg-mem.helper';
import { BlogRepositoryImpl } from './blog.repository.impl';
import { BlogSchema } from '../schema/blog.schema';
import { Blog } from 'src/shared/domain/entities/blog.entity';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DBConnections } from '../utils/constaint';

describe('BlogRepositoryImpl', () => {
  let target: BlogRepositoryImpl;
  let dataSource: DataSource;
  let helper: PgMemTestHelper;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource([BlogSchema]);
    helper = new PgMemTestHelper(dataSource);

    const repository = dataSource.getRepository(BlogSchema);

    moduleRef = await Test.createTestingModule({
      providers: [
        BlogRepositoryImpl,
        {
          provide: getRepositoryToken(BlogSchema, DBConnections.INTERNAL),
          useValue: repository,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<BlogRepositoryImpl>(BlogRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await helper.clearTable(BlogSchema);
  });

  describe('create', () => {
    it('should create and persist blog', async () => {
      // Arrange
      const input: Partial<Blog> = {
        title: 'Test Blog',
        content: 'Test Content',
        authorId: 'author-1',
      };

      // Act
      const result = await target.create(input);

      // Assert
      expect(result.id).toBeDefined();
      expect(result.title).toBe('Test Blog');
      expect(result.content).toBe('Test Content');
      expect(result.authorId).toBe('author-1');
      expect(result.isValid).toBe(true);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      await helper.assertRecordExists(BlogSchema, { id: result.id }, input);
    });
  });

  describe('findById', () => {
    it('should find blog by id', async () => {
      // Arrange
      const blog = await target.create({
        title: 'Test Blog',
        content: 'Test Content',
        authorId: 'author-1',
      });

      // Act
      const result = await target.findById(blog.id);

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe(blog.id);
      expect(result?.title).toBe('Test Blog');
      expect(result?.content).toBe('Test Content');
      expect(result?.authorId).toBe('author-1');
    });

    it('should return null for soft-deleted blog', async () => {
      // Arrange
      const blog = await target.create({
        title: 'Test Blog',
        content: 'Test Content',
        authorId: 'author-1',
      });
      await target.softDelete(blog.id);

      // Act
      const result = await target.findById(blog.id);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent blog', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const result = await target.findById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should find all blogs with pagination', async () => {
      // Arrange
      await target.create({ title: 'Blog 1', content: 'Content 1', authorId: 'author-1' });
      await target.create({ title: 'Blog 2', content: 'Content 2', authorId: 'author-1' });
      await target.create({ title: 'Blog 3', content: 'Content 3', authorId: 'author-1' });

      // Act
      const result = await target.findAll({ page: 1, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.items[0]!.title).toBe('Blog 3'); // DESC order by createdAt
    });

    it('should respect pagination limits', async () => {
      // Arrange
      const blog1 = await target.create({ title: 'Blog 1', content: 'Content 1', authorId: 'author-1' });
      await target.create({ title: 'Blog 2', content: 'Content 2', authorId: 'author-1' });
      await target.create({ title: 'Blog 3', content: 'Content 3', authorId: 'author-1' });

      // Act
      const result = await target.findAll({ page: 2, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(3);
      // Third item should be the oldest (first created)
      const resultIds = result.items.map((b) => b.id);
      expect(resultIds).toContain(blog1.id);
    });

    it('should exclude soft-deleted blogs', async () => {
      // Arrange
      const blog1 = await target.create({ title: 'Blog 1', content: 'Content 1', authorId: 'author-1' });
      await target.create({ title: 'Blog 2', content: 'Content 2', authorId: 'author-1' });
      await target.softDelete(blog1.id);

      // Act
      const result = await target.findAll({ page: 1, limit: 10 });

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0]!.title).toBe('Blog 2');
    });
  });

  describe('update', () => {
    it('should update blog and return updated entity', async () => {
      // Arrange
      const blog = await target.create({
        title: 'Original Title',
        content: 'Original Content',
        authorId: 'author-1',
      });

      // Act
      const result = await target.update(blog.id, {
        title: 'Updated Title',
        content: 'Updated Content',
      });

      // Assert
      expect(result).toBeDefined();
      expect(result?.title).toBe('Updated Title');
      expect(result?.content).toBe('Updated Content');
      expect(result?.authorId).toBe('author-1'); // Unchanged
      await helper.assertRecordExists(
        BlogSchema,
        { id: blog.id },
        {
          title: 'Updated Title',
          content: 'Updated Content',
        },
      );
    });

    it('should return null for soft-deleted blog', async () => {
      // Arrange
      const blog = await target.create({
        title: 'Test Blog',
        content: 'Test Content',
        authorId: 'author-1',
      });
      await target.softDelete(blog.id);

      // Act
      const result = await target.update(blog.id, { title: 'Updated Title' });

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent blog', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const result = await target.update(nonExistentId, { title: 'Updated Title' });

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('should soft delete blog (set isValid to false)', async () => {
      // Arrange
      const blog = await target.create({
        title: 'Test Blog',
        content: 'Test Content',
        authorId: 'author-1',
      });

      // Act
      const result = await target.softDelete(blog.id);

      // Assert
      expect(result).toBe(true);
      await helper.assertSoftDeleted(BlogSchema, blog.id);
    });

    it('should return false for non-existent blog', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const result = await target.softDelete(nonExistentId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when trying to delete already soft-deleted blog', async () => {
      // Arrange
      const blog = await target.create({
        title: 'Test Blog',
        content: 'Test Content',
        authorId: 'author-1',
      });
      await target.softDelete(blog.id);

      // Act
      const result = await target.softDelete(blog.id);

      // Assert
      expect(result).toBe(false);
    });
  });
});
