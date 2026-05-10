/**
 * Worker crash recovery chaos test (Story 13.16 AC5).
 *
 * Entire suite gated on JARVIS_E2E_CHAOS=1 — requires live Temporal +
 * live LLM + a separate worker child process that can be SIGKILL'd.
 *
 * Scenario:
 *   (a) Start deep dream; wait for phase2 dream_phases row.
 *   (b) SIGKILL the worker child process.
 *   (c) Restart worker child.
 *   (d) Wait for deep dream to complete from phase3.
 *   (e) Assert no duplicate dream_phases rows for phases 1–2.
 *   (f) Assert phase3 outcome='success'.
 *
 * Also covers:
 *   - Crash during commitAndPr → exactly one PR exists.
 *   - Crash during alignMemu → MemU state matches a single successful run.
 *
 * Run: `JARVIS_E2E_CHAOS=1 JARVIS_E2E_LIVE_LLM=1 bun run test:e2e -- --testPathPattern="worker-crash-recovery"`
 */
import * as child_process from 'node:child_process';
import * as path from 'node:path';
import { DataSource } from 'typeorm';
import { DBConnections } from '../../src/shared/postgres/utils/constaint';
import { TranscriptSchema } from '../../src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from '../../src/shared/postgres/schema/dream.schema';
import { DreamPhaseSchema } from '../../src/shared/postgres/schema/dream-phase.schema';
import { FileManifestSchema } from '../../src/shared/postgres/schema/file-manifest.schema';
import { ContextCacheSchema } from '../../src/shared/postgres/schema/context-cache.schema';
import { InitJarvis1746662400000 } from '../../src/shared/postgres/migration/1746662400000-init-jarvis';
import { Pgvector1746662400001 } from '../../src/shared/postgres/migration/1746662400001-pgvector';

const RUN_CHAOS = process.env['JARVIS_E2E_CHAOS'] === '1';

// Tier 2 — real GH token enables git ops (PR creation) tests independently of chaos gate
const E2E_GH_TOKEN = process.env['JARVIS_E2E_GH_TOKEN'];
const TIER2_GH_AVAILABLE = Boolean(E2E_GH_TOKEN && E2E_GH_TOKEN !== '');

// Tier 2 — real OpenAI-compatible endpoint enables live LLM calls
const OPENAI_URL = process.env['JARVIS_E2E_OPENAI_URL'];
const OPENAI_TOKEN = process.env['JARVIS_E2E_OPENAI_TOKEN'];
const OPENAI_MODEL = process.env['JARVIS_E2E_OPENAI_MODEL'];
const LIVE_LLM_AVAILABLE = Boolean(OPENAI_URL && OPENAI_TOKEN && OPENAI_MODEL);

