import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

/**
 * Placeholder Terminus indicator for the Temporal worker.
 *
 * Story 13.1 introduces it so `/health` can already report a `temporal` key.
 * Story 13.8 swaps the body with a real `TemporalWorkerService.healthy()` probe.
 *
 * The indicator must not throw and must return `up` so `/health` stays 200
 * for the early Epic-13 stories that ship without a worker.
 */
@Injectable()
export class TemporalHealthIndicator extends HealthIndicator {
  public isHealthy(key: string): HealthIndicatorResult {
    return super.getStatus(key, true, { message: 'not-yet-bootstrapped' });
  }
}
