/**
 * Health-summary integration helpers — Story 13.5 / Q9.
 *
 * Mirrors Python `app/services/context_assembly.py:40-83`:
 *   - `getLatestHealthReport()` reads the latest completed deep-dream's
 *     `output_raw`, regex-extracts `health_report=<json>`, JSON-parses, and
 *     Zod-validates. Returns null on any failure (soft-fail mirrors Python's
 *     bare `except Exception` at line 59).
 *   - `formatHealthSummary(report)` builds the comma-joined issues string and
 *     prefixes the UTF-8 warning sign `⚠`. Returns `''` for zero issues.
 *
 * Story 13.11 (deep-dream Phase 3) will start writing `health_report=...` into
 * `output_raw`. Until then, this returns null in production and the
 * `## VAULT HEALTH` section is silently omitted from the assembled context.
 */
import { Logger } from '@nestjs/common';
import { IDreamRepository } from 'src/shared/domain/repositories/dream.repository.interface';
import { HealthReport, HealthReportSchema } from './models/health-report.interface';

const HEALTH_REPORT_PATTERN = /health_report=(\{.*\})/;

export async function getLatestHealthReport(dreamRepo: IDreamRepository, logger: Logger): Promise<HealthReport | null> {
  try {
    const dream = await dreamRepo.findLatestCompletedDeep();
    if (!dream?.outputRaw) {
      return null;
    }
    const match = HEALTH_REPORT_PATTERN.exec(dream.outputRaw);
    if (!match) {
      return null;
    }
    const parsed: unknown = JSON.parse(match[1]!);
    return HealthReportSchema.parse(parsed);
  } catch (err) {
    logger.warn({
      message: 'health report extraction failed',
      event: 'context.healthReport.failed',
      error: sanitiseError(err),
    });
    return null;
  }
}

export function formatHealthSummary(report: HealthReport): string {
  const issues: string[] = [];
  if (report.orphan_notes.length > 0) {
    issues.push(`${report.orphan_notes.length} orphan notes`);
  }
  if (report.stale_notes.length > 0) {
    issues.push(`${report.stale_notes.length} stale notes`);
  }
  if (report.unresolved_contradictions.length > 0) {
    issues.push(`${report.unresolved_contradictions.length} unresolved contradictions`);
  }
  if (report.missing_frontmatter.length > 0) {
    issues.push(`${report.missing_frontmatter.length} missing frontmatter`);
  }
  if (report.memory_overflow) {
    issues.push('MEMORY.md approaching overflow');
  }
  if (report.knowledge_gaps.length > 0) {
    issues.push(`${report.knowledge_gaps.length} knowledge gaps`);
  }
  if (issues.length === 0) {
    return '';
  }
  return `⚠ Vault health: ${issues.join(', ')}`;
}

function sanitiseError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return 'unknown';
}
