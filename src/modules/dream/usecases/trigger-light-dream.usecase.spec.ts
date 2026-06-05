/**
 * Unit spec for TriggerLightDreamUseCase.
 *
 * Covers:
 * - trigger defaults to 'session' when omitted (the conversation-ingest path
 *   never supplies one; the dreams.trigger column is NOT NULL, so a missing
 *   default makes the INSERT fail and the light dream never runs).
 * - explicit trigger is passed through.
 * - manual session (sessionId='manual') → transcriptId null in the row + signal.
 * - signal payload uses snake_case keys (MC3 frozen).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TriggerLightDreamUseCase, TriggerLightDreamInput } from './trigger-light-dream.usecase';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { DREAM_REPOSITORY, IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';

describe('TriggerLightDreamUseCase', () => {
  let target: TriggerLightDreamUseCase;
  let mockTemporal: DeepMocked<TemporalClientService>;
  let mockDreamRepo: DeepMocked<IDreamRepository>;

  beforeEach(async () => {
    mockTemporal = createMock<TemporalClientService>();
    mockDreamRepo = createMock<IDreamRepository>();
    mockDreamRepo.createDream.mockResolvedValue({ id: 7 } as any);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TriggerLightDreamUseCase,
        { provide: TemporalClientService, useValue: mockTemporal },
        { provide: DREAM_REPOSITORY, useValue: mockDreamRepo },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(TriggerLightDreamUseCase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should default trigger to 'session' when omitted (NOT NULL constraint)", async () => {
    // Arrange — conversation-ingest path never supplies a trigger
    const input: TriggerLightDreamInput = { sessionId: 's-1', transcriptId: 42 };

    // Act
    await target.execute(input);

    // Assert
    expect(mockDreamRepo.createDream).toHaveBeenCalledWith(expect.objectContaining({ type: 'light', status: 'queued', trigger: 'session' }));
  });

  it('should pass an explicit trigger through unchanged', async () => {
    // Act
    await target.execute({ sessionId: 's-1', transcriptId: 42, trigger: 'manual' });

    // Assert
    expect(mockDreamRepo.createDream).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'manual' }));
  });

  it('should null the transcriptId for a manual session (row + signal)', async () => {
    // Act
    const result = await target.execute({ sessionId: 'manual', transcriptId: 99, trigger: 'manual' });

    // Assert
    expect(mockDreamRepo.createDream).toHaveBeenCalledWith(expect.objectContaining({ transcriptId: null }));
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith(
      'light',
      expect.objectContaining({ session_id: 'manual', transcript_id: null, dream_id: 7 }),
    );
    expect(result).toEqual({ dreamId: 7 });
  });

  it('should signal the coordinator with snake_case payload + the new dream id', async () => {
    // Act
    await target.execute({ sessionId: 's-2', transcriptId: 5 });

    // Assert
    expect(mockTemporal.signalCoordinator).toHaveBeenCalledWith('light', { session_id: 's-2', transcript_id: 5, dream_id: 7 });
  });
});
