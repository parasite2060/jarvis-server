import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeEnvironment, RuntimeEnvironment } from './environment';
import { UsageLimits } from './usage-limits';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  // Server config
  get host(): string {
    return this.configService.getOrThrow<string>('HOST');
  }

  get port(): number {
    return this.configService.get<number>('PORT', 3000);
  }

  get nodeEnv(): NodeEnvironment {
    return this.configService.get<NodeEnvironment>('NODE_ENV', NodeEnvironment.DEVELOPMENT);
  }

  // Logger config
  get logLevel(): string {
    return this.configService.get<string>('LOG_LEVEL', 'info');
  }

  // GRPC config
  get grpcUrl(): string {
    return this.configService.get<string>('GRPC_URL', 'localhost');
  }

  get grpcPort(): number {
    return this.configService.get<number>('GRPC_PORT', 5000);
  }

  get maxSendSizeInMb(): number {
    return this.configService.get<number>('MAX_SEND_SIZE_IN_MB', 4);
  }

  get maxReceiveSizeInMb(): number {
    return this.configService.get<number>('MAX_RECEIVE_SIZE_IN_MB', 4);
  }

  // Environment config
  get runtimeEnv(): RuntimeEnvironment {
    return this.configService.getOrThrow<RuntimeEnvironment>('RUNTIME_ENV');
  }

  // Redis config
  get redisHost(): string {
    return this.configService.getOrThrow<string>('REDIS_HOST');
  }

  get redisPort(): number {
    return this.configService.get<number>('REDIS_PORT', 6379);
  }

  get redisPass(): string {
    return this.configService.get<string>('REDIS_PASS', '');
  }

  get redisDb(): number {
    return this.configService.get<number>('REDIS_DB', 0);
  }

  // MongoDB config
  get mongodbUri(): string {
    return this.configService.getOrThrow<string>('MONGODB_URI');
  }

  get mongodbRetryAttempts(): number {
    return this.configService.getOrThrow<number>('MONGODB_RETRY_ATTEMPTS');
  }

  get mongodbRetryDelay(): number {
    return this.configService.getOrThrow<number>('MONGODB_RETRY_DELAY');
  }

  get mongodbConnectTimeout(): number {
    return this.configService.getOrThrow<number>('MONGODB_CONNECT_TIMEOUT');
  }

  get mongodbTimeout(): number {
    return this.configService.getOrThrow<number>('MONGODB_TIMEOUT');
  }

  // Postgres config
  get databaseHost(): string {
    return this.configService.getOrThrow<string>('DATABASE_HOST');
  }

  get databasePort(): number {
    return this.configService.getOrThrow<number>('DATABASE_PORT');
  }

  get databaseUser(): string {
    return this.configService.getOrThrow<string>('DATABASE_USER');
  }

  get databasePassword(): string {
    return this.configService.getOrThrow<string>('DATABASE_PASSWORD');
  }

  get databaseName(): string {
    return this.configService.getOrThrow<string>('DATABASE_NAME');
  }

  get databaseSchema(): string {
    return this.configService.getOrThrow<string>('DATABASE_SCHEMA');
  }

  get databaseSynchronize(): boolean {
    return this.configService.get<boolean>('DATABASE_SYNCHRONIZE', false);
  }

  get databasePoolSize(): number {
    return this.configService.get<number>('DATABASE_POOL_SIZE', 10);
  }

  // Kafka config
  get kafkaDefaultBrokerUrl(): string {
    return this.configService.getOrThrow<string>('KAFKA_DEFAULT_BROKER_URL');
  }

  get kafkaDefaultClientId(): string {
    return this.configService.getOrThrow<string>('KAFKA_DEFAULT_CLIENT_ID');
  }

  get kafkaDefaultGroupId(): string {
    return this.configService.getOrThrow<string>('KAFKA_DEFAULT_GROUP_ID');
  }

  get kafkaDefaultAutoCreateTopic(): boolean {
    return this.configService.get<boolean>('KAFKA_DEFAULT_AUTO_CREATE_TOPIC', false);
  }

  get kafkaDefaultSsl(): boolean {
    return this.configService.get<boolean>('KAFKA_DEFAULT_SSL', false);
  }

  get kafkaDefaultMechanism(): string {
    return this.configService.get<string>('KAFKA_DEFAULT_MECHANISM', '');
  }

  get kafkaDefaultUsername(): string {
    return this.configService.get<string>('KAFKA_DEFAULT_USERNAME', '');
  }

  get kafkaDefaultPassword(): string {
    return this.configService.get<string>('KAFKA_DEFAULT_PASSWORD', '');
  }

  get kafkaDefaultRequestTimeout(): number {
    return this.configService.get<number>('KAFKA_DEFAULT_REQUEST_TIMEOUT', 30000);
  }

  get kafkaDefaultConcurrently(): number {
    return this.configService.get<number>('KAFKA_DEFAULT_CONCURRENTLY', 1);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Jarvis-specific accessors (Story 13.1 AC #3)
  // Source of truth: `_bmad-output/planning-artifacts/design/config-and-env.md §3`.
  // ─────────────────────────────────────────────────────────────────────────

  // Auth
  get apiKey(): string {
    return this.configService.getOrThrow<string>('API_KEY');
  }

  // Vault
  get vaultPath(): string {
    return this.configService.getOrThrow<string>('VAULT_PATH');
  }

  get vaultGitRemote(): string {
    return this.configService.get<string>('VAULT_GIT_REMOTE') ?? '';
  }

  get vaultSyncIntervalSeconds(): number {
    return this.configService.get<number>('VAULT_SYNC_INTERVAL_SECONDS', 1800);
  }

  // GitHub — GH_TOKEN is optional when MEMORY_STORAGE_MODE=local (gh CLI not used).
  get ghToken(): string {
    return this.configService.get<string>('GH_TOKEN') ?? '';
  }

  get memoryStorageMode(): 'local' | 'github' {
    return this.configService.get<'local' | 'github'>('MEMORY_STORAGE_MODE', 'local');
  }

  // Temporal (defaults declared in Joi schema)
  get temporalAddress(): string {
    return this.configService.get<string>('TEMPORAL_ADDRESS', '192.168.50.129:7233');
  }

  get temporalNamespace(): string {
    return this.configService.get<string>('TEMPORAL_NAMESPACE', 'jarvis');
  }

  get temporalTaskQueue(): string {
    return this.configService.get<string>('TEMPORAL_TASK_QUEUE', 'jarvis-dream');
  }

  // LLM provider switch (Story 13.10 / Addendum 1+2; Story 13.16.6 adds openai-compatible)
  get llmProvider(): 'azure' | 'openrouter' | 'llamacpp' | 'openai-compatible' {
    return this.configService.get<'azure' | 'openrouter' | 'llamacpp' | 'openai-compatible'>('LLM_PROVIDER', 'azure');
  }

  // OpenRouter (Story 13.10 / Addendum 1)
  get openrouterApiKey(): string | undefined {
    return this.configService.get<string>('OPENROUTER_API_KEY');
  }

  get openrouterModel(): string {
    return this.configService.get<string>('OPENROUTER_MODEL', 'openrouter/free');
  }

  get openrouterBaseUrl(): string {
    return this.configService.get<string>('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');
  }

  // llama.cpp (Story 13.10 / Addendum 2)
  get llamacppBaseUrl(): string {
    return this.configService.get<string>('LLAMACPP_BASE_URL', 'http://0.0.0.0:8080/v1');
  }

  get llamacppModel(): string {
    return this.configService.get<string>('LLAMACPP_MODEL', 'local');
  }

  get llamacppApiKey(): string {
    return this.configService.get<string>('LLAMACPP_API_KEY', 'not-needed');
  }

  // OpenAI-compatible (Story 13.16.6) — any OpenAI-compatible endpoint
  get openaiCompatibleBaseUrl(): string {
    return this.configService.get<string>('OPENAI_COMPATIBLE_BASE_URL', '');
  }

  get openaiCompatibleModel(): string {
    return this.configService.get<string>('OPENAI_COMPATIBLE_MODEL', '');
  }

  get openaiCompatibleApiKey(): string {
    return this.configService.get<string>('OPENAI_COMPATIBLE_API_KEY', 'not-needed');
  }

  // Azure OpenAI
  get azureOpenAIApiKey(): string {
    return this.configService.getOrThrow<string>('AZURE_OPENAI_API_KEY');
  }

  get azureOpenAIApiInstanceName(): string {
    return this.configService.getOrThrow<string>('AZURE_OPENAI_API_INSTANCE_NAME');
  }

  get azureOpenAIApiDeploymentName(): string {
    return this.configService.getOrThrow<string>('AZURE_OPENAI_API_DEPLOYMENT_NAME');
  }

  get azureOpenAIApiVersion(): string {
    return this.configService.getOrThrow<string>('AZURE_OPENAI_API_VERSION');
  }

  get azureOpenAIEmbeddingDeploymentName(): string {
    return this.configService.getOrThrow<string>('AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME');
  }

  get llmModel(): string | undefined {
    return this.configService.get<string>('LLM_MODEL');
  }

  // MemU
  get memuApiUrl(): string {
    return this.configService.getOrThrow<string>('MEMU_API_URL');
  }

  get memuApiKey(): string | undefined {
    return this.configService.get<string>('MEMU_API_KEY');
  }

  get memuUserId(): string {
    return this.configService.get<string>('MEMU_USER_ID', 'jarvis');
  }

  get memuAgentId(): string {
    return this.configService.get<string>('MEMU_AGENT_ID', 'claude');
  }

  // Prompts (Story 13.10 / Q15) — directory for `prompts/*.md` loaded by
  // `PromptCacheService` at boot. Default `${cwd}/prompts` for local dev;
  // override `/app/prompts` in Docker via `PROMPTS_PATH` env var. The Joi
  // schema marks the var optional (Q15.b) — actual file existence is
  // validated at boot by `PromptCacheService`, not by Joi.
  get promptsPath(): string {
    return this.configService.get<string>('PROMPTS_PATH', `${process.cwd()}/prompts`);
  }

  // Phase budgets — one getter per phase. Defaults mirror Joi schema.
  get lightExtractionLimits(): UsageLimits {
    return {
      maxTokens: this.configService.get<number>('JARVIS_LIGHT_EXTRACTION_MAX_TOKENS', 1_500_000),
      maxIterations: this.configService.get<number>('JARVIS_LIGHT_EXTRACTION_MAX_ITERATIONS', 300),
    };
  }

  get lightRecordLimits(): UsageLimits {
    return {
      maxTokens: this.configService.get<number>('JARVIS_LIGHT_RECORD_MAX_TOKENS', 1_500_000),
      maxIterations: this.configService.get<number>('JARVIS_LIGHT_RECORD_MAX_ITERATIONS', 300),
    };
  }

  get deepPhase1Limits(): UsageLimits {
    return {
      maxTokens: this.configService.get<number>('JARVIS_DEEP_PHASE1_MAX_TOKENS', 1_500_000),
      maxIterations: this.configService.get<number>('JARVIS_DEEP_PHASE1_MAX_ITERATIONS', 300),
    };
  }

  get deepPhase2Limits(): UsageLimits {
    return {
      maxTokens: this.configService.get<number>('JARVIS_DEEP_PHASE2_MAX_TOKENS', 1_500_000),
      maxIterations: this.configService.get<number>('JARVIS_DEEP_PHASE2_MAX_ITERATIONS', 300),
    };
  }

  get deepPhase3Limits(): UsageLimits {
    return {
      maxTokens: this.configService.get<number>('JARVIS_DEEP_PHASE3_MAX_TOKENS', 2_000_000),
      maxIterations: this.configService.get<number>('JARVIS_DEEP_PHASE3_MAX_ITERATIONS', 300),
    };
  }

  get healthFixLimits(): UsageLimits {
    return {
      maxTokens: this.configService.get<number>('JARVIS_HEALTH_FIX_MAX_TOKENS', 1_500_000),
      maxIterations: this.configService.get<number>('JARVIS_HEALTH_FIX_MAX_ITERATIONS', 300),
    };
  }

  get weeklyReviewLimits(): UsageLimits {
    return {
      maxTokens: this.configService.get<number>('JARVIS_WEEKLY_REVIEW_MAX_TOKENS', 1_500_000),
      maxIterations: this.configService.get<number>('JARVIS_WEEKLY_REVIEW_MAX_ITERATIONS', 300),
    };
  }

  // Deep-dream scoring weights (Story 13.11 / Q6 RESOLVED 2026-05-08).
  // Mirror Python defaults from `services/deep_dream.py:321-329`. NOT exposed
  // via vault `config.yml` (Python doesn't wire it either; epic AC's mention
  // of config.yml is doc drift). Pure env-var route.
  get scoringWeights(): { frequency: number; recency: number; relevance: number; consistency: number; breadth: number } {
    return {
      frequency: this.configService.get<number>('SCORING_WEIGHT_FREQ', 0.25),
      recency: this.configService.get<number>('SCORING_WEIGHT_RECENCY', 0.25),
      relevance: this.configService.get<number>('SCORING_WEIGHT_RELEVANCE', 0.2),
      consistency: this.configService.get<number>('SCORING_WEIGHT_CONSISTENCY', 0.2),
      breadth: this.configService.get<number>('SCORING_WEIGHT_BREADTH', 0.1),
    };
  }

  get scoringDecayRate(): number {
    return this.configService.get<number>('SCORING_DECAY_RATE', 0.03);
  }
}
