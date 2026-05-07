/**
 * Error-envelope e2e (Story 13.1 AC #8).
 *
 * Asserts the global filter chain returns the boilerplate-native flat envelope
 * `{ code: <numeric ErrorCode>, message: string, data: null }` per
 * `architecture.md §9.1` amended 2026-05-07. The Python-era nested shape
 * `{ error: { code, message }, status: 'error' }` is NOT introduced.
 *
 * We exercise two paths:
 *   1. An unknown route → `HttpExceptionFilter` (404 → ErrorCode.UNKNOWN)
 *   2. An InternalException raised from a deliberately-throwing route →
 *      `DefaultInternalExceptionFilter` (500 → ErrorCode.UNKNOWN with
 *      explicit "oops" message)
 */
import { Controller, Get, INestApplication, Logger, Module, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { CustomLoggerService } from '../src/shared/logger/services/custom-logger.service';
import { HttpRequestLoggingInterceptor } from '../src/shared/logger/interceptors/http-request-logging.interceptor';
import { DefaultValidationOptions } from '../src/utils/config/validation.config';
import { ErrorCode } from '../src/utils/error.code';
import { InternalException } from '../src/shared/common/models/exception';
import {
  DefaultInternalExceptionFilter,
  DefaultUnauthorizedExceptionFilter,
  DefaultValidateExceptionFilter,
  HttpExceptionFilter,
  UnknownExceptionsFilter,
} from '../src/utils/filter/exception.filter';

@Controller('__test__')
class TestThrowController {
  @Get('internal')
  public throwInternal(): never {
    throw new InternalException(ErrorCode.UNKNOWN, 'oops');
  }
}

@Module({
  controllers: [TestThrowController],
})
class TestThrowModule {}

describe('Error envelope E2E', () => {
  let app: INestApplication;

  jest.setTimeout(60000);

  beforeAll(async () => {
    // Given the full AppModule boots and a tiny TestThrowModule is bolted on
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, TestThrowModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });

    const { httpAdapter } = app.get(HttpAdapterHost);
    const cls = app.get(ClsService);
    const reflector = app.get(Reflector);

    app.useLogger(app.get(CustomLoggerService));
    app.useGlobalInterceptors(new HttpRequestLoggingInterceptor(cls, reflector));

    app.useGlobalFilters(new UnknownExceptionsFilter(httpAdapter));
    app.useGlobalFilters(new DefaultValidateExceptionFilter(httpAdapter));
    app.useGlobalFilters(new DefaultInternalExceptionFilter(httpAdapter));
    app.useGlobalFilters(new DefaultUnauthorizedExceptionFilter(httpAdapter));
    app.useGlobalFilters(new HttpExceptionFilter(httpAdapter));

    app.useGlobalPipes(new ValidationPipe(DefaultValidationOptions));

    await app.init();
  }, 90000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  }, 30000);

  describe('flat envelope shape', () => {
    it('should respond to an unknown route with the flat envelope', async () => {
      // When
      const response = await request(app.getHttpServer()).get('/__definitely-not-a-real-route__');

      // Then
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).toEqual({
        code: ErrorCode.UNKNOWN,
        message: expect.any(String),
        data: null,
      });
      // And the Python-era nested shape is NOT used
      expect(response.body).not.toHaveProperty('error');
      expect(response.body).not.toHaveProperty('status');
    });

    it('should respond to an InternalException-throwing route with the flat envelope', async () => {
      // Suppress the unavoidable Logger.error from the filter pipeline so the test output stays readable.
      const errSpy = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);

      try {
        // When
        const response = await request(app.getHttpServer()).get('/__test__/internal');

        // Then
        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          code: ErrorCode.UNKNOWN,
          message: 'oops',
          data: null,
        });
        expect(response.body).not.toHaveProperty('error');
        expect(response.body).not.toHaveProperty('status');
      } finally {
        errSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});
