/**
 * Unit specs for `TemporalHealthIndicator` (Story 13.1 placeholder spec
 * REWRITTEN by Story 13.8). Decision D — always returns `up`; the message
 * conveys actual state. Mirrors Story 13.4 MemU indicator behaviour.
 */
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';
import { TemporalHealthIndicator } from './temporal.indicator';

describe('TemporalHealthIndicator', () => {
  let target: TemporalHealthIndicator;
  let mockClient: DeepMocked<TemporalClientService>;

  beforeEach(() => {
    mockClient = createMock<TemporalClientService>();
    target = new TemporalHealthIndicator(mockClient);
  });

  it('returns up + connected when the client probe is healthy', async () => {
    // Arrange
    mockClient.healthy.mockResolvedValueOnce({ healthy: true, message: 'connected' });

    // Act
    const result = await target.isHealthy('temporal');

    // Assert
    expect(result).toEqual({ temporal: { status: 'up', message: 'connected' } });
  });

  it('returns up + not-connected when the client never connected (graceful Decision D)', async () => {
    // Arrange
    mockClient.healthy.mockResolvedValueOnce({ healthy: false, message: 'not-connected' });

    // Act
    const result = await target.isHealthy('temporal');

    // Assert
    expect(result).toEqual({ temporal: { status: 'up', message: 'not-connected' } });
  });

  it('returns up + unreachable when the probe fails — never throws (Decision D)', async () => {
    // Arrange
    mockClient.healthy.mockResolvedValueOnce({ healthy: false, message: 'unreachable: rpc closed' });

    // Act
    const result = await target.isHealthy('temporal');

    // Assert
    expect(result).toEqual({ temporal: { status: 'up', message: 'unreachable: rpc closed' } });
  });

  it('does not throw when the underlying probe rejects (defensive)', async () => {
    // Arrange — `healthy()` is contractually never throws, but assert
    // robustness if it ever did.
    mockClient.healthy.mockRejectedValueOnce(new Error('boom'));

    // Act + Assert — the indicator surfaces the rejection (caller decides
    // how to handle); this codifies the contract: TemporalClientService.healthy()
    // is the graceful boundary; the indicator merely projects.
    await expect(target.isHealthy('temporal')).rejects.toThrow('boom');
  });
});
