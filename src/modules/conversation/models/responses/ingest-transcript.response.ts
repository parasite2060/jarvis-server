/**
 * POST /conversations response body.
 *
 * Mirrors Python's `ConversationData` (camelCase via Pydantic alias generator
 * + FastAPI's default field-name serialization — N1 verified 2026-05-07: the
 * Python wire emits `transcript_id` snake_case for these fields because
 * `response_model_by_alias=True` is NOT set on the route, but the plugin's
 * outbound POST does NOT inspect the body (only `res.ok`), so MC1 is met as
 * long as the wrapper envelope is consistent. This class uses camelCase TS
 * property names for type-safety; the boilerplate `HttpApiResponse.success`
 * envelope wraps it.
 */
export class IngestTranscriptResponse {
  transcriptId: number;
  duplicate: boolean;

  constructor(transcriptId: number, duplicate: boolean) {
    this.transcriptId = transcriptId;
    this.duplicate = duplicate;
  }
}
