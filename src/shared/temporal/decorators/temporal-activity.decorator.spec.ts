import 'reflect-metadata';
import { TEMPORAL_ACTIVITY_METADATA, TemporalActivity, TemporalActivityMeta } from './temporal-activity.decorator';

describe('TemporalActivity decorator', () => {
  it('uses the method name when no explicit name is provided', () => {
    // Arrange
    class Sample {
      @TemporalActivity()
      async runRecord(): Promise<void> {
        return;
      }
    }

    // Act
    const meta = Reflect.getMetadata(TEMPORAL_ACTIVITY_METADATA, Sample.prototype, 'runRecord') as TemporalActivityMeta;

    // Assert
    expect(meta).toEqual({ name: 'runRecord' });
  });

  it('uses the explicit name when provided', () => {
    // Arrange
    class Sample {
      @TemporalActivity('loadTranscript')
      async someMethod(): Promise<void> {
        return;
      }
    }

    // Act
    const meta = Reflect.getMetadata(TEMPORAL_ACTIVITY_METADATA, Sample.prototype, 'someMethod') as TemporalActivityMeta;

    // Assert
    expect(meta).toEqual({ name: 'loadTranscript' });
  });

  it('does NOT set metadata on undecorated methods', () => {
    // Arrange
    class Sample {
      async plain(): Promise<void> {
        return;
      }
    }

    // Act
    const meta = Reflect.getMetadata(TEMPORAL_ACTIVITY_METADATA, Sample.prototype, 'plain');

    // Assert
    expect(meta).toBeUndefined();
  });
});
