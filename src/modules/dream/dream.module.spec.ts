/**
 * Smoke spec for `DreamModule` (Story 13.9).
 *
 * Asserts the empty NestJS module compiles in `Test.createTestingModule`.
 * Stories 13.10/13.11/13.12 add real providers; this spec stays minimal so
 * those stories don't need to touch it.
 */
import { Test } from '@nestjs/testing';
import { DreamModule } from './dream.module';

describe('DreamModule', () => {
  it('compiles as an empty NestJS module', async () => {
    // Arrange + Act
    const moduleRef = await Test.createTestingModule({
      imports: [DreamModule],
    }).compile();

    // Assert
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
