/**
 * MemU HTTP client (Story 13.4 / AC #7).
 *
 * Implements `IMemuApi` over `@nestjs/axios` `HttpService`. Mirrors Python
 * `app/services/memu_client.py` — same endpoints (`/retrieve`, `/memorize`),
 * same body shapes, same 10s timeout, same error semantics.
 *
 * Retry policy (Q7 retry path): 5xx triggers up to 3 retries with exponential
 * backoff (250 ms → 500 ms → 1000 ms — first delay short to keep within Python's
 * effective ~10s overall budget). 4xx fails fast. Network errors / timeouts
 * map to `MemuUnavailableError` immediately (Python parity — `memu_client.py:49-51`
 * raises on `httpx.ConnectError | httpx.TimeoutException`).
 *
 * `Idempotency-Key` header is forwarded ONLY for writes (Q7) — `memorize` accepts
 * `opts.idempotencyKey`; `retrieve` is read-only and never sends one.
 *
 * `user_id` / `agent_id` defaults pulled from `AppConfigService` (Q11) — the env
 * vars `MEMU_USER_ID` / `MEMU_AGENT_ID` default to `'jarvis'` / `'claude'` to
 * match Python `memu_client.py:64-65`.
 *
 * Why try/catch here (vs. usecases.md "no try-catch"): this is an INFRASTRUCTURE
 * boundary that translates raw HTTP failures into the typed exception hierarchy
 * use cases consume. error-handling.md explicitly permits try/catch at API-client
 * boundaries — it is the BUSINESS logic (use cases) that must let errors bubble.
 */
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AxiosError, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { AppConfigService } from 'src/shared/config/config.service';
import { IMemuApi, MemuMemorizeOptions, MemuMemorizeResult, MemuMessage, MemuRetrieveResult } from 'src/shared/domain/apis/memu-api.interface';
import { MemuError, MemuUnavailableError } from '../errors/memu.errors';

const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS: readonly number[] = [250, 500, 1000];

@Injectable()
export class MemuApiService implements IMemuApi {
  private readonly logger = new Logger(MemuApiService.name);

  constructor(
    @Inject(HttpService) private readonly httpService: HttpService,
    private readonly appConfig: AppConfigService,
  ) {}

  async retrieve(query: string, method: string = 'rag'): Promise<MemuRetrieveResult> {
    const response = await this.executeWithRetry<MemuRetrieveResult>(
      'retrieve',
      () =>
        firstValueFrom(
          this.httpService.post<MemuRetrieveResult>(
            '/retrieve',
            { query },
            {
              baseURL: this.appConfig.memuApiUrl,
              timeout: REQUEST_TIMEOUT_MS,
            },
          ),
        ),
      { queryLength: query.length },
    );
    this.logger.log({
      message: 'memu retrieve completed',
      event: 'memuClient.retrieve.completed',
      queryLength: query.length,
      method,
      resultCount: response.memories?.length ?? 0,
    });
    return response;
  }

  async memorize(messages: MemuMessage[], opts: MemuMemorizeOptions = {}): Promise<MemuMemorizeResult> {
    const userId = opts.userId ?? this.appConfig.memuUserId;
    const agentId = opts.agentId ?? this.appConfig.memuAgentId;
    const headers: Record<string, string> = {};
    if (opts.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }
    const response = await this.executeWithRetry<MemuMemorizeResult>(
      'memorize',
      () =>
        firstValueFrom(
          this.httpService.post<MemuMemorizeResult>(
            '/memorize',
            { conversation: messages, user_id: userId, agent_id: agentId },
            {
              baseURL: this.appConfig.memuApiUrl,
              timeout: REQUEST_TIMEOUT_MS,
              headers,
            },
          ),
        ),
      { messageCount: messages.length },
    );
    this.logger.log({
      message: 'memu memorize completed',
      event: 'memuClient.memorize.completed',
      messageCount: messages.length,
      memory_id: response.task_id ?? '',
    });
    return response;
  }

  // 5xx → retry with exponential backoff up to RETRY_DELAYS_MS.length attempts.
  // 4xx → MemuError immediately. Network/timeout → MemuUnavailableError immediately.
  private async executeWithRetry<T>(
    op: 'retrieve' | 'memorize',
    request: () => Promise<AxiosResponse<T>>,
    logContext: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await request();
        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError;
        const statusCode = axiosError.response?.status;
        if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
          this.logger.error({
            message: 'memu client 4xx — failing fast',
            event: `memuClient.${op}.failed`,
            statusCode,
            ...logContext,
          });
          const detail = this.extractDetail(axiosError);
          throw new MemuError(statusCode, detail);
        }
        if (statusCode !== undefined && statusCode >= 500 && attempt < RETRY_DELAYS_MS.length) {
          await delay(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        if (statusCode !== undefined) {
          this.logger.error({
            message: 'memu client 5xx exhausted',
            event: `memuClient.${op}.unavailable`,
            statusCode,
            ...logContext,
          });
          throw new MemuUnavailableError(this.extractDetail(axiosError));
        }
        this.logger.error({
          message: 'memu client transport failure',
          event: `memuClient.${op}.unavailable`,
          reason: axiosError.code ?? 'unknown',
          ...logContext,
        });
        throw new MemuUnavailableError(axiosError.message || 'MemU transport failure');
      }
    }
    // Unreachable — the loop either returns or throws on the final attempt.
    throw new MemuUnavailableError('memu retry loop exhausted');
  }

  private extractDetail(error: AxiosError): string {
    const data = error.response?.data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      try {
        return JSON.stringify(data);
      } catch {
        return error.message || 'unknown';
      }
    }
    return error.message || 'unknown';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
