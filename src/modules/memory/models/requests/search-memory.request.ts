/**
 * POST /memory/search request body (Story 13.4 / AC #2).
 *
 * Wire format: snake_case (Q4) — but `query` and `method` are single words so
 * camelCase / snake_case collapse identically. Mirrors Python `MemorySearchRequest`.
 */
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ErrorCode } from 'src/utils/error.code';

export class SearchMemoryRequest {
  @IsNotEmpty({ context: { code: ErrorCode.MEMORY_QUERY_INVALID, message: 'query is required' } })
  @IsString({ context: { code: ErrorCode.MEMORY_QUERY_INVALID, message: 'query must be string' } })
  query!: string;

  @IsOptional()
  @IsString({ context: { code: ErrorCode.MEMORY_METHOD_INVALID, message: 'method must be string' } })
  method: string = 'rag';
}
