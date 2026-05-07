import { countTokensApproximate, parseTranscript } from './transcript-parser.util';

describe('transcript-parser.util (stub)', () => {
  describe('parseTranscript', () => {
    it('should return the input unchanged (identity stub)', () => {
      // Arrange
      const input = 'a multi-line\ntranscript string';

      // Act
      const result = parseTranscript(input);

      // Assert
      expect(result).toBe(input);
    });
  });

  describe('countTokensApproximate', () => {
    it('should approximate tokens as ceil(length / 4)', () => {
      // Arrange / Act / Assert
      expect(countTokensApproximate('')).toBe(0);
      expect(countTokensApproximate('abcd')).toBe(1);
      expect(countTokensApproximate('abcde')).toBe(2);
    });
  });
});
