/**
 * Terminus indicator for the Temporal client/worker (Story 13.1 introduced
 * as placeholder; Story 13.8 retrofits with the real probe).
 *
 * Decision D pattern (Story 13.4 MemU indicator precedent): always returns
 * `up` so `/health` stays 200 even when Temporal is unreachable. The
 * `message` field conveys the actual state (`connected` /
 * `unreachable: <error>` / `not-connected`).
 *
 * Probe is `client.connection.workflowService.getSystemInfo({})` with a 2 s
 * timeout (Q3 + Q7) — see `TemporalClientService.healthy()`.
 */
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { TemporalClientService } from 'src/shared/temporal/temporal-client.service';

@Injectable()
export class TemporalHealthIndicator extends HealthIndicator {
  constructor(private readonly temporalClient: TemporalClientService) {
    super();
  }

  public async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const probe = await this.temporalClient.healthy();
    return this.getStatus(key, true, { message: probe.message });
  }
}
