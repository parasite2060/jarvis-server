import { GatherInputsActivity } from './gather-inputs.activity';
import { RunPhase1LightSleepActivity } from './run-phase1-light-sleep.activity';
import { ScoreCandidatesActivity } from './score-candidates.activity';
import { RunPhase2RemSleepActivity } from './run-phase2-rem-sleep.activity';
import { RunPhase3DeepSleepActivity } from './run-phase3-deep-sleep.activity';
import { RunHealthCheckActivity } from './run-health-check.activity';
import { RunHealthFixActivity } from './run-health-fix.activity';
import { WriteFilesActivity } from './write-files.activity';
import { DeepCommitAndPrActivity } from './commit-and-pr.activity';
import { AlignMemuActivity } from './align-memu.activity';
import { DeepInvalidateContextCacheActivity } from './invalidate-context-cache.activity';
import { MarkDeepDreamOutcomeActivity } from './mark-deep-dream-outcome.activity';

export const Activities = [
  GatherInputsActivity,
  RunPhase1LightSleepActivity,
  ScoreCandidatesActivity,
  RunPhase2RemSleepActivity,
  RunPhase3DeepSleepActivity,
  RunHealthCheckActivity,
  RunHealthFixActivity,
  WriteFilesActivity,
  DeepCommitAndPrActivity,
  AlignMemuActivity,
  DeepInvalidateContextCacheActivity,
  MarkDeepDreamOutcomeActivity,
];
