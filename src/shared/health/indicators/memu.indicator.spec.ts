import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { MemuHealthIndicator } from './memu.indicator';

function axiosOk(): AxiosResponse<unknown> {
  return {
    data: undefined,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as AxiosResponse['config'],
  };
}

describe('MemuHealthIndicator', () => {
  let target: MemuHealthIndicator;
  let mockHttp: DeepMocked<HttpService>;
  let mockConfig: DeepMocked<AppConfigService>;

  beforeEach(async () => {
    mockHttp = createMock<HttpService>();
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'memuApiUrl', { get: () => 'http://memu.test' });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [MemuHealthIndicator, { provide: HttpService, useValue: mockHttp }, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();

    target = moduleRef.get(MemuHealthIndicator);
  });

  it('reachable — returns up with message=reachable', async () => {
    // Arrange
    mockHttp.head.mockReturnValue(of(axiosOk()));

    // Act
    const result = await target.isHealthy('memu');

    // Assert
    expect(result).toEqual({ memu: { status: 'up', message: 'reachable' } });
  });

  it('unreachable (transport error) — returns up with sanitised message', async () => {
    // Arrange
    const transportErr = new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
    mockHttp.head.mockReturnValue(throwError(() => transportErr));

    // Act
    const result = await target.isHealthy('memu');

    // Assert
    expect(result['memu']!['status']).toBe('up');
    expect(result['memu']!['message']).toMatch(/^unreachable: /);
    expect(result['memu']!['message']).toContain('ECONNREFUSED');
  });

  it('unreachable (5xx response) — returns up with http_500 message', async () => {
    // Arrange
    const httpErr = new AxiosError('Request failed with status code 500', undefined, undefined, undefined, {
      data: 'busy',
      status: 500,
      statusText: 'err',
      headers: {},
      config: {} as AxiosResponse['config'],
    });
    mockHttp.head.mockReturnValue(throwError(() => httpErr));

    // Act
    const result = await target.isHealthy('memu');

    // Assert
    expect(result['memu']!['status']).toBe('up');
    expect(result['memu']!['message']).toBe('unreachable: http_500');
  });

  it('does NOT throw under any failure mode', async () => {
    // Arrange — synthetic non-axios throw.
    mockHttp.head.mockReturnValue(throwError(() => new Error('some-weird-error')));

    // Act / Assert
    await expect(target.isHealthy('memu')).resolves.toEqual(expect.objectContaining({ memu: expect.objectContaining({ status: 'up' }) }));
  });

  it('long error message — truncated to 120 chars', async () => {
    // Arrange
    const longMessage = 'x'.repeat(500);
    mockHttp.head.mockReturnValue(throwError(() => new Error(longMessage)));

    // Act
    const result = await target.isHealthy('memu');

    // Assert — "unreachable: " prefix (13 chars) + up to 120 truncated.
    expect(result['memu']!['message']!.length).toBeLessThanOrEqual(13 + 120);
  });
});
