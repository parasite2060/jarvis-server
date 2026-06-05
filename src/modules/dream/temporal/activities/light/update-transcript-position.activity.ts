import { Inject, Injectable } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { CONVERSATION_REPOSITORY, IConversationRepository } from 'src/shared/domain/repositories/conversation.repository.interface';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import type { UpdatePositionInput } from '../../workflows/light-dream.workflow';

@Injectable()
export class UpdateTranscriptPositionActivity {
  constructor(@Inject(CONVERSATION_REPOSITORY) private readonly conversationRepo: IConversationRepository) {}

  @TemporalActivity('light.update_transcript_position')
  async updateTranscriptPosition(inp: UpdatePositionInput): Promise<void> {
    try {
      await this.conversationRepo.updatePosition(inp.transcript_id, 'processed', inp.segment_end_line);
    } catch (err) {
      throw new InternalException(ErrorCode.LIGHT_DREAM_UPDATE_POSITION_FAILED, `updatePosition failed: ${(err as Error).message}`);
    }
  }
}
