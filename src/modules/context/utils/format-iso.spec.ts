import { formatPythonIso } from './format-iso';

describe('formatPythonIso', () => {
  it('converts millisecond toISOString output to Python-ISO with 6-digit micros and +00:00 suffix', () => {
    // Arrange
    const d = new Date('2026-05-08T13:00:00.123Z');

    // Act
    const result = formatPythonIso(d);

    // Assert
    expect(result).toBe('2026-05-08T13:00:00.123000+00:00');
  });

  it('handles zero-millisecond edge — pads with .000000+00:00', () => {
    // Arrange
    const d = new Date('2026-05-08T13:00:00.000Z');

    // Act
    const result = formatPythonIso(d);

    // Assert
    expect(result).toBe('2026-05-08T13:00:00.000000+00:00');
  });
});
