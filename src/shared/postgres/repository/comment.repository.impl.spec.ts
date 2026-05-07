import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createPgMemDataSource, PgMemTestHelper } from '../../../../test/helpers/pg-mem.helper';
import { CommentRepositoryImpl } from './comment.repository.impl';
import { CommentSchema } from '../schema/comment.schema';
import { Comment } from 'src/shared/domain/entities/comment.entity';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DBConnections } from '../utils/constaint';

describe('CommentRepositoryImpl', () => {
  let target: CommentRepositoryImpl;
  let dataSource: DataSource;
  let helper: PgMemTestHelper;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource([CommentSchema]);
    helper = new PgMemTestHelper(dataSource);

    const repository = dataSource.getRepository(CommentSchema);

    moduleRef = await Test.createTestingModule({
      providers: [
        CommentRepositoryImpl,
        {
          provide: getRepositoryToken(CommentSchema, DBConnections.INTERNAL),
          useValue: repository,
        },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get<CommentRepositoryImpl>(CommentRepositoryImpl);
  }, 60000);

  afterAll(async () => {
    await moduleRef?.close();
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await helper.clearTable(CommentSchema);
  });

  describe('create', () => {
    it('should create and persist comment', async () => {
      // Arrange
      const blogId = randomUUID();
      const input: Partial<Comment> = {
        content: 'Test Comment',
        blogId,
        authorId: 'author-1',
      };

      // Act
      const result = await target.create(input);

      // Assert
      expect(result.id).toBeDefined();
      expect(result.content).toBe('Test Comment');
      expect(result.blogId).toBe(blogId);
      expect(result.authorId).toBe('author-1');
      expect(result.isValid).toBe(true);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      await helper.assertRecordExists(CommentSchema, { id: result.id }, input);
    });
  });

  describe('findById', () => {
    it('should find comment by id', async () => {
      // Arrange
      const blogId = randomUUID();
      const comment = await target.create({
        content: 'Test Comment',
        blogId,
        authorId: 'author-1',
      });

      // Act
      const result = await target.findById(comment.id);

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe(comment.id);
      expect(result?.content).toBe('Test Comment');
      expect(result?.blogId).toBe(blogId);
      expect(result?.authorId).toBe('author-1');
    });

    it('should return null for soft-deleted comment', async () => {
      // Arrange
      const blogId = randomUUID();
      const comment = await target.create({
        content: 'Test Comment',
        blogId,
        authorId: 'author-1',
      });
      await target.softDelete(comment.id);

      // Act
      const result = await target.findById(comment.id);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent comment', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const result = await target.findById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByBlogId', () => {
    it('should find comments by blog id with pagination', async () => {
      // Arrange
      const blogId1 = randomUUID();
      const blogId2 = randomUUID();
      await target.create({ content: 'Comment 1', blogId: blogId1, authorId: 'author-1' });
      await target.create({ content: 'Comment 2', blogId: blogId1, authorId: 'author-1' });
      await target.create({ content: 'Comment 3', blogId: blogId1, authorId: 'author-1' });
      await target.create({ content: 'Comment 4', blogId: blogId2, authorId: 'author-1' });

      // Act
      const result = await target.findByBlogId(blogId1, { page: 1, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.items[0]!.content).toBe('Comment 3'); // DESC order by createdAt
      expect(result.items[0]!.blogId).toBe(blogId1);
    });

    it('should respect pagination limits', async () => {
      // Arrange
      const blogId = randomUUID();
      await target.create({ content: 'Comment 1', blogId, authorId: 'author-1' });
      await target.create({ content: 'Comment 2', blogId, authorId: 'author-1' });
      await target.create({ content: 'Comment 3', blogId, authorId: 'author-1' });

      // Act
      const result = await target.findByBlogId(blogId, { page: 2, limit: 2 });

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(3);
      expect(result.items[0]!.content).toBe('Comment 1');
    });

    it('should exclude soft-deleted comments', async () => {
      // Arrange
      const blogId = randomUUID();
      const comment1 = await target.create({ content: 'Comment 1', blogId, authorId: 'author-1' });
      await target.create({ content: 'Comment 2', blogId, authorId: 'author-1' });
      await target.softDelete(comment1.id);

      // Act
      const result = await target.findByBlogId(blogId, { page: 1, limit: 10 });

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0]!.content).toBe('Comment 2');
    });

    it('should return empty array for blog with no comments', async () => {
      // Arrange
      const blogId1 = randomUUID();
      const blogId2 = randomUUID();
      await target.create({ content: 'Comment 1', blogId: blogId1, authorId: 'author-1' });

      // Act
      const result = await target.findByBlogId(blogId2, { page: 1, limit: 10 });

      // Assert
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should filter by specific blog id only', async () => {
      // Arrange
      const blogId1 = randomUUID();
      const blogId2 = randomUUID();
      await target.create({ content: 'Comment 1', blogId: blogId1, authorId: 'author-1' });
      await target.create({ content: 'Comment 2', blogId: blogId2, authorId: 'author-1' });
      await target.create({ content: 'Comment 3', blogId: blogId1, authorId: 'author-1' });

      // Act
      const result = await target.findByBlogId(blogId1, { page: 1, limit: 10 });

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.items.every((c) => c.blogId === blogId1)).toBe(true);
    });
  });

  describe('update', () => {
    it('should update comment and return updated entity', async () => {
      // Arrange
      const blogId = randomUUID();
      const comment = await target.create({
        content: 'Original Content',
        blogId,
        authorId: 'author-1',
      });

      // Act
      const result = await target.update(comment.id, {
        content: 'Updated Content',
      });

      // Assert
      expect(result).toBeDefined();
      expect(result?.content).toBe('Updated Content');
      expect(result?.blogId).toBe(blogId); // Unchanged
      expect(result?.authorId).toBe('author-1'); // Unchanged
      await helper.assertRecordExists(
        CommentSchema,
        { id: comment.id },
        {
          content: 'Updated Content',
        },
      );
    });

    it('should return null for soft-deleted comment', async () => {
      // Arrange
      const blogId = randomUUID();
      const comment = await target.create({
        content: 'Test Comment',
        blogId,
        authorId: 'author-1',
      });
      await target.softDelete(comment.id);

      // Act
      const result = await target.update(comment.id, { content: 'Updated Content' });

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent comment', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const result = await target.update(nonExistentId, { content: 'Updated Content' });

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('should soft delete comment (set isValid to false)', async () => {
      // Arrange
      const blogId = randomUUID();
      const comment = await target.create({
        content: 'Test Comment',
        blogId,
        authorId: 'author-1',
      });

      // Act
      const result = await target.softDelete(comment.id);

      // Assert
      expect(result).toBe(true);
      await helper.assertSoftDeleted(CommentSchema, comment.id);
    });

    it('should return false for non-existent comment', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const result = await target.softDelete(nonExistentId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when trying to delete already soft-deleted comment', async () => {
      // Arrange
      const blogId = randomUUID();
      const comment = await target.create({
        content: 'Test Comment',
        blogId,
        authorId: 'author-1',
      });
      await target.softDelete(comment.id);

      // Act
      const result = await target.softDelete(comment.id);

      // Assert
      expect(result).toBe(false);
    });
  });
});
