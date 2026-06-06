import * as fs from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import { safeResolveVaultPath } from 'src/shared/utils/path-validation';
import type { CleanupTranscriptInput } from '../../workflows/light-dream.workflow';

@Injectable()
export class CleanupTranscriptActivity {
  private readonly logger = new Logger(CleanupTranscriptActivity.name);

  constructor(private readonly config: AppConfigService) {}

  @TemporalActivity('light.cleanup_transcript')
  async cleanupTranscript(inp: CleanupTranscriptInput): Promise<void> {
    if (inp.transcript_file === null || inp.transcript_file === '') return;
    const abs = safeResolveVaultPath(this.config.vaultPath, inp.transcript_file);
    if (abs === null) return;
    try {
      await fs.rm(abs, { force: true });
      this.logger.log({
        message: 'light dream transcript cleaned up',
        event: 'lightDream.cleanupTranscript.completed',
        transcriptFile: inp.transcript_file,
      });
    } catch {
      this.logger.warn({
        message: 'light dream transcript cleanup failed (ignored)',
        event: 'lightDream.cleanupTranscript.failed',
        transcriptFile: inp.transcript_file,
      });
    }
  }
}
