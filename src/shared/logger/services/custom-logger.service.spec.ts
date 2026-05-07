import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ClsService } from 'nestjs-cls';
import { CustomLoggerService } from './custom-logger.service';
import { CUSTOM_LOGGER_OPTION, CustomLoggerOptions } from '../model/logger.option';

const mockPinoInfo = jest.fn();
const mockPinoError = jest.fn();
const mockPinoWarn = jest.fn();
const mockPinoDebug = jest.fn();
const mockPinoTrace = jest.fn();

jest.mock('pino', () => {
  const factory = jest.fn(() => ({
    info: mockPinoInfo,
    error: mockPinoError,
    warn: mockPinoWarn,
    debug: mockPinoDebug,
    trace: mockPinoTrace,
  }));
  return {
    __esModule: true,
    default: factory,
    stdTimeFunctions: { isoTime: jest.fn() },
  };
});

describe('CustomLoggerService', () => {
  let target: CustomLoggerService;
  let mockCls: DeepMocked<ClsService>;
  const options: CustomLoggerOptions = {
    output: 'json',
    source: false,
    gcpProperties: false,
    level: 'info',
    logFile: null,
    syncFile: '/var/run/test.pid',
  };

  beforeEach(async () => {
    [mockPinoInfo, mockPinoError, mockPinoWarn, mockPinoDebug, mockPinoTrace].forEach((m) => m.mockReset());
    mockCls = createMock<ClsService>();
    mockCls.getId.mockReturnValue('req-123');

    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomLoggerService, { provide: ClsService, useValue: mockCls }, { provide: CUSTOM_LOGGER_OPTION, useValue: options }],
    }).compile();

    target = module.get(CustomLoggerService);
  });

  describe('log', () => {
    it('should emit info with caller from explicit context for primitive messages', () => {
      target.log('hello', 'AppController');

      expect(mockPinoInfo).toHaveBeenCalledWith({ requestId: 'req-123', caller: 'AppController' }, 'hello');
    });

    it('should fall back to setContext value when no context is passed', () => {
      target.setContext('FallbackCtx');

      target.log('hello');

      expect(mockPinoInfo).toHaveBeenCalledWith({ requestId: 'req-123', caller: 'FallbackCtx' }, 'hello');
    });

    it('should split object payload into message + meta', () => {
      target.log({ message: 'request done', userId: 1, latencyMs: 12 }, 'AppController');

      expect(mockPinoInfo).toHaveBeenCalledWith({ requestId: 'req-123', caller: 'AppController', userId: 1, latencyMs: 12 }, 'request done');
    });
  });

  describe('error', () => {
    it('should attach stack and meta when given an Error instance', () => {
      const err = new Error('boom');
      err.stack = 'stack-trace';

      target.error(err, undefined, 'BlogService');

      expect(mockPinoError).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-123', caller: 'BlogService', stack: 'stack-trace' }),
        'boom',
      );
    });

    it('should pull stack from nested error inside an object payload', () => {
      const inner = new Error('inner-boom');
      inner.stack = 'inner-stack';

      target.error({ message: 'outer', error: inner, foo: 'bar' }, undefined, 'BlogService');

      expect(mockPinoError).toHaveBeenCalledWith(
        expect.objectContaining({
          caller: 'BlogService',
          stack: 'inner-stack',
          foo: 'bar',
        }),
        'outer',
      );
    });

    it('should keep non-Error nested error fields verbatim', () => {
      target.error({ message: 'outer', error: { code: 42 } }, undefined, 'BlogService');

      expect(mockPinoError).toHaveBeenCalledWith(expect.objectContaining({ caller: 'BlogService', error: { code: 42 } }), 'outer');
    });

    it('should use trace as stack when context is provided alongside primitive message', () => {
      target.error('something failed', 'TRACE-FROM-NEST', 'BlogService');

      expect(mockPinoError).toHaveBeenCalledWith(expect.objectContaining({ caller: 'BlogService', stack: 'TRACE-FROM-NEST' }), 'something failed');
    });

    it('should not set stack when no context and no trace', () => {
      target.error('plain failure');

      expect(mockPinoError).toHaveBeenCalledWith(expect.objectContaining({ stack: null }), 'plain failure');
    });
  });

  describe('warn', () => {
    it('should emit warn with object meta and extracted nested-error stack', () => {
      const inner = new Error('rate limited');
      inner.stack = 'rl-stack';

      target.warn({ message: 'soft fail', error: inner, attempt: 2 }, 'BlogService');

      expect(mockPinoWarn).toHaveBeenCalledWith(expect.objectContaining({ caller: 'BlogService', stack: 'rl-stack', attempt: 2 }), 'soft fail');
    });

    it('should emit warn for primitive messages', () => {
      target.warn('low memory', 'BlogService');

      expect(mockPinoWarn).toHaveBeenCalledWith({ requestId: 'req-123', caller: 'BlogService' }, 'low memory');
    });
  });

  describe('debug', () => {
    it('should split object meta from message', () => {
      target.debug?.({ message: 'cache hit', key: 'k1' }, 'CacheService');

      expect(mockPinoDebug).toHaveBeenCalledWith({ requestId: 'req-123', caller: 'CacheService', key: 'k1' }, 'cache hit');
    });
  });

  describe('verbose', () => {
    it('should emit at trace level (verbose maps to trace in pino)', () => {
      target.verbose?.('detailed step', 'CacheService');

      expect(mockPinoTrace).toHaveBeenCalledWith({ requestId: 'req-123', caller: 'CacheService' }, 'detailed step');
    });
  });

  describe('addition / context fields', () => {
    it('should include GCP spanId when gcpProperties is enabled', async () => {
      const moduleWithGcp = await Test.createTestingModule({
        providers: [
          CustomLoggerService,
          { provide: ClsService, useValue: mockCls },
          { provide: CUSTOM_LOGGER_OPTION, useValue: { ...options, gcpProperties: true } },
        ],
      }).compile();
      const targetWithGcp = moduleWithGcp.get(CustomLoggerService);

      targetWithGcp.log('hi', 'X');

      expect(mockPinoInfo).toHaveBeenCalledWith(expect.objectContaining({ 'logging.googleapis.com/spanId': 'req-123' }), 'hi');
    });
  });
});
