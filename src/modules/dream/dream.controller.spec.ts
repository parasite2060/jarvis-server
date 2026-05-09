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
import { TriggerDreamRequest } from './models/requests/trigger-dream.request';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { ErrorCode } from 'src/utils/error.code';

const FIXED_NOW = new Date('2026-05-08T14:30:00.000Z');
const FIXED_TODAY = '2026-05-08';

describe('DreamController', () => {
  let target: DreamController;
  let mockTriggerDeep: DeepMocked<TriggerDeepDreamUseCase>;

  beforeEach(async () => {
    mockTriggerDeep = createMock<TriggerDeepDreamUseCase>();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DreamController],
      providers: [{ provide: TriggerDeepDreamUseCase, useValue: mockTriggerDeep }],
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
    it('empty body — defaults to today UTC + manual trigger + sourceDateIso null', async () => {
      jest.useFakeTimers().setSystemTime(FIXED_NOW);

      const request = new TriggerDreamRequest();
      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledTimes(1);
      expect(mockTriggerDeep.execute).toHaveBeenCalledWith({
        targetDate: FIXED_TODAY,
        trigger: 'manual',
        sourceDateIso: null,
      });
    });

    it('with sourceDate — uses that date + manual-backfill trigger + sourceDateIso set', async () => {
      const request = new TriggerDreamRequest();
      request.sourceDate = '2026-04-20';

      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledWith({
        targetDate: '2026-04-20',
        trigger: 'manual-backfill',
        sourceDateIso: '2026-04-20',
      });
    });

    it('Q7 — snake_case source_date (plugin wire) also works', async () => {
      const request = new TriggerDreamRequest();
      request.source_date = '2026-04-20';

      await target.trigger(request);

      expect(mockTriggerDeep.execute).toHaveBeenCalledWith({
        targetDate: '2026-04-20',
        trigger: 'manual-backfill',
        sourceDateIso: '2026-04-20',
      });
    });

    it('camelCase sourceDate takes priority over snake_case source_date', async () => {
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

    it('returns HttpApiResponse with status queued (HTTP 202 via @HttpCode)', async () => {
      mockTriggerDeep.execute.mockResolvedValue(undefined);
      const request = new TriggerDreamRequest();

      const result = await target.trigger(request);

      expect(result.data).toBeDefined();
      expect(result.data.status).toBe('queued');
      expect(result.code).toBe(ErrorCode.SUCCESS);
    });
  });
});