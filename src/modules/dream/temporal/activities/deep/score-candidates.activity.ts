import { Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';
import { calculateCandidateScore } from '../../../scoring/calculate-candidate-score';
import type { ScoredCandidatesResult, ScoringInput } from '../../workflows/deep-dream.workflow';

@Injectable()
export class ScoreCandidatesActivity {
  private readonly logger = new Logger(ScoreCandidatesActivity.name);

  constructor(private readonly config: AppConfigService) {}

  @TemporalActivity('deep.score_candidates')
  async scoreCandidates(inp: ScoringInput): Promise<ScoredCandidatesResult> {
    try {
      const weights = this.config.scoringWeights;
      const decayRate = this.config.scoringDecayRate;
      const scored = inp.candidates_json.map((candidate) => {
        const reinforcement = typeof candidate['reinforcement_count'] === 'number' ? candidate['reinforcement_count'] : 0;
        const sourceSessions = Array.isArray(candidate['source_sessions']) ? candidate['source_sessions'] : [];
        const contradiction = candidate['contradiction_flag'] === true;
        const score = calculateCandidateScore(
          {
            reinforcement_count: reinforcement,
            days_since_reinforced: 0,
            in_active_project: true,
            has_contradiction: contradiction,
            context_count: sourceSessions.length,
          },
          { weights, decay_rate: decayRate },
        );
        return { ...candidate, score: Math.round(score * 10000) / 10000 };
      });
      this.logger.log({
        message: 'deep dream score_candidates completed',
        event: 'deepDream.scoreCandidates.completed',
        dreamId: inp.dream_id,
        scoredCount: scored.length,
      });
      return { scored };
    } catch (err) {
      throw new InternalException(ErrorCode.DEEP_DREAM_SCORING_FAILED, `scoreCandidates failed: ${(err as Error).message}`);
    }
  }
}
