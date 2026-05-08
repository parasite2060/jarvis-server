/**
 * Unit specs for `ActivityRegistry` (Story 13.8).
 *
 * Uses a real NestJS TestingModule with deliberately decorated providers so
 * the DiscoveryService walk runs against actual reflect-metadata. Covers
 * per AC #14:
 *   - non-empty providers → flat activity map with bound `this`
 *   - empty providers → `{}`
 *   - duplicate activity name → throws
 */
import 'reflect-metadata';
import { Injectable, Logger, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ActivityRegistry } from './activity-registry.service';
import { TemporalActivity } from './decorators/temporal-activity.decorator';
import { ErrorCode } from 'src/utils/error.code';

@Injectable()
class StubActivities {
  private readonly tag = 'stub';

  @TemporalActivity('explicit.name')
  async withExplicitName(input: { value: number }): Promise<{ tag: string; value: number }> {
    return { tag: this.tag, value: input.value };
  }

  @TemporalActivity()
  async defaultName(): Promise<string> {
    return this.tag;
  }

  async undecorated(): Promise<void> {
    // Should not appear in the registry.
  }
}

@Module({ providers: [StubActivities] })
class StubActivitiesModule {}

@Injectable()
class DuplicateA {
  @TemporalActivity('dup.name')
  async first(): Promise<string> {
    return 'a';
  }
}

@Injectable()
class DuplicateB {
  @TemporalActivity('dup.name')
  async second(): Promise<string> {
    return 'b';
  }
}

@Module({ providers: [DuplicateA, DuplicateB] })
class DuplicateModule {}

describe('ActivityRegistry', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('walks providers and returns a flat activity map with bound this', async () => {
    // Arrange
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule, StubActivitiesModule],
      providers: [ActivityRegistry],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const target = app.get(ActivityRegistry);

    // Act
    const map = target.collect(app);

    // Assert — both decorated methods present; undecorated method absent
    expect(Object.keys(map).sort()).toEqual(['defaultName', 'explicit.name']);
    // Bound `this` preserves access to private fields
    const explicit = await map['explicit.name']!({ value: 7 });
    expect(explicit).toEqual({ tag: 'stub', value: 7 });
    const defaulted = await map['defaultName']!({});
    expect(defaulted).toBe('stub');

    await app.close();
  });

  it('returns an empty map when no providers carry @TemporalActivity', async () => {
    // Arrange
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [ActivityRegistry],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const target = app.get(ActivityRegistry);

    // Act
    const map = target.collect(app);

    // Assert
    expect(map).toEqual({});

    await app.close();
  });

  it('throws InternalException with UNKNOWN code on duplicate activity name', async () => {
    // Arrange
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule, DuplicateModule],
      providers: [ActivityRegistry],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const target = app.get(ActivityRegistry);

    // Act + Assert — message + code in one matcher
    expect(() => target.collect(app)).toThrow(
      expect.objectContaining({
        code: ErrorCode.UNKNOWN,
        message: expect.stringMatching(/Duplicate activity name: dup\.name/),
      }),
    );

    await app.close();
  });
});
