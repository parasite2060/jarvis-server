/**
 * Payload-limit E2E — oversize bodies must return 413 (not 500), and
 * under-limit bodies must pass the body parser. Uses a small MAX_BODY_SIZE
 * so the test stays fast. Verifies the body-parser configurator (shared
 * between main.ts and the e2e harness) is wired correctly.
 */
import request from 'supertest';
import { E2ETestSetup } from './setup/e2e-setup';

describe('Payload limit E2E', () => {
  let setup: E2ETestSetup;

  jest.setTimeout(120_000);

  beforeAll(async () => {
    // 1mb cap for the test — set BEFORE the app boots so the parser picks it up.
    process.env['MAX_BODY_SIZE'] = '1mb';
    setup = new E2ETestSetup();
    await setup.init();
  }, 90_000);

  afterAll(async () => {
    delete process.env['MAX_BODY_SIZE'];
    await setup.teardown();
  });

  it('returns 413 (not 500) for a body over the limit', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024); // ~2mb > 1mb cap
    const res = await request(setup.httpServer)
      .post('/conversations')
      .set('Content-Type', 'application/json')
      .send({ sessionId: 'payload-e2e', source: 'stop', transcript: huge });

    expect(res.status).toBe(413);
  });

  it('does not 413 a body under the limit (parser accepts it)', async () => {
    const small = 'y'.repeat(10 * 1024); // 10kb << 1mb
    const res = await request(setup.httpServer)
      .post('/conversations')
      .set('Content-Type', 'application/json')
      .send({ sessionId: 'payload-e2e-small', source: 'stop', transcript: small });

    // A small body must clear the payload-limit layer and reach the app: the
    // body parser accepts it, then the global ApiKeyGuard rejects the unauthenticated
    // request with 401. The point is it is NOT a 413 (payload rejection) and NOT a 5xx.
    expect([200, 201, 202, 400, 401, 422]).toContain(res.status);
    expect(res.status).not.toBe(413);
    expect(res.status).toBeLessThan(500);
  });
});
