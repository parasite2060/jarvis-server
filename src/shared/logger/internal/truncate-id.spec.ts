import { truncateId, withTruncation } from './truncate-id';

describe('truncateId', () => {
  it('should return the original id when shorter than max', () => {
    expect(truncateId('abc', 16)).toBe('abc');
  });

  it('should return the original id when exactly at max length', () => {
    expect(truncateId('abcdef', 6)).toBe('abcdef');
  });

  it('should keep the trailing N chars when longer than max', () => {
    expect(truncateId('1234567890abcdef', 8)).toBe('90abcdef');
  });

  it('should pass through empty strings', () => {
    expect(truncateId('', 16)).toBe('');
  });
});

describe('withTruncation', () => {
  it('should wrap a generator and truncate its output', () => {
    const wrapped = withTruncation(() => '1234567890abcdef', 6);

    expect(wrapped()).toBe('abcdef');
  });

  it('should forward all arguments to the wrapped generator', () => {
    const inner = jest.fn((a: string, b: number) => `${a}-${b}-extra-padding-padding`);
    const wrapped = withTruncation(inner, 8);

    const result = wrapped('foo', 42);

    expect(inner).toHaveBeenCalledWith('foo', 42);
    expect(result).toBe(result.substring(result.length - 8));
  });
});
