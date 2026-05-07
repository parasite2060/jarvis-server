import { Logger } from '@nestjs/common';
import { TemporalClientService } from './temporal-client.service';

describe('TemporalClientService (stub)', () => {
  let target: TemporalClientService;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    target = new TemporalClientService();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should log the signal-coordinator invocation with kind and ID payload keys', async () => {
    // Arrange
    const payload = { transcript_id: 42, session_id: 'sess-1' };

    // Act
    await target.signalCoordinator('light', payload);

    // Assert
    expect(logSpy).toHaveBeenCalledTimes(1);
    const meta = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(meta['event']).toBe('temporalClient.signalCoordinator.invoked');
    expect(meta['kind']).toBe('light');
    expect(meta['transcript_id']).toBe(42);
    expect(meta['session_id']).toBe('sess-1');
  });

  it('should strip forbidden content-bearing keys from the log payload', async () => {
    // Arrange — payload smuggling content fields
    const payload = {
      transcript_id: 42,
      session_id: 'sess-1',
      raw_content: 'should-not-leak',
      secret_key: 'should-not-leak',
    };

    // Act
    await target.signalCoordinator('light', payload);

    // Assert
    const meta = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(meta['transcript_id']).toBe(42);
    expect(meta['session_id']).toBe('sess-1');
    expect(meta).not.toHaveProperty('raw_content');
    expect(meta).not.toHaveProperty('secret_key');
  });
});