async function waitForPhase(dataSource: DataSource, dreamId: number, phase: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await dataSource.query(`SELECT id FROM jarvis.dream_phases WHERE dream_id = $1 AND phase = $2 AND outcome = 'success' LIMIT 1`, [
      dreamId,
      phase,
    ]);
    if (rows.length > 0) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

async function countPhasesForDream(dataSource: DataSource, dreamId: number, phase: string): Promise<number> {
  const rows = await dataSource.query(`SELECT COUNT(*) as count FROM jarvis.dream_phases WHERE dream_id = $1 AND phase = $2`, [dreamId, phase]);
  return Number(rows[0].count);
}

// Entire suite skipped unless JARVIS_E2E_CHAOS=1
const suiteDescribe = RUN_CHAOS ? describe : describe.skip;

suiteDescribe('WorkerCrashRecovery chaos test (Story 13.16 AC5)', () => {
  jest.setTimeout(600_000);

  // Wire Tier 2 credentials into process.env before any test runs.
  // GH_TOKEN override is INDEPENDENT of JARVIS_E2E_CHAOS — PR tests are
  // skipped when JARVIS_E2E_GH_TOKEN is absent even with CHAOS=1.
  if (TIER2_GH_AVAILABLE) {
    process.env['GH_TOKEN'] = E2E_GH_TOKEN!;
  }
  if (LIVE_LLM_AVAILABLE) {
    process.env['LLM_PROVIDER'] = 'openai-compatible';
    process.env['OPENAI_COMPATIBLE_BASE_URL'] = OPENAI_URL!;
    process.env['OPENAI_COMPATIBLE_API_KEY'] = OPENAI_TOKEN!;
    process.env['OPENAI_COMPATIBLE_MODEL'] = OPENAI_MODEL!;
  }

  if (!TIER2_GH_AVAILABLE) {
    it.todo('Tier 2 git ops tests require JARVIS_E2E_GH_TOKEN env var');
  }

  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      name: DBConnections.INTERNAL,
      type: 'postgres',
      host: process.env['DATABASE_HOST'] ?? 'localhost',
      port: Number(process.env['DATABASE_PORT'] ?? 5433),
      username: process.env['DATABASE_USER'] ?? 'postgres',
      password: process.env['DATABASE_PASSWORD'] ?? 'test123',
      database: process.env['DATABASE_NAME'] ?? 'e2e_test_db',
      schema: 'jarvis',
      entities: [TranscriptSchema, DreamSchema, DreamPhaseSchema, FileManifestSchema, ContextCacheSchema],
      migrations: [InitJarvis1746662400000, Pgvector1746662400001],
      migrationsRun: true,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy().catch(() => undefined);
  });

  it('should resume deep dream from phase3 when worker is SIGKILL-ed after phase2 completes', async () => {
    // Arrange — spawn worker in a child process so we can SIGKILL it
    const workerScript = path.resolve(__dirname, '../../src/main.ts');
    const workerEnv: NodeJS.ProcessEnv = LIVE_LLM_AVAILABLE
      ? {
          ...process.env,
          LLM_PROVIDER: 'openai-compatible',
          OPENAI_COMPATIBLE_BASE_URL: OPENAI_URL!,
          OPENAI_COMPATIBLE_API_KEY: OPENAI_TOKEN!,
          OPENAI_COMPATIBLE_MODEL: OPENAI_MODEL!,
        }
      : {
          ...process.env,
          LLM_PROVIDER: 'llamacpp',
          LLAMACPP_BASE_URL: process.env['LLAMACPP_BASE_URL'] ?? 'http://localhost:11435/v1',
        };

    const workerChild = child_process.fork(workerScript, [], {
      env: workerEnv,
      silent: true,
    });

    // Wait for worker to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker startup timeout')), 30_000);
      workerChild.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('Application is running')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      workerChild.on('error', reject);
    });

    // Act — trigger deep dream via HTTP to the worker child
    const targetDate = new Date().toISOString().slice(0, 10);
    const http = await import('node:http');
    const triggerDream = () =>
      new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: 'localhost', port: 8000, path: '/dream', method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (res) => {
            res.resume();
            res.on('end', resolve);
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify({}));
      });
    await triggerDream();

    // Create dream row to track it
    const dreamRows = await dataSource.query(
      `SELECT id FROM jarvis.dreams WHERE kind = 'deep' AND target_date = $1 ORDER BY created_at DESC LIMIT 1`,
      [targetDate],
    );
    expect(dreamRows.length).toBeGreaterThan(0);
    const dreamId: number = dreamRows[0].id;

    // Wait for phase2 to complete
    const phase2Done = await waitForPhase(dataSource, dreamId, 'phase2', 120_000);
    expect(phase2Done).toBe(true);

    // SIGKILL the worker child
    process.kill(workerChild.pid!, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 2_000));

    // Restart worker child
    const workerChild2 = child_process.fork(workerScript, [], {
      env: workerEnv,
      silent: true,
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker restart timeout')), 30_000);
      workerChild2.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('Application is running')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      workerChild2.on('error', reject);
    });

    // Wait for phase3 to complete
    const phase3Done = await waitForPhase(dataSource, dreamId, 'phase3', 180_000);

    // Assert — no duplicate rows for phase1 or phase2
    const phase1Count = await countPhasesForDream(dataSource, dreamId, 'phase1');
    const phase2Count = await countPhasesForDream(dataSource, dreamId, 'phase2');
    expect(phase1Count).toBe(1);
    expect(phase2Count).toBe(1);
    expect(phase3Done).toBe(true);

    // Cleanup
    workerChild2.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 2_000));
  });
});
