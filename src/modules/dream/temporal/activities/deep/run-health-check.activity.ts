import { Injectable, Logger } from '@nestjs/common';
import { TemporalActivity } from 'src/shared/temporal/decorators/temporal-activity.decorator';
import { AppConfigService } from 'src/shared/config/config.service';
import type { HealthCheckInput, HealthReportResult } from '../../workflows/deep-dream.workflow';
import { runHealthChecks } from './_health-helpers';

@Injectable()
export class RunHealthCheckActivity {
  private readonly logger = new Logger(RunHealthCheckActivity.name);

  constructor(private readonly config: AppConfigService) {}

  @TemporalActivity('deep.health_check')
  async runHealthCheck(inp: HealthCheckInput): Promise<HealthReportResult> {
    const report = await runHealthChecks(this.config.vaultPath, inp.knowledge_gap_names);
    this.logger.log({
      message: 'deep dream health_check completed',
      event: 'deepDream.healthCheck.completed',
      dreamId: inp.dream_id,
      totalIssues: report.total_issues,
      orphanCount: report.orphan_notes.length,
      staleCount: report.stale_notes.length,
      missingFrontmatterCount: report.missing_frontmatter.length,
      contradictionsCount: report.unresolved_contradictions.length,
      memoryOverflow: report.memory_overflow,
      missingBacklinksCount: report.missing_backlinks.length,
      unclassifiedLessonsCount: report.unclassified_lessons.length,
      brokenWikilinksCount: report.broken_wikilinks.length,
    });
    return {
      report_json: report as unknown as Record<string, unknown>,
      total_issues: report.total_issues,
    };
  }
}
