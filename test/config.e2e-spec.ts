/**
 * Config endpoint E2E spec (Story 13.13 / test-design-epic-13 P2 gap).
 *
 * Covers GET /config and PATCH /config against the real NestJS app + Postgres.
 * config.yml is written to VAULT_PATH (=/tmp/jarvis-e2e-vault in .env.e2e).
 *
 * Scenarios:
 *   (a) GET /config — returns all four fields with defaults
 *   (b) PATCH /config — update autoMerge → 200 + new value persisted
 *   (c) PATCH /config — update deepDreamCron → 200 + new cron stored
 *   (d) PATCH /config — invalid cron string → 400
 *   (e) PATCH /config — maxMemoryLines out of range → 400
 *   (f) GET /config — weeklyReviewCron included (Python bug fix from Story 13.13)
 */
import * as request from 'supertest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { E2ETestSetup } from './setup/e2e-setup';

const VAULT_PATH = process.env['VAULT_PATH'] ?? '/tmp/jarvis-e2e-vault';
const CONFIG_YML = path.join(VAULT_PATH, 'config.yml');

/** Seed a minimal config.yml so the use case can read it. */
async function seedConfigYml(overrides: Record<string, unknown> = {}): Promise<void> {
  await fs.mkdir(VAULT_PATH, { recursive: true });
  const defaults = {
    auto_merge: true,
    deep_dream_cron: '0 20 * * *',
    weekly_review_cron: '0 20 * * 0',
    max_memory_lines: 200,
    ...overrides,
  };
  const yaml = Object.entries(defaults)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
  await fs.writeFile(CONFIG_YML, yaml + '\n', 'utf-8');
}

describe('Config endpoints E2E (GET /config, PATCH /config)', () => {
  let setup: E2ETestSetup;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    setup = new E2ETestSetup();
    await setup.init();
  }, 90_000);

  afterAll(async () => {
    await setup.teardown();
  }, 30_000);

  beforeEach(async () => {
    await setup.cleanup();
    await seedConfigYml();
  });

  // ─── (a) GET /config — happy path ─────────────────────────────────────────

  describe('GET /config', () => {
    it('(a) returns all four config fields with defaults', async () => {
      const res = await request(setup.httpServer).get('/config');

      expect(res.status).toBe(200);
      expect(res.body.data ?? res.body).toMatchObject({
        autoMerge: true,
        deepDreamCron: '0 20 * * *',
        weeklyReviewCron: '0 20 * * 0',
        maxMemoryLines: 200,
      });
    });

    it('(f) weeklyReviewCron is included (Python bug fix — Story 13.13)', async () => {
      await seedConfigYml({ weekly_review_cron: '30 21 * * 0' });
      const res = await request(setup.httpServer).get('/config');

      expect(res.status).toBe(200);
      const body = res.body.data ?? res.body;
      expect(body).toHaveProperty('weeklyReviewCron');
      expect(body.weeklyReviewCron).toBe('30 21 * * 0');
    });
  });

  // ─── (b) PATCH /config — update autoMerge ─────────────────────────────────

  describe('PATCH /config', () => {
    it('(b) updates autoMerge and returns updated config', async () => {
      const res = await request(setup.httpServer).patch('/config').send({ autoMerge: false });

      expect(res.status).toBe(200);
      const body = res.body.data ?? res.body;
      expect(body.autoMerge).toBe(false);

      // Verify persisted — GET /config should return new value
      const getRes = await request(setup.httpServer).get('/config');
      expect((getRes.body.data ?? getRes.body).autoMerge).toBe(false);
    });

    it('(c) updates deepDreamCron and returns updated config', async () => {
      const res = await request(setup.httpServer).patch('/config').send({ deepDreamCron: '0 22 * * *' });

      expect(res.status).toBe(200);
      const body = res.body.data ?? res.body;
      expect(body.deepDreamCron).toBe('0 22 * * *');
    });

    it('(d) rejects invalid cron string with 400', async () => {
      const res = await request(setup.httpServer).patch('/config').send({ deepDreamCron: 'not-a-cron' });

      expect(res.status).toBe(400);
    });

    it('(e) rejects maxMemoryLines below minimum (50) with 400', async () => {
      const res = await request(setup.httpServer).patch('/config').send({ maxMemoryLines: 10 });

      expect(res.status).toBe(400);
    });

    it('(e) rejects maxMemoryLines above maximum (500) with 400', async () => {
      const res = await request(setup.httpServer).patch('/config').send({ maxMemoryLines: 999 });

      expect(res.status).toBe(400);
    });
  });
});
