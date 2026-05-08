import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { z } from 'zod';
import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai';
import { DeepAgentFactory } from './deep-agent.factory';
import { AppConfigService } from 'src/shared/config/config.service';
import { MockLoggerService } from 'src/shared/logger/services/mock-logger.service';
import { InternalException } from 'src/shared/common/models/exception';
import { ErrorCode } from 'src/utils/error.code';

// `deepagents` is module-mocked at jest.config.ts level. Override per-spec
// to control the structuredResponse used by `invoke`.
jest.mock('deepagents', () => ({
  createDeepAgent: jest.fn().mockReturnValue({
    invoke: jest.fn().mockResolvedValue({ structuredResponse: { foo: 'bar' } }),
  }),
}));

describe('DeepAgentFactory', () => {
  let target: DeepAgentFactory;
  let mockConfig: DeepMocked<AppConfigService>;

  function setupMockConfig(
    overrides: {
      llmProvider?: 'azure' | 'openrouter' | 'llamacpp';
      azureKey?: string;
      openrouterKey?: string | undefined;
    } = {},
  ): void {
    mockConfig = createMock<AppConfigService>();
    Object.defineProperty(mockConfig, 'llmProvider', { get: () => overrides.llmProvider ?? 'azure' });
    Object.defineProperty(mockConfig, 'azureOpenAIApiKey', { get: () => overrides.azureKey ?? 'fake-azure-key' });
    Object.defineProperty(mockConfig, 'azureOpenAIApiInstanceName', { get: () => 'fake-instance' });
    Object.defineProperty(mockConfig, 'azureOpenAIApiDeploymentName', { get: () => 'fake-deployment' });
    Object.defineProperty(mockConfig, 'azureOpenAIApiVersion', { get: () => '2024-02-15-preview' });
    Object.defineProperty(mockConfig, 'openrouterApiKey', { get: () => overrides.openrouterKey });
    Object.defineProperty(mockConfig, 'openrouterModel', { get: () => 'openrouter/free' });
    Object.defineProperty(mockConfig, 'openrouterBaseUrl', { get: () => 'https://openrouter.ai/api/v1' });
    Object.defineProperty(mockConfig, 'llamacppApiKey', { get: () => 'not-needed' });
    Object.defineProperty(mockConfig, 'llamacppModel', { get: () => 'local' });
    Object.defineProperty(mockConfig, 'llamacppBaseUrl', { get: () => 'http://0.0.0.0:8080/v1' });
  }

  async function buildTarget(): Promise<void> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeepAgentFactory, { provide: AppConfigService, useValue: mockConfig }],
    })
      .setLogger(new MockLoggerService())
      .compile();
    target = module.get(DeepAgentFactory);
  }

  beforeEach(async () => {
    setupMockConfig();
    await buildTarget();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create — agent wrapper shape', () => {
    it('should return an agent wrapper with usageLimits and outputSchema', () => {
      // Arrange
      const schema = z.object({ foo: z.string() });

      // Act
      const agent = target.create({
        systemPrompt: 'TEST-PROMPT',
        tools: [],
        output: schema,
        retries: 2,
        outputRetries: 3,
        usageLimits: { totalTokens: 1_000_000, toolCalls: 100 },
      });

      // Assert
      expect(agent.usageLimits).toEqual({ totalTokens: 1_000_000, toolCalls: 100 });
      expect(agent.outputSchema).toBe(schema);
      expect(typeof agent.invoke).toBe('function');
    });

    it('should invoke the underlying agent and return the parsed structured response', async () => {
      // Arrange
      const schema = z.object({ foo: z.string() });
      const agent = target.create({
        systemPrompt: 'TEST',
        tools: [],
        output: schema,
        usageLimits: { totalTokens: 1000, toolCalls: 10 },
      });

      // Act
      const result = await agent.invoke('test prompt');

      // Assert — value comes from the jest.mock at file-level top
      expect(result).toEqual({ foo: 'bar' });
    });
  });

  describe('create — provider switch (Addendum 1+2)', () => {
    it('should build an Azure agent when LLM_PROVIDER=azure', () => {
      // Arrange
      setupMockConfig({ llmProvider: 'azure' });

      // Act
      const factory = new DeepAgentFactory(mockConfig);
      factory.create({
        systemPrompt: '',
        tools: [],
        output: z.object({}),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });

      // Assert — AzureChatOpenAI was constructed with the Azure params.
      // Mock impl in test/mocks/langchain-openai.mock.ts captures `params`.
      // We can't `expect(constructor).toHaveBeenCalled` cleanly without
      // additional spying, so assert via deep-agent's createDeepAgent input
      // shape — the model param is the AzureChatOpenAI instance. Existence
      // of an `azureOpenAIApiKey` property on params confirms the branch.
      // (Implementation-detail leak intentional: this is the unit-level
      // assertion that the switch works.)
      const { createDeepAgent } = jest.requireMock('deepagents') as { createDeepAgent: jest.Mock };
      const lastCall = createDeepAgent.mock.calls[createDeepAgent.mock.calls.length - 1]?.[0];
      expect(lastCall?.model).toBeInstanceOf(AzureChatOpenAI);
    });

    it('should build an OpenRouter agent when LLM_PROVIDER=openrouter', () => {
      // Arrange
      setupMockConfig({ llmProvider: 'openrouter', openrouterKey: 'sk-or-v1-fake' });

      // Act
      const factory = new DeepAgentFactory(mockConfig);
      factory.create({
        systemPrompt: '',
        tools: [],
        output: z.object({}),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });

      // Assert
      const { createDeepAgent } = jest.requireMock('deepagents') as { createDeepAgent: jest.Mock };
      const lastCall = createDeepAgent.mock.calls[createDeepAgent.mock.calls.length - 1]?.[0];
      expect(lastCall?.model).toBeInstanceOf(ChatOpenAI);
    });

    it('should build a llama.cpp agent when LLM_PROVIDER=llamacpp', () => {
      // Arrange
      setupMockConfig({ llmProvider: 'llamacpp' });

      // Act
      const factory = new DeepAgentFactory(mockConfig);
      factory.create({
        systemPrompt: '',
        tools: [],
        output: z.object({}),
        usageLimits: { totalTokens: 1, toolCalls: 1 },
      });

      // Assert
      const { createDeepAgent } = jest.requireMock('deepagents') as { createDeepAgent: jest.Mock };
      const lastCall = createDeepAgent.mock.calls[createDeepAgent.mock.calls.length - 1]?.[0];
      expect(lastCall?.model).toBeInstanceOf(ChatOpenAI);
    });

    it('should throw LLM_PROVIDER_CONFIG_INVALID when LLM_PROVIDER=openrouter and OPENROUTER_API_KEY is missing', () => {
      // Arrange
      setupMockConfig({ llmProvider: 'openrouter', openrouterKey: undefined });
      const factory = new DeepAgentFactory(mockConfig);

      // Act + Assert
      expect(() =>
        factory.create({
          systemPrompt: '',
          tools: [],
          output: z.object({}),
          usageLimits: { totalTokens: 1, toolCalls: 1 },
        }),
      ).toThrow(expect.objectContaining({ code: ErrorCode.LLM_PROVIDER_CONFIG_INVALID }));
    });

    it('should throw LLM_PROVIDER_CONFIG_INVALID when LLM_PROVIDER=azure and AZURE_OPENAI_API_KEY is empty', () => {
      // Arrange
      setupMockConfig({ llmProvider: 'azure', azureKey: '' });
      const factory = new DeepAgentFactory(mockConfig);

      // Act + Assert
      expect(() =>
        factory.create({
          systemPrompt: '',
          tools: [],
          output: z.object({}),
          usageLimits: { totalTokens: 1, toolCalls: 1 },
        }),
      ).toThrow(InternalException);
    });
  });
});

