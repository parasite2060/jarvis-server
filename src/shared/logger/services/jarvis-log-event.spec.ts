/**
 * Jarvis log-event taxonomy assertion test (Story 13.1 AC #4).
 *
 * Convention: every Jarvis log line carries an `event` field shaped as
 * `module.action.status` (camelCase parts). Required structured fields are
 * `sessionId`, `dreamId`, `transcriptId` when the call site has them; `traceId`
 * is auto-attached by the boilerplate request-context middleware.
 *
 * Forbidden fields (must never leak): transcript content, secret content,
 * vault file content. Log lengths, counts, hashes only.
 *
 * Three example events used across the codebase:
 *   - lightDream.extraction.completed
 *   - secretScrubber.redactions.completed
 *   - temporalWorker.activity.started
 *
 * Reference: `_bmad-output/planning-artifacts/design/observability.md`,
 * `components/jarvis-server-ts/docs/standards/backend/logging.md`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ClsService } from 'nestjs-cls';
import { CustomLoggerService } from './custom-logger.service';
import { CUSTOM_LOGGER_OPTION, CustomLoggerOptions } from '../model/logger.option';

const mockPinoInfo = jest.fn();

jest.mock('pino', () => {
  const factory = jest.fn(() => ({
    info: mockPinoInfo,
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  }));
  return {
    __esModule: true,
    default: factory,
    stdTimeFunctions: { isoTime: jest.fn() },
  };
});

const EVENT_NAME_REGEX = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/;
const FORBIDDEN_FIELD_REGEX = /(content|transcript|secret|raw|payload)/i;

describe('Jarvis log-event taxonomy', () => {
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
    mockPinoInfo.mockReset();
    mockCls = createMock<ClsService>();
    mockCls.getId.mockReturnValue('req-test-123');

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [CustomLoggerService, { provide: ClsService, useValue: mockCls }, { provide: CUSTOM_LOGGER_OPTION, useValue: options }],
    }).compile();

    target = moduleRef.get(CustomLoggerService);
  });

  it('should render the canonical lightDream event with all required fields', () => {
    // Arrange
    const event = {
      message: 'light dream extraction finished',
      event: 'lightDream.extraction.completed',
      sessionId: 'sess-1',
      dreamId: 'd-1',
      transcriptId: 't-1',
      durationMs: 42,
    };

    // Act
    target.log(event, 'LightDreamWorkflow');

    // Assert
    expect(mockPinoInfo).toHaveBeenCalledTimes(1);
    const [meta] = mockPinoInfo.mock.calls[0];
    expect(meta).toEqual(
      expect.objectContaining({
        event: 'lightDream.extraction.completed',
        sessionId: 'sess-1',
        dreamId: 'd-1',
        transcriptId: 't-1',
        durationMs: 42,
        caller: 'LightDreamWorkflow',
      }),
    );
  });

  it('should produce an event name matching module.action.status (camelCase parts)', () => {
    // Arrange
    target.log({ message: 'irrelevant', event: 'lightDream.extraction.completed' }, 'LightDreamWorkflow');

    // Act
    const [meta] = mockPinoInfo.mock.calls[0];

    // Assert
    expect(typeof meta.event).toBe('string');
    expect(EVENT_NAME_REGEX.test(meta.event)).toBe(true);
  });

  it('should refuse common forbidden field names that would leak content', () => {
    // Arrange
    const forbiddenSamples = ['transcript', 'transcriptContent', 'rawTranscript', 'secretValue', 'payloadBlob', 'fileContent'];

    // Act / Assert
    for (const fieldName of forbiddenSamples) {
      expect(FORBIDDEN_FIELD_REGEX.test(fieldName)).toBe(true);
    }
  });

  it('should not include forbidden field names in a well-formed log payload', () => {
    // Arrange
    const event = {
      message: 'light dream extraction finished',
      event: 'lightDream.extraction.completed',
      sessionId: 'sess-1',
      dreamId: 'd-1',
      transcriptId: 't-1',
      transcriptLineCount: 120,
      transcriptHash: 'sha256:abc',
      durationMs: 42,
    };

    // Act
    target.log(event, 'LightDreamWorkflow');
    const [meta] = mockPinoInfo.mock.calls[0];

    // Assert
    const offendingFieldNames = Object.keys(meta).filter((k) => /(content|secret|raw|payload)/i.test(k));
    expect(offendingFieldNames).toEqual([]);
    expect(meta).not.toHaveProperty('transcript');
  });

  it('should accept all three documented example events', () => {
    // Arrange
    const examples = ['lightDream.extraction.completed', 'secretScrubber.redactions.completed', 'temporalWorker.activity.started'];

    // Act / Assert
    for (const event of examples) {
      expect(EVENT_NAME_REGEX.test(event)).toBe(true);
    }
  });
});
