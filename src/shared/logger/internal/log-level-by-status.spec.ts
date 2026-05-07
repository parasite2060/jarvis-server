import { logLevelByStatus } from './log-level-by-status';

describe('logLevelByStatus', () => {
  it.each([
    [200, 'log'],
    [201, 'log'],
    [301, 'log'],
    [399, 'log'],
    [400, 'warn'],
    [404, 'warn'],
    [422, 'warn'],
    [499, 'warn'],
    [500, 'error'],
    [503, 'error'],
    [599, 'error'],
  ])('status %i → %s', (status, expected) => {
    expect(logLevelByStatus(status)).toBe(expected);
  });
});
