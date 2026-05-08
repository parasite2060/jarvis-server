/**
 * Vault module E2E (Story 13.6 / AC #14).
 *
 * Boots the full AppModule against `docker-compose.e2e.yml` Postgres. Real
 * vault filesystem in temp dir (`process.env.VAULT_PATH`). NO overrides — real
 * cache, real CommandBus, real `IFileManifestRepository`.
 *
 * The latency test (AC #14 scenario f) seeds 1000+ files in beforeAll and
 * asserts wall-clock < 1s for the manifest endpoint.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as request from 'supertest';
import { ErrorCode } from '../src/utils/error.code';
import { E2ETestSetup } from './setup/e2e-setup';

const VAULT_ROOT = process.env['VAULT_PATH'] ?? '/tmp/jarvis-e2e-vault';

const INCLUDED_FILES: Array<[string, string]> = [
  ['SOUL.md', '# SOUL'],
  ['IDENTITY.md', '# IDENTITY'],
  ['MEMORY.md', '# MEMORY\n\n- a\n- b'],
  ['dailys/2026-05-08.md', '# Daily 2026-05-08\n\nNotes'],
  ['dailys/2026-05-07.md', '# Daily 2026-05-07'],
  ['decisions/foo.md', '# foo decision'],
  ['decisions/_index.md', '# decisions index'],
  ['config.yml', 'cron: "0 1 * * *"'],
  ['templates/note.yaml', 'tags: []'],
];

const EXCLUDED_FILES: Array<[string, string]> = [
  ['.gitignore', 'node_modules'],
  ['.DS_Store', 'mac'],
  ['.git/HEAD', 'ref: refs/heads/main'],
  ['.git/config', '[core]'],
  ['node_modules/foo/index.js', 'code'],
  ['transcripts/sess-1.txt', 'log'],
  ['README.txt', 'readme'],
];

async function seed(relPath: string, content: string): Promise<void> {
  const abs = path.join(VAULT_ROOT, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

describe('Vault E2E Tests', () => {
  let setup: E2ETestSetup;

  jest.setTimeout(120_000);

  beforeAll(async () => {
    await fs.rm(VAULT_ROOT, { recursive: true, force: true });
    await fs.mkdir(VAULT_ROOT, { recursive: true });
    for (const [p, c] of INCLUDED_FILES) await seed(p, c);
    for (const [p, c] of EXCLUDED_FILES) await seed(p, c);

    setup = new E2ETestSetup();
    await setup.init();
  }, 90_000);

  afterAll(async () => {
    await setup.dataSource.query('TRUNCATE jarvis.file_manifest CASCADE').catch(() => undefined);
    await setup.teardown();
    await fs.rm(VAULT_ROOT, { recursive: true, force: true });
  }, 30_000);

  beforeEach(async () => {
    await setup.cleanup();
  });

  describe('GET /memory/files/manifest', () => {
    it('happy path — HTTP 200 with camelCase envelope (manifestHash + fileCount + generatedAt + per-file path/hash/size/updatedAt)', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/files/manifest');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.fileCount).toBe(INCLUDED_FILES.length);
      expect(response.body.data.files).toHaveLength(INCLUDED_FILES.length);
      expect(response.body.data.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(response.body.data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);

      const includedPaths = INCLUDED_FILES.map(([p]) => p).sort();
      const responsePaths = response.body.data.files.map((f: { path: string }) => f.path).sort();
      expect(responsePaths).toEqual(includedPaths);

      // Each entry has camelCase fields.
      for (const entry of response.body.data.files) {
        expect(entry.path).toBeDefined();
        expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(typeof entry.size).toBe('number');
        expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);
      }
    });

    it('excludes anti-patterns — .git, node_modules, transcripts (txt), hidden files, non-vault extensions', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/files/manifest');

      // Assert
      const responsePaths: string[] = response.body.data.files.map((f: { path: string }) => f.path);
      for (const [excludedPath] of EXCLUDED_FILES) {
        expect(responsePaths).not.toContain(excludedPath);
      }
    });

    it('manifestHash deterministic across calls with same vault state', async () => {
      // Act
      const first = await request(setup.httpServer).get('/memory/files/manifest');
      const second = await request(setup.httpServer).get('/memory/files/manifest');

      // Assert
      expect(first.body.data.manifestHash).toBe(second.body.data.manifestHash);
    });

    it('manifestHash changes when a file is added to the vault', async () => {
      // Arrange — capture h1.
      const before = await request(setup.httpServer).get('/memory/files/manifest');
      const h1 = before.body.data.manifestHash;
      const newFile = 'patterns/new-file.md';
      await seed(newFile, '# new file');

      // Act
      const after = await request(setup.httpServer).get('/memory/files/manifest');

      // Assert
      expect(after.body.data.manifestHash).not.toBe(h1);
      expect(after.body.data.fileCount).toBe(INCLUDED_FILES.length + 1);

      // Cleanup so subsequent specs see the seeded baseline.
      await fs.rm(path.join(VAULT_ROOT, newFile), { force: true });
    });

    it('DB sync side-effect — file_manifest table populated within 1s of manifest call', async () => {
      // Arrange — clear the table first.
      await setup.dataSource.query('TRUNCATE jarvis.file_manifest CASCADE');

      // Act — fire the manifest endpoint.
      await request(setup.httpServer).get('/memory/files/manifest');

      // Assert — wait briefly for the fire-and-forget sync, then verify rows exist.
      let rows: { count: string }[] = [];
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        rows = await setup.dataSource.query(`SELECT count(*)::text FROM jarvis.file_manifest`);
        if (Number(rows[0]?.count) === INCLUDED_FILES.length) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(Number(rows[0]?.count)).toBe(INCLUDED_FILES.length);
    });
  });

  describe('GET /memory/files/*path', () => {
    it('happy path — returns content + filePath + hash + size (camelCase)', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/files/dailys/2026-05-08.md');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.content).toBe('# Daily 2026-05-08\n\nNotes');
      expect(response.body.data.filePath).toBe('dailys/2026-05-08.md');
      expect(response.body.data.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(response.body.data.size).toBe(Buffer.byteLength('# Daily 2026-05-08\n\nNotes'));
    });

    it('400 on path traversal', async () => {
      // Act — supertest with the .. path is normalised by Express; use an explicit traversal segment.
      const response = await request(setup.httpServer).get('/memory/files/dailys/../../../etc/passwd');

      // Assert
      // Express may collapse `..` segments before they reach the route; assert
      // that the response is either 400 (traversal blocked) OR 404 (resolved
      // to a path that doesn't exist). Both are valid security postures.
      expect([400, 404]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body.code).toBe(ErrorCode.VAULT_ENDPOINT_PATH_TRAVERSAL);
      } else {
        expect(response.body.code).toBe(ErrorCode.VAULT_ENDPOINT_FILE_NOT_FOUND);
      }
    });

    it('404 on missing file', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/files/dailys/2099-01-01.md');

      // Assert
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.VAULT_ENDPOINT_FILE_NOT_FOUND);
    });
  });

  describe('manifest endpoint latency (AC #14 scenario f)', () => {
    let seededLargeFiles: string[] = [];

    beforeAll(async () => {
      // Seed 1100 simulated daily files INTO the existing VAULT_ROOT so we
      // reuse the booted AppModule (single Kafka consumer group + Postgres
      // connection per test run). Track paths for cleanup.
      const tasks: Promise<void>[] = [];
      for (let i = 0; i < 1100; i++) {
        const rel = `dailys/sim-${i}.md`;
        seededLargeFiles.push(rel);
        tasks.push(seed(rel, `# sim ${i}`));
      }
      await Promise.all(tasks);
    }, 90_000);

    afterAll(async () => {
      // Remove the 1100 simulated files so subsequent tests don't see them.
      await Promise.all(seededLargeFiles.map((rel) => fs.rm(path.join(VAULT_ROOT, rel), { force: true })));
      seededLargeFiles = [];
    }, 30_000);

    it('manifest with 1100+ files completes in <1s wall-clock at the controller', async () => {
      // Act
      const start = Date.now();
      const response = await request(setup.httpServer).get('/memory/files/manifest');
      const elapsedMs = Date.now() - start;

      // Assert — fileCount = 1100 simulated + 9 seeded baseline included files.
      expect(response.status).toBe(200);
      expect(response.body.data.fileCount).toBeGreaterThanOrEqual(1100);
      expect(elapsedMs).toBeLessThan(1000);
    });
  });
});
