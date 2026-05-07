import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfigService } from 'src/shared/config/config.service';
import { IMemuApi, MEMU_API, MemuMessage } from 'src/shared/domain/apis/memu-api.interface';
import { AddMemoryRequest } from '../models/requests/add-memory.request';
import { AddMemoryResponse } from '../models/responses/add-memory.response';

@Injectable()
export class AddMemoryUseCase {
  private readonly logger = new Logger(AddMemoryUseCase.name);

  // Q5 binding: NO TemporalClientService — synchronous HTTP 200, no Temporal scheduling.
  // Q6 binding: NO SecretScrubberService — caller-curated content; scrubbing would corrupt
  //             user-intended memorization (matches Python `memory.py:196-222`).
  constructor(
    @Inject(MEMU_API) private readonly memuApi: IMemuApi,
    private readonly appConfig: AppConfigService,
  ) {}

  async execute(request: AddMemoryRequest): Promise<AddMemoryResponse> {
    const messages = this.buildMessages(request);
    const idempotencyKey = this.computeIdempotencyKey(messages);
    const result = await this.memuApi.memorize(messages, {
      userId: this.appConfig.memuUserId,
      agentId: this.appConfig.memuAgentId,
      idempotencyKey,
    });
    const memoryId = result.task_id ?? '';
    this.logger.log({
      message: 'memory add completed',
      event: 'memory.add.completed',
      contentLength: request.content.length,
      memory_id: memoryId,
    });
    return new AddMemoryResponse(memoryId, 'accepted');
  }

  // Mirrors Python memory.py:198-201 exactly.
  private buildMessages(request: AddMemoryRequest): MemuMessage[] {
    const messages: MemuMessage[] = [];
    const ctx = request.metadata?.['context'];
    if (typeof ctx === 'string' && ctx.length > 0) {
      messages.push({ role: 'system', content: ctx });
    }
    messages.push({ role: 'user', content: request.content });
    return messages;
  }

  // Q7: deterministic from request payload — duplicate retries hit MemU's idempotency
  // store. 16 hex chars = 64 bits of entropy, sufficient for collision resistance.
  private computeIdempotencyKey(messages: MemuMessage[]): string {
    const digest = createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 16);
    return `mem-add-${digest}`;
  }
}
