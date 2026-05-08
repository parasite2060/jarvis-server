import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PromptCacheService } from './prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

describe('PromptCacheService', () => {
  let target: PromptCacheService;
  let mockConfig: DeepMocked<AppConfigService>;
  let tempDir: string;

  beforeEach(async () => {
    // Arrange: create a temp prompts directory with the required prompts.
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-cache-spec-'));
    fs.writeFileSync(path.join(tempDir, 'light-extraction.md'), 'EXTRACTION-PROMPT-BODY');
    fs.writeFileSync(path.join(tempDir, 'light-record.md'), 'RECORD-PROMPT-BODY');

    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'promptsPath', { get: () => tempDir });

    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptCacheService, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get(PromptCacheService);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  describe('onApplicationBootstrap', () => {
    it('should load all required prompts into cache', () => {
      // Act
      target.onApplicationBootstrap();

      // Assert
      expect(target.getPrompt('light-extraction')).toBe('EXTRACTION-PROMPT-BODY');
      expect(target.getPrompt('light-record')).toBe('RECORD-PROMPT-BODY');
    });

    it('should throw DREAM_PROMPT_LOAD_FAILED when a required prompt is missing', () => {
      // Arrange
      fs.unlinkSync(path.join(tempDir, 'light-record.md'));

      // Act + Assert
      expect(() => target.onApplicationBootstrap()).toThrow(expect.objectContaining({ code: ErrorCode.DREAM_PROMPT_LOAD_FAILED }));
    });

    it('should throw DREAM_PROMPT_LOAD_FAILED when prompts directory does not exist', () => {
      // Arrange
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Act + Assert
      expect(() => target.onApplicationBootstrap()).toThrow(expect.objectContaining({ code: ErrorCode.DREAM_PROMPT_LOAD_FAILED }));
    });
  });

  describe('getPrompt', () => {
    it('should return cached content after bootstrap', () => {
      // Arrange
      target.onApplicationBootstrap();

      // Act
      const result = target.getPrompt('light-extraction');

      // Assert
      expect(result).toBe('EXTRACTION-PROMPT-BODY');
    });

    it('should throw when prompt was never loaded', () => {
      // Act + Assert — note: did NOT call onApplicationBootstrap
      expect(() => target.getPrompt('non-existent')).toThrow(expect.objectContaining({ code: ErrorCode.DREAM_PROMPT_LOAD_FAILED }));
    });
  });
});
