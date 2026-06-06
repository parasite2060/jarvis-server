import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { LoadTranscriptActivity } from './load-transcript.activity';
import { AppConfigService } from 'src/shared/config/config.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { DBConnections } from 'src/shared/postgres/utils/constaint';
import { TranscriptSchema } from 'src/shared/postgres/schema/transcript.schema';
import { DreamSchema } from 'src/shared/postgres/schema/dream.schema';
import { Conversation } from 'src/shared/domain/entities/conversation.entity';
import { Dream } from 'src/shared/domain/entities/dream.entity';

function makeJsonlTranscript(userTurns: string[]): string {
  return userTurns.map((content) => JSON.stringify({ type: 'user', message: { role: 'user', content } })).join('\n');
}

describe('LoadTranscriptActivity', () => {
  let target: LoadTranscriptActivity;
  let mockDataSource: DeepMocked<DataSource>;
  let mockConfig: DeepMocked<AppConfigService>;
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vault-test-'));

    mockDataSource = createMock<DataSource>();
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'vaultPath', { get: () => vaultDir });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoadTranscriptActivity,
        { provide: getDataSourceToken(DBConnections.INTERNAL), useValue: mockDataSource },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = module.get(LoadTranscriptActivity);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await fs.rm(vaultDir, { recursive: true, force: true });
  });

  function setupTransaction(transcript: Partial<Conversation>, existingDream: Partial<Dream> | null): void {
    const transcriptRepo = createMock<Repository<Conversation>>();
    const dreamRepo = createMock<Repository<Dream>>();

    transcriptRepo.findOne.mockResolvedValue(transcript as Conversation);
    dreamRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(existingDream),
    } as never);

    if (existingDream === null) {
      dreamRepo.create.mockReturnValue({ id: 42, type: 'light' } as Dream);
      dreamRepo.save.mockResolvedValue({ id: 42 } as Dream);
      transcriptRepo.update.mockResolvedValue({ affected: 1 } as never);
    }

    const manager = createMock<EntityManager>();
    (manager.getRepository as unknown as jest.Mock).mockImplementation((entity: unknown) => {
      if (entity === TranscriptSchema) return transcriptRepo;
      if (entity === DreamSchema) return dreamRepo;
      return createMock<Repository<never>>();
    });

    (mockDataSource.transaction as unknown as jest.Mock).mockImplementation(async (cb: (manager: EntityManager) => Promise<unknown>) => cb(manager));
  }

  it('writes transcript content to a file under vaultPath/transcripts/ and returns the relative path', async () => {
    // Arrange
    const rawContent = makeJsonlTranscript(['turn 1', 'turn 2', 'turn 3', 'turn 4']);
    setupTransaction(
      {
        id: 7,
        rawContent,
        parsedText: null,
        project: 'test-project',
        tokenCount: 1000,
        createdAt: new Date('2026-06-01T10:30:00Z'),
        segmentEndLine: 50,
        isContinuation: false,
      },
      null,
    );

    // Act
    const result = await target.loadTranscript({ session_id: 'sess-1', transcript_id: 7 });

    // Assert — path shape
    expect(result.transcript_file).toMatch(/^transcripts\/7_[0-9a-f]{8}\.txt$/);

    // Assert — file on disk contains the raw content
    const absPath = path.join(vaultDir, result.transcript_file!);
    const onDisk = await fs.readFile(absPath, 'utf-8');
    expect(onDisk).toBe(rawContent);

    // Assert — user message count is precomputed correctly (4 real turns)
    expect(result.user_message_count).toBe(4);
  });

  it('does NOT include parsed_text in the result', async () => {
    // Arrange
    setupTransaction({ id: 7, rawContent: makeJsonlTranscript(['a', 'b', 'c']), parsedText: 'should-not-appear' }, null);

    // Act
    const result = await target.loadTranscript({ session_id: 'sess-1', transcript_id: 7 });

    // Assert
    expect(result).not.toHaveProperty('parsed_text');
  });

  it('uses parsedText over rawContent when both present', async () => {
    // Arrange
    const parsedText = makeJsonlTranscript(['p1', 'p2', 'p3', 'p4', 'p5']);
    setupTransaction({ id: 8, rawContent: makeJsonlTranscript(['r1']), parsedText }, null);

    // Act
    const result = await target.loadTranscript({ session_id: 'sess-2', transcript_id: 8 });

    // Assert — the file written contains parsedText, not rawContent
    const absPath = path.join(vaultDir, result.transcript_file!);
    const onDisk = await fs.readFile(absPath, 'utf-8');
    expect(onDisk).toBe(parsedText);
    expect(result.user_message_count).toBe(5);
  });

  it('writes an empty file and returns count 0 when text is empty', async () => {
    // Arrange
    setupTransaction({ id: 9, rawContent: '', parsedText: null }, null);

    // Act
    const result = await target.loadTranscript({ session_id: 'sess-3', transcript_id: 9 });

    // Assert
    expect(result.transcript_file).toMatch(/^transcripts\/9_[0-9a-f]{8}\.txt$/);
    const absPath = path.join(vaultDir, result.transcript_file!);
    const onDisk = await fs.readFile(absPath, 'utf-8');
    expect(onDisk).toBe('');
    expect(result.user_message_count).toBe(0);
  });

  it('reuses an existing recent dream row instead of creating a new one', async () => {
    // Arrange
    setupTransaction({ id: 10, rawContent: makeJsonlTranscript(['x', 'y', 'z']) }, { id: 99 });

    // Act
    const result = await target.loadTranscript({ session_id: 'sess-4', transcript_id: 10 });

    // Assert — reuses existing dream id
    expect(result.dream_id).toBe(99);
  });

  it('throws LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND when transcript_id is null', async () => {
    // Act
    const promise = target.loadTranscript({ session_id: 'sess-x', transcript_id: null });

    // Assert
    await expect(promise).rejects.toBeInstanceOf(InternalException);
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND });
  });

  it('throws LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND when transcript row does not exist', async () => {
    // Arrange
    const transcriptRepo = createMock<Repository<Conversation>>();
    transcriptRepo.findOne.mockResolvedValue(null);
    const manager = createMock<EntityManager>();
    (manager.getRepository as unknown as jest.Mock).mockReturnValue(transcriptRepo);
    (mockDataSource.transaction as unknown as jest.Mock).mockImplementation(async (cb: (manager: EntityManager) => Promise<unknown>) => cb(manager));

    // Act
    const promise = target.loadTranscript({ session_id: 'sess-y', transcript_id: 999 });

    // Assert
    await expect(promise).rejects.toBeInstanceOf(InternalException);
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.LIGHT_DREAM_LOAD_TRANSCRIPT_NOT_FOUND });
  });
});
