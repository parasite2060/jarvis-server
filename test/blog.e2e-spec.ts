import * as request from 'supertest';
import { E2ETestSetup } from './setup/e2e-setup';
import { PostgresTestHelper } from './helpers/postgres.helper';
import { BlogFactory } from './factories/blog.factory';
import { BlogSchema } from '../src/shared/postgres/schema/blog.schema';
import { ErrorCode } from '../src/utils/error.code';

describe('Blog E2E Tests', () => {
  let setup: E2ETestSetup;
  let postgresHelper: PostgresTestHelper;
  let blogFactory: BlogFactory;

  const DOMAIN_EVENT_TOPIC = 'org-test-domain-event';

  jest.setTimeout(30000);

  beforeAll(async () => {
    setup = new E2ETestSetup();
    await setup.init();

    postgresHelper = new PostgresTestHelper(setup.dataSource);
    blogFactory = new BlogFactory(setup.dataSource);

    await setup.subscribeToTopics([DOMAIN_EVENT_TOPIC]);
  }, 90000);

  afterAll(async () => {
    await setup.teardown();
  }, 30000);

  beforeEach(async () => {
    await setup.cleanup();
    BlogFactory.reset();
  });

  describe('POST /blogs', () => {
    it('should create blog and publish domain event', async () => {
      // Arrange
      const createBlogDto = {
        title: 'Test Blog Title',
        content: 'Test blog content for E2E testing',
        authorId: 'author-123',
      };

      // Act
      const response = await request(setup.httpServer).post('/blogs').send(createBlogDto).expect(201);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data).toMatchObject({
        title: 'Test Blog Title',
      });
      expect(response.body.data.id).toBeDefined();

      const blogId = response.body.data.id;

      await postgresHelper.assertRecordExists(
        BlogSchema,
        { id: blogId },
        {
          title: 'Test Blog Title',
          content: 'Test blog content for E2E testing',
          authorId: 'author-123',
          isValid: true,
        },
      );

      const event = await setup.waitForMessage(DOMAIN_EVENT_TOPIC, (msg: any) => msg.payload?.blogId === blogId, 8000);
      expect(event).toBeDefined();
      expect(event.payload.title).toBe('Test Blog Title');
    });

    it('should return validation error for missing title', async () => {
      // Arrange
      const invalidDto = {
        content: 'Some content',
        authorId: 'author-123',
      };

      // Act
      const response = await request(setup.httpServer).post('/blogs').send(invalidDto).expect(400);

      // Assert
      expect(response.body.code).toBe(ErrorCode.BLOG_TITLE_INVALID);
      expect(response.body.message).toContain('title');
    });
  });

  describe('GET /blogs/:id', () => {
    it('should return blog by ID', async () => {
      // Arrange
      const blog = await blogFactory.create({
        title: 'Specific Blog',
        content: 'Specific content',
        authorId: 'author-456',
      });

      // Act
      const response = await request(setup.httpServer).get(`/blogs/${blog.id}`).expect(200);

      // Assert
      expect(response.body).toEqual({
        code: ErrorCode.SUCCESS,
        message: 'Success',
        data: {
          id: blog.id,
          title: 'Specific Blog',
          content: 'Specific content',
          authorId: 'author-456',
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });
    });

    it('should return 400 when blog not found', async () => {
      // Arrange
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      // Act
      const response = await request(setup.httpServer).get(`/blogs/${nonExistentId}`).expect(400);

      // Assert
      expect(response.body.code).toBe(ErrorCode.BLOG_NOT_FOUND);
    });
  });

  describe('GET /blogs', () => {
    it('should return paginated blogs', async () => {
      // Arrange
      await blogFactory.createMany(25);

      // Act
      const response = await request(setup.httpServer).get('/blogs').query({ page: 1, limit: 10 }).expect(200);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.items).toHaveLength(10);
      expect(response.body.data.total).toBe(25);
      expect(response.body.data.page).toBe(1);
      expect(response.body.data.limit).toBe(10);
    });

    it('should return second page', async () => {
      // Arrange
      await blogFactory.createMany(25);

      // Act
      const response = await request(setup.httpServer).get('/blogs').query({ page: 2, limit: 10 }).expect(200);

      // Assert
      expect(response.body.data.items).toHaveLength(10);
      expect(response.body.data.page).toBe(2);
    });
  });

  describe('PUT /blogs/:id', () => {
    it('should update blog and publish domain event', async () => {
      // Arrange
      const blog = await blogFactory.create();
      const updateDto = {
        title: 'Updated Title',
        content: 'Updated content',
      };

      // Act
      const response = await request(setup.httpServer).put(`/blogs/${blog.id}`).send(updateDto).expect(200);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.title).toBe('Updated Title');

      await postgresHelper.assertRecordExists(
        BlogSchema,
        { id: blog.id },
        {
          title: 'Updated Title',
          content: 'Updated content',
        },
      );

      const event = await setup.waitForMessage(DOMAIN_EVENT_TOPIC, (msg: any) => msg.payload?.blogId === blog.id, 8000);
      expect(event).toBeDefined();
    });
  });

  describe('DELETE /blogs/:id', () => {
    it('should soft-delete blog and publish domain event', async () => {
      // Arrange
      const blog = await blogFactory.create();

      // Act
      const response = await request(setup.httpServer).delete(`/blogs/${blog.id}`).expect(200);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);

      await postgresHelper.assertSoftDeleted(BlogSchema, blog.id);

      const event = await setup.waitForMessage(DOMAIN_EVENT_TOPIC, (msg: any) => msg.payload?.blogId === blog.id, 8000);
      expect(event).toBeDefined();
    });

    it('should return 400 for already deleted blog', async () => {
      // Arrange
      const blog = await blogFactory.create({ isValid: false });

      // Act
      const response = await request(setup.httpServer).delete(`/blogs/${blog.id}`).expect(400);

      // Assert
      expect(response.body.code).toBe(ErrorCode.BLOG_NOT_FOUND);
    });
  });
});
