/**
 * Format a Date as Python's `datetime.now(tz=UTC).isoformat()` — Story 13.5 / Q8.
 *
 * Python emits e.g. '2026-05-08T13:00:00.123456+00:00' (6-digit microseconds
 * + literal `+00:00` suffix). TS native `toISOString()` produces
 * '2026-05-08T13:00:00.123Z' (3-digit milliseconds + `Z`). Different format.
 *
 * MC5 byte-equivalence: match Python's format even though the plugin doesn't
 * currently read `assembled_at`. Future plugin reads must not be surprised.
 *
 * Note: JS `Date` has only millisecond precision, so we pad with `'000'` to
 * synthesise the Python 6-digit micros field (matches Python's default when a
 * datetime carries integer-millisecond precision — e.g. from Unix-epoch input).
 */
export function formatPythonIso(d: Date): string {
  const iso = d.toISOString(); // '2026-05-08T13:00:00.123Z'
  return iso.replace(/\.(\d{3})Z$/, '.$1000+00:00');
}
