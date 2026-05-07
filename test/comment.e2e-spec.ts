import * as request from 'supertest';
import { E2ETestSetup } from './setup/e2e-setup';
import { PostgresTestHelper } from './helpers/postgres.helper';
import { BlogFactory, CommentFactory } from './factories';
import { CommentSchema } from '../src/shared/postgres/schema/comment.schema';
import { ErrorCode } from '../src/utils/error.code';

describe('Comment E2E Tests', () => {
  let setup: E2ETestSetup;
  let postgresHelper: PostgresTestHelper;
  let blogFactory: BlogFactory;
  let commentFactory: CommentFactory;

  const DOMAIN_EVENT_TOPIC = 'org-test-domain-event';

  jest.setTimeout(30000);

  beforeAll(async () => {
    setup = new E2ETestSetup();
    await setup.init();

    postgresHelper = new PostgresTestHelper(setup.dataSource);
    blogFactory = new BlogFactory(setup.dataSource);
    commentFactory = new CommentFactory(setup.dataSource);

    await setup.subscribeToTopics([DOMAIN_EVENT_TOPIC]);
  }, 90000);

  afterAll(async () => {
    await setup.teardown();
  }, 30000);

  beforeEach(async () => {
    await setup.cleanup();
    BlogFactory.reset();
    CommentFactory.reset();
  });

  describe('POST /comments', () => {
    it('should create comment when blog exists', async () => {
      // Arrange
      const blog = await blogFactory.create();
      const createCommentDto = {
        blogId: blog.id,
        content: 'This is a test comment',
        authorId: 'commenter-123',
      };

      // Act
      const response = await request(setup.httpServer).post('/comments').send(createCommentDto).expect(201);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.blogId).toBe(blog.id);

      await postgresHelper.assertRecordExists(
        CommentSchema,
        { id: response.body.data.id },
        {
          blogId: blog.id,
          content: 'This is a test comment',
          authorId: 'commenter-123',
          isValid: true,
        },
      );

      const event = await setup.waitForMessage(DOMAIN_EVENT_TOPIC, (msg: any) => msg.payload?.commentId === response.body.data.id, 8000);
      expect(event).toBeDefined();
      expect(event.payload.blogId).toBe(blog.id);
    });

    it('should return error when blog does not exist', async () => {
      // Arrange
      await blogFactory.create();
      await blogFactory.create({ isValid: false });

      const createCommentDto = {
        blogId: '00000000-0000-4000-8000-000000000000',
        content: 'Comment for non-existent blog',
        authorId: 'commenter-123',
      };

      // Act
      const response = await request(setup.httpServer).post('/comments').send(createCommentDto).expect(400);

      // Assert
      expect(response.body.code).toBe(ErrorCode.COMMENT_BLOG_NOT_FOUND);
    });
  });

  describe('GET /comments', () => {
    it('should filter comments by blogId', async () => {
      // Arrange
      const blog1 = await blogFactory.create();
      const blog2 = await blogFactory.create();
      await commentFactory.createMany(blog1.id, 3);
      await commentFactory.createMany(blog2.id, 2);

      // Act
      const response = await request(setup.httpServer).get('/comments').query({ blogId: blog1.id }).expect(200);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.items).toHaveLength(3);
      response.body.data.items.forEach((comment: any) => {
        expect(comment.blogId).toBe(blog1.id);
      });
    });
  });

  describe('DELETE /comments/:id', () => {
    it('should soft-delete comment and publish domain event', async () => {
      // Arrange
      const blog = await blogFactory.create();
      const comment = await commentFactory.create(blog.id);

      // Act
      const response = await request(setup.httpServer).delete(`/comments/${comment.id}`).expect(200);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);

      await postgresHelper.assertSoftDeleted(CommentSchema, comment.id);

      const event = await setup.waitForMessage(DOMAIN_EVENT_TOPIC, (msg: any) => msg.payload?.commentId === comment.id, 8000);
      expect(event).toBeDefined();
      expect(event.payload.blogId).toBe(blog.id);
    });
  });
});