import { compactHistory, COMPACT_THRESHOLD_CHARS, TOOL_RETURN_TRUNCATE_CHARS, KEEP_RECENT_MESSAGES } from './deep-agent.factory';

// Story 13.11 / Q1 — closes 13.10 Finding 4 deferral.
describe('compactHistory (Story 13.11)', () => {
  it('returns the input unchanged when total chars are below threshold', () => {
    // Arrange
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];

    // Act
    const result = compactHistory(messages);

    // Assert — same array (no mutation, no rewrites)
    expect(result).toBe(messages);
  });

  it('replaces tool-return content > 200 chars when total exceeds threshold', () => {
    // Arrange — 10 tool-returns of 50_000 chars each = 500_000 chars (> threshold).
    // Tool returns occupy positions 0..N-7 (inclusive); last 6 messages preserved.
    const big = 'x'.repeat(50_000);
    const messages: Array<{ role: string; name?: string; content: string }> = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'tool', name: 'readFile', content: big });
    }
    // Last 6 are non-tool messages.
    for (let i = 0; i < 6; i++) {
      messages.push({ role: 'user', content: 'recent' });
    }

    // Act
    const result = compactHistory(messages);

    // Assert — last 6 preserved verbatim
    for (let i = result.length - KEEP_RECENT_MESSAGES; i < result.length; i++) {
      expect(result[i]!.content).toBe('recent');
    }
    // Earlier tool returns rewritten to placeholder
    expect(result[0]!.content).toMatch(/^\[Compacted: readFile, ~\d+ chars\]$/);
  });

  it('does not touch messages < TOOL_RETURN_TRUNCATE_CHARS even when over threshold', () => {
    // Arrange — fill with one giant tool return + many tiny ones; threshold is exceeded.
    const giant = 'x'.repeat(COMPACT_THRESHOLD_CHARS + 1000);
    const tiny = 'x'.repeat(TOOL_RETURN_TRUNCATE_CHARS - 10);
    const messages = [
      { role: 'tool', name: 'readFile', content: giant },
      ...Array.from({ length: 5 }, () => ({ role: 'tool', name: 'readFile', content: tiny })),
      ...Array.from({ length: KEEP_RECENT_MESSAGES }, () => ({ role: 'user', content: 'recent' })),
    ];

    // Act
    const result = compactHistory(messages);

    // Assert — tiny tool-returns NOT rewritten
    for (let i = 1; i <= 5; i++) {
      expect(result[i]!.content).toBe(tiny);
    }
  });

  it('is idempotent — running twice produces the same output', () => {
    // Arrange
    const big = 'x'.repeat(60_000);
    const messages = [
      { role: 'tool', name: 'readFile', content: big },
      ...Array.from({ length: 5 }, () => ({ role: 'tool', name: 'readFile', content: big })),
      ...Array.from({ length: KEEP_RECENT_MESSAGES }, () => ({ role: 'user', content: 'recent' })),
    ];

    // Act
    const once = compactHistory(messages);
    const twice = compactHistory(once);

    // Assert
    expect(twice).toEqual(once);
  });
});
