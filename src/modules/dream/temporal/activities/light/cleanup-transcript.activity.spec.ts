import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CleanupTranscriptActivity } from './cleanup-transcript.activity';
import { AppConfigService } from 'src/shared/config/config.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';

describe('CleanupTranscriptActivity', () => {
  let target: CleanupTranscriptActivity;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vault-cleanup-test-'));

    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'vaultPath', { get: () => vaultDir });

    const module: TestingModule = await Test.createTestingModule({
      providers: [CleanupTranscriptActivity, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get(CleanupTranscriptActivity);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await fs.rm(vaultDir, { recursive: true, force: true });
  });

  it('deletes the transcript file when it exists', async () => {
    // Arrange
    const transcriptsDir = path.join(vaultDir, 'transcripts');
    await fs.mkdir(transcriptsDir, { recursive: true });
    const fileName = 'transcripts/x.txt';
    await fs.writeFile(path.join(vaultDir, fileName), 'session content');

    // Act
    await target.cleanupTranscript({ transcript_file: fileName });

    // Assert
    await expect(fs.access(path.join(vaultDir, fileName))).rejects.toThrow();
  });

  it('does nothing when transcript_file is null', async () => {
    // Act + Assert — must not throw
    await expect(target.cleanupTranscript({ transcript_file: null })).resolves.toBeUndefined();
  });

  it('does nothing when transcript_file is an empty string', async () => {
    // Act + Assert — must not throw
    await expect(target.cleanupTranscript({ transcript_file: '' })).resolves.toBeUndefined();
  });

  it('does not throw when the file does not exist', async () => {
    // Act + Assert — resilient: fs.rm with force:true is a no-op on missing files
    await expect(target.cleanupTranscript({ transcript_file: 'transcripts/nonexistent.txt' })).resolves.toBeUndefined();
  });

  it('does not throw and does not delete on a path-traversal attempt', async () => {
    // Arrange — write a real file outside the vault to confirm it is NOT deleted
    const outsideFile = path.join(os.tmpdir(), `jarvis-traversal-guard-${Date.now()}.txt`);
    await fs.writeFile(outsideFile, 'should remain');

    // Act
    await expect(target.cleanupTranscript({ transcript_file: '../../etc/passwd' })).resolves.toBeUndefined();

    // Assert — the outside file was not touched
    const content = await fs.readFile(outsideFile, 'utf-8');
    expect(content).toBe('should remain');

    // Cleanup
    await fs.rm(outsideFile, { force: true });
  });
});
