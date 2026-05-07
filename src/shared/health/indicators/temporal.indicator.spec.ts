import { TemporalHealthIndicator } from './temporal.indicator';

describe('TemporalHealthIndicator', () => {
  let target: TemporalHealthIndicator;

  beforeEach(() => {
    target = new TemporalHealthIndicator();
  });

  describe('isHealthy', () => {
    it('should return up with not-yet-bootstrapped marker', () => {
      // Arrange
      const key = 'temporal';

      // Act
      const result = target.isHealthy(key);

      // Assert
      expect(result).toEqual({
        temporal: { status: 'up', message: 'not-yet-bootstrapped' },
      });
    });

    it('should not throw', () => {
      // Arrange / Act / Assert
      expect(() => target.isHealthy('any-key')).not.toThrow();
    });
  });
});
