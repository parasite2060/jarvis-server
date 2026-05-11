import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Worker, NativeConnection } from '@temporalio/worker';

import { DBConnections } from '../../src/shared/postgres/utils/constaint';
import { AppModule } from '../../src/app.module';
import { CustomLoggerService } from '../../src/shared/logger/services/custom-logger.service';
import { DefaultValidationOptions } from '../../src/utils/config/validation.config';
import {
  UnknownExceptionsFilter,
  DefaultInternalExceptionFilter,
  DefaultValidateExceptionFilter,
  DefaultUnauthorizedExceptionFilter,
  HttpExceptionFilter,
  VaultFileNotFoundExceptionFilter,
  VaultPathTraversalExceptionFilter,
  VaultEndpointFileNotFoundExceptionFilter,
  VaultEndpointPathTraversalExceptionFilter,
  MemuErrorExceptionFilter,
  MemuUnavailableExceptionFilter,
} from '../../src/utils/filter/exception.filter';
import { HttpRequestLoggingInterceptor } from '../../src/shared/logger/interceptors/http-request-logging.interceptor';
import { AppConfigService } from '../../src/shared/config/config.service';
import { TemporalWorkerService } from '../../src/shared/temporal/temporal-worker.service';

/**
 * Lean E2E test harness for Jarvis server (replaces boilerplate after Story 13.16.5 cleanup).
 * Kafka and MongoDB removed — Jarvis is Postgres-only.
 */
export class E2ETestSetup {
  public app!: INestApplication;
  public httpServer: any;
  public dataSource!: DataSource;

  private worker?: Worker;
  private workerRunPromise?: Promise<void>;
  private nativeConnection?: NativeConnection;

  async init(): Promise<void> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    this.app = moduleFixture.createNestApplication({ bufferLogs: true });

    const { httpAdapter } = this.app.get(HttpAdapterHost);
    const cls = this.app.get(ClsService);
    const reflector = this.app.get(Reflector);

    this.app.useLogger(this.app.get(CustomLoggerService));
    this.app.useGlobalInterceptors(new HttpRequestLoggingInterceptor(cls, reflector));

    this.app.useGlobalFilters(new UnknownExceptionsFilter(httpAdapter));
    this.app.useGlobalFilters(new DefaultValidateExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new DefaultInternalExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new DefaultUnauthorizedExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new HttpExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new VaultFileNotFoundExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new VaultPathTraversalExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new VaultEndpointFileNotFoundExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new VaultEndpointPathTraversalExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new MemuErrorExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new MemuUnavailableExceptionFilter(httpAdapter));

    this.app.useGlobalPipes(new ValidationPipe(DefaultValidationOptions));

    await this.app.init();

    this.httpServer = this.app.getHttpServer();
    this.dataSource = this.app.get(getDataSourceToken(DBConnections.INTERNAL));
  }

  async cleanup(): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await new Promise((r) => setTimeout(r, 100));
    const entities = this.dataSource.entityMetadatas;
    for (const entity of entities) {
      const repository = this.dataSource.getRepository(entity.name);
      const qualifiedTable = entity.schema ? `"${entity.schema}"."${entity.tableName}"` : `"${entity.tableName}"`;
      await repository.query(`TRUNCATE TABLE ${qualifiedTable} RESTART IDENTITY CASCADE`).catch(() => undefined);
    }
  }

  /**
   * Start the real Temporal worker with production workflows + all registered activities.
   * Call this before pipeline tests that trigger Temporal workflows.
   * The worker is shut down automatically in teardown().
   */
  async startWorker(): Promise<void> {
    const config = this.app.get(AppConfigService);
    const workerSvc = this.app.get(TemporalWorkerService);
    const activities = workerSvc.collectActivities(this.app);
    const workflowsPath = path.resolve(__dirname, '../../src/modules/dream/temporal/workflows');

    this.nativeConnection = await NativeConnection.connect({ address: config.temporalAddress });
    this.worker = await Worker.create({
      connection: this.nativeConnection,
      namespace: config.temporalNamespace,
      taskQueue: config.temporalTaskQueue,
      workflowsPath,
      activities,
    });
    this.workerRunPromise = this.worker.run().catch(() => undefined);
  }

  async teardown(): Promise<void> {
    if (this.worker) {
      this.worker.shutdown();
      await this.workerRunPromise;
      await this.nativeConnection?.close().catch(() => undefined);
    }
    await this.app?.close().catch(() => undefined);
  }

  getRepository<T>(entity: new () => T) {
    return this.dataSource.getRepository(entity);
  }

  /**
   * Prepare the E2E vault directory with a bare git repo and seed files.
   * Call in beforeAll for any test suite that exercises git ops (commit, merge).
   * In MEMORY_STORAGE_MODE=local — no remote, no push, no gh CLI.
   */
  static ensureVaultCloned(): void {
    const vaultPath = process.env['VAULT_PATH'] ?? '/tmp/jarvis-e2e-vault';

    // Wipe any stale vault and start fresh
    fs.rmSync(vaultPath, { recursive: true, force: true });
    fs.mkdirSync(vaultPath, { recursive: true });

    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'E2E Test',
      GIT_AUTHOR_EMAIL: 'e2e@test.local',
      GIT_COMMITTER_NAME: 'E2E Test',
      GIT_COMMITTER_EMAIL: 'e2e@test.local',
    };

    // Init a bare local repo (no remote) — push/commit are local-only in local mode
    execSync(`git init -b main "${vaultPath}"`, { env: gitEnv, stdio: 'pipe' });
    execSync(`git -C "${vaultPath}" config user.email "e2e@test.local"`, { env: gitEnv, stdio: 'pipe' });
    execSync(`git -C "${vaultPath}" config user.name "E2E Test"`, { env: gitEnv, stdio: 'pipe' });

    // Seed minimal vault structure
    for (const dir of ['dailys', 'decisions', 'patterns', 'projects', 'templates',
                       'concepts', 'connections', 'lessons', 'references', 'reviews', 'topics']) {
      fs.mkdirSync(path.join(vaultPath, dir), { recursive: true });
    }

    const seedFiles: Record<string, string> = {
      'SOUL.md': '---\ntype: soul\nstatus: permanent\n---\n# Soul\n## Decision Principles\n- Quality over cost\n',
      'IDENTITY.md': '---\ntype: identity\nstatus: permanent\n---\n# Identity\n## Role\nSenior developer. TypeScript.\n',
      'MEMORY.md': '## Strong Patterns\n\n',
      'config.yml': 'auto_merge: false\ndeep_dream_cron: "0 20 * * *"\nweekly_review_cron: "0 20 * * 0"\nmax_memory_lines: 200\n',
      'decisions/_index.md': '# Decisions\n',
      'patterns/_index.md': '# Patterns\n',
    };

    for (const [relPath, content] of Object.entries(seedFiles)) {
      fs.writeFileSync(path.join(vaultPath, relPath), content, 'utf-8');
    }

    execSync(`git -C "${vaultPath}" add -A`, { env: gitEnv, stdio: 'pipe' });
    execSync(`git -C "${vaultPath}" commit -m "chore: init e2e vault"`, { env: gitEnv, stdio: 'pipe' });
  }
}