import * as request from 'supertest';
import { E2ETestSetup } from './setup/e2e-setup';
import { ErrorCode } from '../src/utils/error.code';

describe('AuditLog E2E Tests', () => {
  let setup: E2ETestSetup;

  const DOMAIN_EVENT_TOPIC = 'org-test-domain-event';

  jest.setTimeout(30000);

  beforeAll(async () => {
    setup = new E2ETestSetup();
    await setup.init();
  }, 90000);

  afterAll(async () => {
    await setup.teardown();
  }, 30000);

  beforeEach(async () => {
    await setup.cleanup();
  });

  describe('GET /audit-logs', () => {
    it('should return audit logs endpoint responds correctly', async () => {
      // Arrange - No specific setup needed

      // Act
      const response = await request(setup.httpServer).get('/audit-logs').query({ page: 1, limit: 10 }).expect(200);

      // Assert
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data).toHaveProperty('items');
      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('page');
      expect(response.body.data).toHaveProperty('limit');
    });
  });

  describe('Kafka Consumer - Domain Event Processing', () => {
    it('should receive domain events via Kafka', async () => {
      // Arrange
      const testEvent = {
        id: 'test-event-123',
        code: 'ORG01001',
        timestamp: new Date().toISOString(),
        payload: {
          blogId: 'injected-blog-id',
          title: 'Injected Test Blog',
          authorId: 'test-author',
        },
        source: { system: 'test', service: 'e2e-test' },
      };

      // Act
      await setup.publishTestEvent(DOMAIN_EVENT_TOPIC, testEvent);
      await new Promise((r) => setTimeout(r, 2000));

      // Assert
      expect(testEvent.code).toBe('ORG01001');
    });
  });

  describe('Full Flow: Blog → Kafka → Events', () => {
    it('should publish events for blog create/update/delete cycle', async () => {
      // Arrange
      await setup.subscribeToTopic(DOMAIN_EVENT_TOPIC);

      // Act - Create blog
      const createResponse = await request(setup.httpServer)
        .post('/blogs')
        .send({
          title: 'Full Flow Blog',
          content: 'Testing full flow',
          authorId: 'author-flow',
        })
        .expect(201);

      const blogId = createResponse.body.data.id;

      // Assert - Verify create event
      const createEvent = await setup.waitForMessage(
        DOMAIN_EVENT_TOPIC,
        (msg: any) => msg.payload?.blogId === blogId && msg.payload?.title === 'Full Flow Blog',
        5000,
      );
      expect(createEvent).toBeDefined();

      // Act - Update blog
      await request(setup.httpServer).put(`/blogs/${blogId}`).send({ title: 'Updated Flow Blog', content: 'Updated content' }).expect(200);

      // Assert - Verify update event
      const updateEvent = await setup.waitForMessage(
        DOMAIN_EVENT_TOPIC,
        (msg: any) => msg.payload?.blogId === blogId && msg.payload?.title === 'Updated Flow Blog',
        5000,
      );
      expect(updateEvent).toBeDefined();

      // Act - Delete blog
      await request(setup.httpServer).delete(`/blogs/${blogId}`).expect(200);

      // Assert - Verify delete event
      const deleteEvent = await setup.waitForMessage(DOMAIN_EVENT_TOPIC, (msg: any) => msg.payload?.blogId === blogId && msg.id === blogId, 5000);
      expect(deleteEvent).toBeDefined();
    });
  });
});
