/**
 * ConversationController — POST /conversations + GET /conversations/position.
 *
 * Two Python-contract details drive the unusual shape of this controller:
 *
 *   1. **HTTP-200-on-duplicate vs HTTP-202-on-new** (Python `conversations.py`
 *      lines 68 / 134) — the use case returns `{ httpStatus, body }` and the
 *      controller uses `@Res({ passthrough: true })` to set the status while
 *      still letting NestJS run interceptors and serialization on the body
 *      (Story 13.3 / Q9). New business modules with branched status follow
 *      this pattern.
 *
 *   2. **GET position returns a RAW object** (Python returns `dict`, no
 *      Pydantic envelope; `app/api/routes/conversations.py:42`). The plugin's
 *      `worker/conversation-drain.js :: fetchLastPosition` reads
 *      `body.last_line` AT THE TOP LEVEL — wrapping in `HttpApiResponse.success`
 *      would break MC1 byte-equivalence (plugin would see `body.last_line ===
 *      undefined` and refetch the full transcript every time). The endpoint
 *      therefore returns `PositionPresenter` directly. POST `/conversations`
 *      is fine to wrap because the plugin only checks `res.ok` for that call.
 */
import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { IngestTranscriptRequest } from './models/requests/ingest-transcript.request';
import { GetPositionRequest } from './models/requests/get-position.request';
import { IngestTranscriptResponse } from './models/responses/ingest-transcript.response';
import { PositionPresenter } from './models/presenters/position.presenter';
import { IngestTranscriptUseCase } from './usecases/ingest-transcript.usecase';
import { GetPositionUseCase } from './usecases/get-position.usecase';

@Controller()
export class ConversationController {
  constructor(
    private readonly ingestUseCase: IngestTranscriptUseCase,
    private readonly getPositionUseCase: GetPositionUseCase,
  ) {}

  @Post('conversations')
  async ingest(
    @Body() request: IngestTranscriptRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HttpApiResponse<IngestTranscriptResponse>> {
    const result = await this.ingestUseCase.execute(request);
    res.status(result.httpStatus);
    return HttpApiResponse.success(result.body);
  }

  @Get('conversations/position')
  async getPosition(@Query() request: GetPositionRequest): Promise<PositionPresenter> {
    return this.getPositionUseCase.execute(request);
  }
}
