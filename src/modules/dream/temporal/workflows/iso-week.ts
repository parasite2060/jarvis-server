/**
 * ISO-week helper (Story 13.12 / Task 2).
 *
 * Mirrors Python `weekly_review_workflow.py:43-46` `_week_number(week_start_iso)`
 * which uses `date.fromisoformat(...).isocalendar()` (the canonical ISO 8601
 * week computation). The TS port uses Luxon's `.weekYear` + `.weekNumber`
 * which is the equivalent ISO-week-year computation; native JS `Date` does
 * NOT safely handle the year-boundary case (e.g., 2025-12-29 (Mon) belongs
 * to ISO week 2026-W01, but `Date.getFullYear()` returns 2025).
 *
 * # Sandbox safety
 *   This file is imported by `weekly-review.workflow.ts` (sandbox-clean).
 *   Per `design/temporal-workflows.md §6.5`, pure data manipulation +
 *   pure-function imports are sandbox-safe. Luxon's `DateTime.fromISO` does
 *   no I/O, no clock reads, no random — it's a pure parse + arithmetic.
 *
 * # Q5 RESOLVED 2026-05-08: use `.weekYear` not `.year`
 *   Python's `isocalendar()` returns `(iso_year, iso_week, iso_weekday)`
 *   where `iso_year` is the ISO-week year. Luxon's `DateTime.year` is the
 *   calendar year (could mismatch on year-boundary weeks); `.weekYear`
 *   matches Python's first tuple element.
 */
import { DateTime } from 'luxon';

/**
 * Returns the ISO-8601 week designator for the given week-start ISO date.
 * Format: `YYYY-Www` (e.g., `2026-W19`).
 *
 * @throws Error when `weekStartIso` is not a valid ISO date string.
 */
export function weekIso(weekStartIso: string): string {
  const dt = DateTime.fromISO(weekStartIso, { zone: 'utc' });
  if (!dt.isValid) {
    throw new Error(`Invalid weekStartIso: ${weekStartIso}`);
  }
  const week = String(dt.weekNumber).padStart(2, '0');
  return `${dt.weekYear}-W${week}`;
}
