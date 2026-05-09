import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';

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

/**
 * Lean E2E test harness for Jarvis server (replaces boilerplate after Story 13.16.5 cleanup).
 * Kafka and MongoDB removed — Jarvis is Postgres-only.
 */
export class E2ETestSetup {
  public app!: INestApplication;
  public httpServer: any;
  public dataSource!: DataSource;

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

  async teardown(): Promise<void> {
    await this.app?.close().catch(() => undefined);
  }

  getRepository<T>(entity: new () => T) {
    return this.dataSource.getRepository(entity);
  }
}
