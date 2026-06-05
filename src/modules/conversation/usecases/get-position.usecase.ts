import { Inject, Injectable } from '@nestjs/common';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { GetPositionRequest } from '../models/requests/get-position.request';
import { PositionPresenter } from '../models/presenters/position.presenter';

@Injectable()
export class GetPositionUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly repository: IConversationRepository,
  ) {}

  // Python conversations.py:29-42 — always returns 200 with last_line: 0
  // when no qualifying row exists (the plugin's "send full transcript" signal).
  async execute(request: GetPositionRequest): Promise<PositionPresenter> {
    const lastLine = await this.repository.getLastProcessedLine(request.sessionId);
    return new PositionPresenter(request.sessionId, lastLine);
  }
}
