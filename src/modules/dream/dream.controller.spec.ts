/**
 * Unit spec for DreamController — POST /dream (Story 13.14).
 *
 * Covers signal-call assertions for:
 * - Empty body → calls triggerDeep with today UTC + manual trigger + sourceDateIso null
 * - With sourceDate → calls triggerDeep with that date + manual-backfill trigger + sourceDateIso set
 * - Q7: snake_case source_date also works (plugin compatibility)
 * - camelCase sourceDate takes priority
 * - Response shape via HttpApiResponse
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { DreamController } from './dream.controller';
import { TriggerDeepDreamUseCase } from './usecases/trigger-deep-dream.usecase';
import { TriggerLightDreamUseCase } from './usecases/trigger-light-dream.usecase';
import { TriggerDreamRequest } from './models/requests/trigger-dream.request';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

const FIXED_NOW = new Date('2026-05-08T14:30:00.000Z');
const FIXED_TODAY = '2026-05-08';

describe('DreamController', () => {
  let target: DreamController;
  let mockTriggerDeep: DeepMocked<TriggerDeepDreamUseCase>;
  let mockTriggerLight: DeepMocked<TriggerLightDreamUseCase>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    mockTriggerDeep = createMock<TriggerDeepDreamUseCase>();
    mockTriggerLight = createMock<TriggerLightDreamUseCase>();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DreamController],
      providers: [
        { provide: TriggerDeepDreamUseCase, useValue: mockTriggerDeep },
        { provide: TriggerLightDreamUseCase, useValue: mockTriggerLight },
      ],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(DreamController);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('POST /dream', () => {
    it('should default to today UTC with manual trigger when body is empty', async () => {
      const request = new TriggerDreamRequest();

      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledTimes(1);
      expect(mockTriggerDeep.execute).toHaveBeenCalledWith({
        targetDate: FIXED_TODAY,
        trigger: 'manual',
        sourceDateIso: null,
      });
    });

    it('should use provided date with manual-backfill trigger when sourceDate is given', async () => {
      const request = new TriggerDreamRequest();
      request.sourceDate = '2026-04-20';

      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledWith({
        targetDate: '2026-04-20',
        trigger: 'manual-backfill',
        sourceDateIso: '2026-04-20',
      });
    });

    it('should accept snake_case source_date when plugin sends legacy wire format', async () => {
      const request = new TriggerDreamRequest();
      request.source_date = '2026-04-20';

      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledWith({
        targetDate: '2026-04-20',
        trigger: 'manual-backfill',
        sourceDateIso: '2026-04-20',
      });
    });

    it('should prioritise camelCase sourceDate when both sourceDate and source_date are provided', async () => {
      const request = new TriggerDreamRequest();
      request.sourceDate = '2026-05-01';
      request.source_date = '2026-04-20';

      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledWith({
        targetDate: '2026-05-01',
        trigger: 'manual-backfill',
        sourceDateIso: '2026-05-01',
      });
    });

    it('should return queued status with dreamId and echo fields when deep dream is triggered', async () => {
      mockTriggerDeep.execute.mockResolvedValue({ dreamId: 20260508 });
      const request = new TriggerDreamRequest();

      const result = await target.trigger(request);

      expect(result.data).toBeDefined();
      expect(result.data.status).toBe('queued');
      expect(result.data.dreamId).toBe(20260508);
      expect(result.data.trigger).toBe('manual');
      expect(result.data.targetDate).toBe(FIXED_TODAY);
      expect(result.code).toBe(ErrorCode.SUCCESS);
    });

    it('should trigger light dream when type=light', async () => {
      const request = new TriggerDreamRequest();
      request.type = 'light';

      const result = await target.trigger(request);

      expect(mockTriggerLight.execute).toHaveBeenCalledTimes(1);
      expect(mockTriggerDeep.execute).not.toHaveBeenCalled();
      expect(result.data.status).toBe('queued');
      expect(result.code).toBe(ErrorCode.SUCCESS);
    });

    it('should trigger deep dream when type=deep', async () => {
      mockTriggerDeep.execute.mockResolvedValue({ dreamId: 123 });
      const request = new TriggerDreamRequest();
      request.type = 'deep';

      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledTimes(1);
      expect(mockTriggerLight.execute).not.toHaveBeenCalled();
    });

    it('should echo sourceDateIso and trigger in response for backfill', async () => {
      mockTriggerDeep.execute.mockResolvedValue({ dreamId: 999 });
      const request = new TriggerDreamRequest();
      request.sourceDate = '2026-04-20';

      const result = await target.trigger(request);

      expect(result.data.trigger).toBe('manual-backfill');
      expect(result.data.sourceDateIso).toBe('2026-04-20');
      expect(result.data.targetDate).toBe('2026-04-20');
    });
  });
});
