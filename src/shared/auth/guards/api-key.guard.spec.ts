import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ApiKeyGuard } from './api-key.guard';
import { AppConfigService } from 'src/shared/config/config.service';

const CORRECT_KEY = 'correct-key';

describe('ApiKeyGuard', () => {
  let target: ApiKeyGuard;
  let mockConfig: DeepMocked<AppConfigService>;
  let mockReflector: DeepMocked<Reflector>;
  let mockContext: DeepMocked<ExecutionContext>;
  let mockRequest: { headers: Record<string, string | string[] | undefined>; url: string };

  beforeEach(() => {
    mockConfig = createMock<AppConfigService>();
    mockReflector = createMock<Reflector>();
    mockRequest = { headers: {}, url: '/test' };
    mockContext = createMock<ExecutionContext>();
    mockContext.switchToHttp().getRequest.mockReturnValue(mockRequest);
    mockContext.getHandler.mockReturnValue(jest.fn());
    mockContext.getClass.mockReturnValue(jest.fn());

    target = new ApiKeyGuard(mockConfig, mockReflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canActivate', () => {
    it('should allow access when @Public() and no API key provided', () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);

      expect(target.canActivate(mockContext)).toBe(true);
    });

    it('should allow access when valid API key provided', () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      Object.defineProperty(mockConfig, 'apiKey', { get: () => CORRECT_KEY, configurable: true });
      mockRequest.headers = { api_key: CORRECT_KEY };

      expect(target.canActivate(mockContext)).toBe(true);
    });

    it('should allow access when valid API key via x-api-key header', () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      Object.defineProperty(mockConfig, 'apiKey', { get: () => CORRECT_KEY, configurable: true });
      mockRequest.headers = { 'x-api-key': CORRECT_KEY };

      expect(target.canActivate(mockContext)).toBe(true);
    });

    it('should throw UnauthorizedException when no API key provided', () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      Object.defineProperty(mockConfig, 'apiKey', { get: () => CORRECT_KEY, configurable: true });
      mockRequest.headers = {};

      expect(() => target.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when API key is wrong', () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      Object.defineProperty(mockConfig, 'apiKey', { get: () => CORRECT_KEY, configurable: true });
      mockRequest.headers = { api_key: 'wrong-key' };

      expect(() => target.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('should handle array header value', () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      Object.defineProperty(mockConfig, 'apiKey', { get: () => CORRECT_KEY, configurable: true });
      mockRequest.headers = { api_key: [CORRECT_KEY] };

      expect(target.canActivate(mockContext)).toBe(true);
    });
  });
});
