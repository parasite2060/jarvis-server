import { SecretScrubberService } from './secret-scrubber.service';

describe('SecretScrubberService (stub)', () => {
  let target: SecretScrubberService;

  beforeEach(() => {
    target = new SecretScrubberService();
  });

  it('should return the input unchanged with empty redaction counts (pass-through stub)', () => {
    // Arrange
    const input = 'sk-test-1234567890 plus some normal text';

    // Act
    const result = target.scrub(input);

    // Assert
    expect(result.scrubbed).toBe(input);
    expect(result.redactionCounts).toEqual({});
  });
});
