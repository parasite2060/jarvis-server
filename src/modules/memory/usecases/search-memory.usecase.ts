import { Inject, Injectable, Logger } from '@nestjs/common';
import { IMemuApi, MEMU_API } from 'src/shared/domain/apis/memu-api.interface';
import { SearchMemoryRequest } from '../models/requests/search-memory.request';
import { SearchMemoryResponse, SearchResult } from '../models/responses/search-memory.response';

@Injectable()
export class SearchMemoryUseCase {
  private readonly logger = new Logger(SearchMemoryUseCase.name);

  constructor(@Inject(MEMU_API) private readonly memuApi: IMemuApi) {}

  // No try/catch — MemuError / MemuUnavailableError bubble to global filters
  // (Decision B / boilerplate error-handling.md).
  async execute(request: SearchMemoryRequest): Promise<SearchMemoryResponse> {
    const memuResponse = await this.memuApi.retrieve(request.query, request.method);
    const results: SearchResult[] = (memuResponse.memories ?? []).map((m) => ({
      content: m.content,
      relevance: m.relevance,
      source: m.source,
      metadata: m.metadata,
    }));
    this.logger.log({
      message: 'memory search completed',
      event: 'memory.search.completed',
      queryLength: request.query.length,
      resultCount: results.length,
    });
    return new SearchMemoryResponse({ results, query: request.query, method: request.method });
  }
}
