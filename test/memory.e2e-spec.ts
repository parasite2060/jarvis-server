/**
 * Memory module E2E (Story 13.4 / AC #14).
 *
 * Boots the full AppModule against `docker-compose.e2e.yml` Postgres. The vault
 * uses real filesystem under `process.env.VAULT_PATH` (set in `.env.e2e` to
 * `/tmp/jarvis-e2e-vault`); SOUL.md / IDENTITY.md / MEMORY.md are seeded in
 * `beforeAll` and cleaned up in `afterAll`. Covers the vault-file read routes
 * and asserts the removed MemU routes now 404.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as request from 'supertest';
import { E2ETestSetup } from './setup/e2e-setup';
import { ErrorCode } from '../src/utils/error.code';

describe('Memory E2E Tests', () => {
  let setup: E2ETestSetup;
  let vaultRoot: string;

  jest.setTimeout(30000);

  beforeAll(async () => {
    vaultRoot = process.env['VAULT_PATH'] ?? '/tmp/jarvis-e2e-vault';
    await fs.mkdir(vaultRoot, { recursive: true });
    await fs.writeFile(path.join(vaultRoot, 'SOUL.md'), '# SOUL', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'IDENTITY.md'), '# IDENTITY', 'utf-8');
    await fs.writeFile(path.join(vaultRoot, 'MEMORY.md'), '# MEMORY', 'utf-8');

    setup = new E2ETestSetup();
    await setup.init();
  }, 90000);

  afterAll(async () => {
    await setup.teardown();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }, 30000);

  beforeEach(async () => {
    await setup.cleanup();
  });

  describe('removed MemU routes', () => {
    it('POST /memory/search returns 404 (MemU removed)', async () => {
      await request(setup.httpServer).post('/memory/search').send({ query: 'x' }).expect(404);
    });

    it('POST /memory/add returns 404 (MemU removed)', async () => {
      await request(setup.httpServer).post('/memory/add').send({ content: 'x' }).expect(404);
    });
  });

  describe('GET /memory/soul', () => {
    it('happy path — returns SOUL.md content with snake_case file_path', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/soul');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.content).toBe('# SOUL');
      expect(response.body.data.file_path).toBe('SOUL.md');
    });

    it('missing file — HTTP 404 with VAULT_FILE_NOT_FOUND code', async () => {
      // Arrange
      const soulPath = path.join(vaultRoot, 'SOUL.md');
      await fs.unlink(soulPath);

      // Act
      const response = await request(setup.httpServer).get('/memory/soul');

      // Assert
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.VAULT_FILE_NOT_FOUND);
      expect(response.body.data).toBeNull();

      // Restore for subsequent tests
      await fs.writeFile(soulPath, '# SOUL', 'utf-8');
    });
  });

  describe('GET /memory/identity', () => {
    it('happy path — returns IDENTITY.md content with snake_case file_path', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/identity');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.content).toBe('# IDENTITY');
      expect(response.body.data.file_path).toBe('IDENTITY.md');
    });
  });

  describe('GET /memory/memory (Q3 / Amendment 2)', () => {
    it('happy path — returns MEMORY.md content with snake_case file_path', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/memory');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.content).toBe('# MEMORY');
      expect(response.body.data.file_path).toBe('MEMORY.md');
    });

    it('missing file — HTTP 404 with VAULT_FILE_NOT_FOUND code', async () => {
      // Arrange
      const memoryPath = path.join(vaultRoot, 'MEMORY.md');
      await fs.unlink(memoryPath);

      // Act
      const response = await request(setup.httpServer).get('/memory/memory');

      // Assert
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.VAULT_FILE_NOT_FOUND);

      // Restore
      await fs.writeFile(memoryPath, '# MEMORY', 'utf-8');
    });
  });
});
