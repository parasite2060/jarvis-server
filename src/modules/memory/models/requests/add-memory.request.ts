/**
 * POST /memory/add request body (Story 13.4 / AC #4).
 *
 * Mirrors Python `MemoryAddRequest`. `metadata.context` (optional string) becomes a
 * leading `system` message in the MemU `messages` array (memory.py:198-201).
 */
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ErrorCode } from 'src/utils/error.code';

export class AddMemoryRequest {
  @IsNotEmpty({ context: { code: ErrorCode.MEMORY_CONTENT_INVALID, message: 'content is required' } })
  @IsString({ context: { code: ErrorCode.MEMORY_CONTENT_INVALID, message: 'content must be string' } })
  content!: string;

  @IsOptional()
  @IsObject({ context: { code: ErrorCode.MEMORY_METADATA_INVALID, message: 'metadata must be object' } })
  metadata?: Record<string, unknown>;
}
