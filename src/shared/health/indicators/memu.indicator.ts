/**
 * MemU Terminus indicator (Story 13.4 / Decision D / Q2 / Q8).
 *
 * Always reports `status: 'up'` — encodes the probe outcome in the `message`
 * field (`'reachable'` or `'unreachable: <sanitised>'`). Mirrors the Story 13.1
 * `TemporalHealthIndicator` graceful-degradation pattern. `/health` MUST stay
 * HTTP 200 regardless of MemU availability — Terminus 503s the response when
 * any indicator returns `false`, and Decision D forbids that.
 */
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { firstValueFrom } from 'rxjs';
import { AppConfigService } from 'src/shared/config/config.service';

const PROBE_TIMEOUT_MS = 2_000;
const REASON_MAX_LENGTH = 120;

@Injectable()
export class MemuHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(MemuHealthIndicator.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly appConfig: AppConfigService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await firstValueFrom(
        this.httpService.head(this.appConfig.memuApiUrl, {
          timeout: PROBE_TIMEOUT_MS,
          // Treat any 2xx/3xx as reachable; MemU might 405 on HEAD but we want
          // server-replied 4xx to be reported as unreachable to operators.
          validateStatus: (status) => status >= 200 && status < 400,
        }),
      );
      this.logger.log({
        message: 'memu health probe reachable',
        event: 'memuHealth.probe.completed',
      });
      return this.getStatus(key, true, { message: 'reachable' });
    } catch (err) {
      const reason = sanitise(err);
      this.logger.warn({
        message: 'memu health probe unreachable',
        event: 'memuHealth.probe.failed',
        reason,
      });
      return this.getStatus(key, true, { message: `unreachable: ${reason}` });
    }
  }
}

function sanitise(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const errnoCode = (err as NodeJS.ErrnoException).code;
    if (typeof errnoCode === 'string' && errnoCode.length > 0) {
      return truncate(errnoCode);
    }
    const status = (err as { response?: { status?: number } }).response?.status;
    if (typeof status === 'number') {
      return truncate(`http_${status}`);
    }
    const message = (err as Error).message;
    if (typeof message === 'string' && message.length > 0) {
      return truncate(message);
    }
  }
  return 'unknown';
}

function truncate(s: string): string {
  return s.length > REASON_MAX_LENGTH ? s.slice(0, REASON_MAX_LENGTH) : s;
}
