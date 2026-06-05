/**
 * Unit tests for the `_isoMonday` helper in `schedule-signal-relay.workflow.ts`.
 *
 * The workflow body itself signals via `getExternalWorkflowHandle` and
 * requires a Temporal Test Workflow Environment to exercise — covered by
 * the e2e spec when Temporalite Schedule support is verified (Q9).
 *
 * The pure helper `_isoMonday` is sandbox-clean and testable directly.
 * Q8: Python `weekday()` (Mon=0..Sun=6) vs JS `getUTCDay()` (Sun=0..Sat=6)
 * conversion `(jsDow + 6) % 7` must produce the same ISO Monday for any
 * input.
 */
import { _isoMonday } from './schedule-signal-relay.workflow';

describe('_isoMonday (Q8 weekday conversion)', () => {
  it('returns the input when input is a Monday', () => {
    // Arrange — 2026-05-04 is a Monday
    const monday = new Date('2026-05-04T00:00:00Z');

    // Act
    const result = _isoMonday(monday);

    // Assert
    expect(result).toBe('2026-05-04');
  });

  it('returns the previous Monday when input is a Sunday (JS getUTCDay=0 → Python weekday=6)', () => {
    // Arrange — 2026-05-10 is a Sunday; previous Monday is 2026-05-04
    const sunday = new Date('2026-05-10T00:00:00Z');

    // Act
    const result = _isoMonday(sunday);

    // Assert
    expect(result).toBe('2026-05-04');
  });

  it('returns the previous Monday when input is a Saturday (JS getUTCDay=6 → Python weekday=5)', () => {
    // Arrange — 2026-05-09 is a Saturday; previous Monday is 2026-05-04
    const saturday = new Date('2026-05-09T00:00:00Z');

    // Act
    const result = _isoMonday(saturday);

    // Assert
    expect(result).toBe('2026-05-04');
  });

  it('returns the previous Monday when input is a Wednesday', () => {
    // Arrange — 2026-05-06 is a Wednesday
    const wednesday = new Date('2026-05-06T00:00:00Z');

    // Act
    const result = _isoMonday(wednesday);

    // Assert
    expect(result).toBe('2026-05-04');
  });

  it('handles month boundary crossings — Sunday 2026-04-05 → Monday 2026-03-30', () => {
    // Arrange — 2026-04-05 is a Sunday
    const sunday = new Date('2026-04-05T00:00:00Z');

    // Act
    const result = _isoMonday(sunday);

    // Assert
    expect(result).toBe('2026-03-30');
  });
});
