/**
 * Context module E2E (Story 13.5 / AC #14).
 *
 * Boots the full AppModule against `docker-compose.e2e.yml` Postgres. Real
 * cache (no override). Real CommandBus. Vault uses real fs in a temp dir
 * (`process.env.VAULT_PATH`). `dreams` table is real Postgres — scenarios that
 * need a deep dream insert rows directly via the named DataSource.
 */
import { CommandBus } from '@nestjs/cqrs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as request from 'supertest';
import { ErrorCode } from '../src/utils/error.code';
import { InvalidateContextCacheCommand } from '../src/modules/context/commands/invalidate-context-cache.command';
import { E2ETestSetup } from './setup/e2e-setup';

const VAULT_ROOT = process.env['VAULT_PATH'] ?? '/tmp/jarvis-e2e-vault';
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

async function seedFile(relativePath: string, content: string): Promise<void> {
  const abs = path.join(VAULT_ROOT, relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

async function removeFile(relativePath: string): Promise<void> {
  await fs.rm(path.join(VAULT_ROOT, relativePath), { force: true });
}

const MEMORY_LINES = Array.from({ length: 250 }, (_, i) => `memory-line-${i + 1}`);

describe('Context E2E Tests', () => {
  let setup: E2ETestSetup;
  let commandBus: CommandBus;

  jest.setTimeout(60_000);

  beforeAll(async () => {
    await fs.mkdir(VAULT_ROOT, { recursive: true });
    await seedFile('SOUL.md', '# SOUL');
    await seedFile('IDENTITY.md', '# IDENTITY');
    await seedFile('MEMORY.md', MEMORY_LINES.join('\n'));
    await seedFile(`dailys/${TODAY}.md`, '# TODAY-DAILY');
    await seedFile(`dailys/${YESTERDAY}.md`, '# YESTERDAY-DAILY');
    await seedFile('decisions/_index.md', '# DECISIONS');
    await seedFile('projects/_index.md', '# PROJECTS');
    await seedFile('patterns/_index.md', '# PATTERNS');
    await seedFile('templates/_index.md', '# TEMPLATES');

    setup = new E2ETestSetup();
    await setup.init();
    commandBus = setup.app.get(CommandBus);
  }, 90_000);

  afterAll(async () => {
    await setup.teardown();
    await fs.rm(VAULT_ROOT, { recursive: true, force: true });
  }, 30_000);

  beforeEach(async () => {
    await setup.cleanup();
    // Clear cache between scenarios so each starts cold.
    await commandBus.execute(new InvalidateContextCacheCommand({ reason: 'manual', timestamp: new Date() }));
  });

  describe('GET /memory/context', () => {
    it('cache miss on first request — returns 200 with all 9 vault sections + MEMORY TOOLS in fixed order', async () => {
      // Act
      const response = await request(setup.httpServer).get('/memory/context');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.code).toBe(ErrorCode.SUCCESS);
      expect(response.body.data.cached).toBe(false);
      expect(typeof response.body.data.assembled_at).toBe('string');
      expect(response.body.data.assembled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/);

      const ctx: string = response.body.data.context;
      const sections = [
        '## SOUL',
        '## IDENTITY',
        '## MEMORY',
        `## TODAY (${TODAY})`,
        `## YESTERDAY (${YESTERDAY})`,
        '## DECISIONS INDEX',
        '## PROJECTS INDEX',
        '## PATTERNS INDEX',
        '## TEMPLATES INDEX',
        '## MEMORY TOOLS',
      ];
      let cursor = -1;
      for (const header of sections) {
        const idx = ctx.indexOf(header, cursor + 1);
        expect(idx).toBeGreaterThan(cursor);
        cursor = idx;
      }
      expect(ctx).not.toContain('## VAULT HEALTH');
    });

    it('cache hit on second request — returns cached:true with byte-identical context and faster latency', async () => {
      // Arrange — warm the cache.
      const first = await request(setup.httpServer).get('/memory/context');
      expect(first.status).toBe(200);
      expect(first.body.data.cached).toBe(false);

      // Act — second call.
      const start = Date.now();
      const second = await request(setup.httpServer).get('/memory/context');
      const elapsedMs = Date.now() - start;

      // Assert
      expect(second.status).toBe(200);
      expect(second.body.data.cached).toBe(true);
      expect(second.body.data.context).toBe(first.body.data.context);
      // Server-side cache hit is well under 100 ms; total RTT here includes
      // supertest framework + HTTP loopback. 500 ms is a generous ceiling.
      expect(elapsedMs).toBeLessThan(500);
    });

    it('cache invalidation — InvalidateContextCacheCommand clears cache; next request rebuilds', async () => {
      // Arrange — warm the cache.
      const warm = await request(setup.httpServer).get('/memory/context');
      expect(warm.body.data.cached).toBe(false);
      const verifyHit = await request(setup.httpServer).get('/memory/context');
      expect(verifyHit.body.data.cached).toBe(true);

      // Act — dispatch the invalidation command.
      await commandBus.execute(new InvalidateContextCacheCommand({ reason: 'manual', timestamp: new Date() }));
      const afterInvalidation = await request(setup.httpServer).get('/memory/context');

      // Assert
      expect(afterInvalidation.body.data.cached).toBe(false);
    });

    it('missing daily file — section silently skipped, response still 200', async () => {
      // Arrange — yesterday's daily missing.
      await removeFile(`dailys/${YESTERDAY}.md`);

      // Act
      const response = await request(setup.httpServer).get('/memory/context');

      // Assert
      expect(response.status).toBe(200);
      const ctx: string = response.body.data.context;
      expect(ctx).not.toContain(`## YESTERDAY (${YESTERDAY})`);
      expect(ctx).toContain(`## TODAY (${TODAY})`);

      // Restore so subsequent tests don't depend on order.
      await seedFile(`dailys/${YESTERDAY}.md`, '# YESTERDAY-DAILY');
    });

    it('MEMORY.md 200-line cap — rendered MEMORY section truncated to first 200 lines', async () => {
      // Arrange — vault already seeded with 250-line MEMORY.md.

      // Act
      const response = await request(setup.httpServer).get('/memory/context');

      // Assert
      const ctx: string = response.body.data.context;
      const memHeader = '## MEMORY\n\n';
      const headerIdx = ctx.indexOf(memHeader);
      expect(headerIdx).toBeGreaterThan(-1);
      const todayHeader = `## TODAY (${TODAY})`;
      const todayIdx = ctx.indexOf(todayHeader);
      const memorySection = ctx.slice(headerIdx + memHeader.length, todayIdx).replace(/\n+$/, '');
      const memoryLines = memorySection.split('\n');
      expect(memoryLines).toHaveLength(200);
      expect(memoryLines[0]).toBe('memory-line-1');
      expect(memoryLines[199]).toBe('memory-line-200');
    });

    it('health summary appears when latest completed deep dream has issues', async () => {
      // Arrange
      await setup.dataSource.query(
        `INSERT INTO jarvis.dreams (type, trigger, status, output_raw, completed_at, created_at) VALUES ('deep', 'cron', 'completed', $1, NOW(), NOW())`,
        [
          'health_report={"orphan_notes":["a","b"],"stale_notes":[],"unresolved_contradictions":[],"missing_frontmatter":[],"memory_overflow":false,"knowledge_gaps":[]}',
        ],
      );

      // Act
      const response = await request(setup.httpServer).get('/memory/context');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.context).toContain('## VAULT HEALTH\n\n⚠ Vault health: 2 orphan notes');
    });

    it('health summary skipped when health report has no issues', async () => {
      // Arrange — empty issue arrays.
      await setup.dataSource.query(
        `INSERT INTO jarvis.dreams (type, trigger, status, output_raw, completed_at, created_at) VALUES ('deep', 'cron', 'completed', $1, NOW(), NOW())`,
        [
          'health_report={"orphan_notes":[],"stale_notes":[],"unresolved_contradictions":[],"missing_frontmatter":[],"memory_overflow":false,"knowledge_gaps":[]}',
        ],
      );

      // Act
      const response = await request(setup.httpServer).get('/memory/context');

      // Assert
      expect(response.body.data.context).not.toContain('## VAULT HEALTH');
    });
  });
});
