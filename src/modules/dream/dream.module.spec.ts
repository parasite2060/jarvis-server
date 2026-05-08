/**
 * Smoke spec for `DreamModule` (Story 13.9, extended Story 13.10).
 *
 * Asserts the module compiles in `Test.createTestingModule`. Story 13.10
 * added `LightDreamActivities` to providers; the spec mocks the
 * activity's constructor dependencies so the test doesn't need a full
 * Postgres / MemU / GitOps stack.
 */
import { Test } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { CommandBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DreamModule } from './dream.module';
import { GitOpsService } from 'src/shared/git/git-ops.service';
import { DeepAgentFactory } from 'src/shared/agents/deep-agent.factory';
import { PromptCacheService } from 'src/shared/agents/prompt-cache.service';
import { AppConfigService } from 'src/shared/config/config.service';
import { CONVERSATION_REPOSITORY } from 'src/shared/domain/repositories/conversation.repository.interface';
import { DREAM_REPOSITORY } from 'src/shared/domain/repositories/dream.repository.interface';
import { DREAM_PHASE_REPOSITORY } from 'src/shared/domain/repositories/dream-phase.repository.interface';
import { MEMU_API } from 'src/shared/domain/apis/memu-api.interface';
import { DBConnections } from 'src/shared/postgres/utils/constaint';

describe('DreamModule', () => {
  it('compiles with LightDreamActivities providers', async () => {
    // Arrange + Act
    const moduleRef = await Test.createTestingModule({
      imports: [DreamModule],
    })
      .overrideProvider(MEMU_API)
      .useValue(createMock())
      .overrideProvider(GitOpsService)
      .useValue(createMock<GitOpsService>())
      .overrideProvider(DeepAgentFactory)
      .useValue(createMock<DeepAgentFactory>())
      .overrideProvider(PromptCacheService)
      .useValue(createMock<PromptCacheService>())
      .overrideProvider(CONVERSATION_REPOSITORY)
      .useValue(createMock())
      .overrideProvider(DREAM_REPOSITORY)
      .useValue(createMock())
      .overrideProvider(DREAM_PHASE_REPOSITORY)
      .useValue(createMock())
      .overrideProvider(getDataSourceToken(DBConnections.INTERNAL))
      .useValue(createMock<DataSource>())
      .overrideProvider(CommandBus)
      .useValue(createMock<CommandBus>())
      .overrideProvider(AppConfigService)
      .useValue(createMock<AppConfigService>())
      // Provide ALL the upstream tokens at the top of the testing module so
      // overrideProvider has something to override.
      .useMocker((token) => {
        if (token === MEMU_API) return createMock();
        if (token === CONVERSATION_REPOSITORY) return createMock();
        if (token === DREAM_REPOSITORY) return createMock();
        if (token === DREAM_PHASE_REPOSITORY) return createMock();
        return createMock();
      })
      .compile();

    // Assert
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
