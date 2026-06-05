import { weekIso } from './iso-week';

describe('weekIso', () => {
  // Year-boundary cases — primary correctness target per Story 13.12 / Q5.
  it('2025-12-29 (Mon) → 2026-W01 (ISO week year crosses calendar year)', () => {
    expect(weekIso('2025-12-29')).toBe('2026-W01');
  });

  it('2026-01-01 (Thu) → 2026-W01', () => {
    expect(weekIso('2026-01-01')).toBe('2026-W01');
  });

  it('2025-12-22 (Mon) → 2025-W52', () => {
    expect(weekIso('2025-12-22')).toBe('2025-W52');
  });

  it('2026-05-04 (Mon) → 2026-W19 (mid-year sanity check)', () => {
    expect(weekIso('2026-05-04')).toBe('2026-W19');
  });

  it('zero-pads single-digit week numbers', () => {
    expect(weekIso('2026-01-05')).toBe('2026-W02');
  });

  it('throws on invalid ISO date input', () => {
    expect(() => weekIso('not-a-date')).toThrow(/Invalid weekStartIso/);
  });

  it('throws on empty string', () => {
    expect(() => weekIso('')).toThrow(/Invalid weekStartIso/);
  });
});
