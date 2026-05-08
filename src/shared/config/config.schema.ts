import * as Joi from 'joi';
import { NodeEnvironment, RuntimeEnvironment } from './environment';

export const configValidationSchema = Joi.object({
  // Server
  NODE_ENV: Joi.string()
    .valid(...Object.values(NodeEnvironment))
    .default(NodeEnvironment.DEVELOPMENT),
  HOST: Joi.string().required(),
  PORT: Joi.number().default(3000),

  // CORS
  CORS_ORIGINS: Joi.string().optional(),

  // Logger
  // Jarvis additions: enforce a default of 'info' (Story 13.1 AC #1).
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),
  LOG_OUTPUT: Joi.string().valid('json', 'text').optional(),
  LOG_FILE_PATH: Joi.string().optional(),
  LOG_FILE: Joi.string().optional(),
  LOG_SYNC_FILE: Joi.string().optional(),

  // GRPC
  GRPC_URL: Joi.string().optional(),
  GRPC_PORT: Joi.number().optional(),
  MAX_SEND_SIZE_IN_MB: Joi.number().optional(),
  MAX_RECEIVE_SIZE_IN_MB: Joi.number().optional(),

  // Environment
  RUNTIME_ENV: Joi.string()
    .valid(...Object.values(RuntimeEnvironment))
    .required(),

  // Redis
  // TODO [Story 13.16.5]: remove Redis env keys when RedisModule is deleted.
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASS: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().default(0),

  // MongoDB
  // TODO [Story 13.16.5]: remove MongoDB env keys when MongoDBModule is deleted.
  MONGODB_URI: Joi.string().required(),
  MONGODB_RETRY_ATTEMPTS: Joi.number().required(),
  MONGODB_RETRY_DELAY: Joi.number().required(),
  MONGODB_CONNECT_TIMEOUT: Joi.number().required(),
  MONGODB_TIMEOUT: Joi.number().required(),

  // Postgres
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SCHEMA: Joi.string().required(),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  DATABASE_POOL_SIZE: Joi.number().default(10),
  DB_POOL_STATS: Joi.boolean().default(false),

  // Kafka
  // TODO [Story 13.16.5]: prune Kafka env keys when domain-event Kafka path is removed.
  KAFKA_DEFAULT_BROKER_URL: Joi.string().required(),
  KAFKA_DEFAULT_CLIENT_ID: Joi.string().required(),
  KAFKA_DEFAULT_GROUP_ID: Joi.string().required(),
  KAFKA_DEFAULT_AUTO_CREATE_TOPIC: Joi.boolean().default(false),
  KAFKA_DEFAULT_SSL: Joi.boolean().default(false),
  KAFKA_DEFAULT_MECHANISM: Joi.string().optional(),
  KAFKA_DEFAULT_USERNAME: Joi.string().optional(),
  KAFKA_DEFAULT_PASSWORD: Joi.string().optional(),
  KAFKA_DEFAULT_REQUEST_TIMEOUT: Joi.number().optional(),
  KAFKA_DEFAULT_CONCURRENTLY: Joi.number().optional(),

  // ─────────────────────────────────────────────────────────────────────────
  // Jarvis-specific keys (Story 13.1 AC #1)
  // Source of truth: `_bmad-output/planning-artifacts/design/config-and-env.md §2`.
  // ─────────────────────────────────────────────────────────────────────────

  // Auth
  API_KEY: Joi.string().required(),

  // Vault
  VAULT_PATH: Joi.string().required(),
  VAULT_GIT_REMOTE: Joi.string().uri().required(),

  // GitHub
  GH_TOKEN: Joi.string().required(),

  // Temporal (external homelab service)
  TEMPORAL_ADDRESS: Joi.string().default('192.168.50.129:7233'),
  TEMPORAL_NAMESPACE: Joi.string().default('jarvis'),
  TEMPORAL_TASK_QUEUE: Joi.string().default('jarvis-dream'),

  // LLM provider switch (Story 13.10 / Addendum 1+2 — TanNT 2026-05-08)
  // Default 'azure' keeps production behaviour unchanged. Dev/test environments
  // override to 'openrouter' (rate-limited free tier) or 'llamacpp' (local
  // server at 0.0.0.0:8080). `DeepAgentFactory` switches on this value at
  // agent-build time. Joi accepts the three values; runtime validation that
  // the chosen provider's credentials are non-empty happens inside the factory
  // (LLM_PROVIDER_CONFIG_INVALID at -400170).
  LLM_PROVIDER: Joi.string().valid('azure', 'openrouter', 'llamacpp').default('azure'),

  // Azure OpenAI — required when LLM_PROVIDER='azure', optional otherwise.
  // Azure remains the production default (Story 13.17 cutover keeps this).
  AZURE_OPENAI_API_KEY: Joi.string().when('LLM_PROVIDER', { is: 'azure', then: Joi.required(), otherwise: Joi.optional() }),
  AZURE_OPENAI_API_INSTANCE_NAME: Joi.string().when('LLM_PROVIDER', { is: 'azure', then: Joi.required(), otherwise: Joi.optional() }),
  AZURE_OPENAI_API_DEPLOYMENT_NAME: Joi.string().when('LLM_PROVIDER', { is: 'azure', then: Joi.required(), otherwise: Joi.optional() }),
  AZURE_OPENAI_API_VERSION: Joi.string().when('LLM_PROVIDER', { is: 'azure', then: Joi.required(), otherwise: Joi.optional() }),
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME: Joi.string().when('LLM_PROVIDER', { is: 'azure', then: Joi.required(), otherwise: Joi.optional() }),
  LLM_MODEL: Joi.string().optional(),

  // OpenRouter (Story 13.10 / Addendum 1) — used when LLM_PROVIDER='openrouter'.
  // OpenAI-compatible API at openrouter.ai/api/v1; default model 'openrouter/free'
  // for dev/test (rate-limited but free).
  OPENROUTER_API_KEY: Joi.string().optional(),
  OPENROUTER_MODEL: Joi.string().default('openrouter/free'),
  OPENROUTER_BASE_URL: Joi.string().uri().default('https://openrouter.ai/api/v1'),

  // llama.cpp (Story 13.10 / Addendum 2) — used when LLM_PROVIDER='llamacpp'.
  // Local OpenAI-compatible server (TanNT runs it at 0.0.0.0:8080). The
  // default `LLAMACPP_API_KEY='not-needed'` exists because LangChain's
  // ChatOpenAI requires a non-empty apiKey; llama.cpp ignores it.
  LLAMACPP_BASE_URL: Joi.string().uri().default('http://0.0.0.0:8080/v1'),
  LLAMACPP_MODEL: Joi.string().default('local'),
  LLAMACPP_API_KEY: Joi.string().default('not-needed'),

  // MemU
  MEMU_API_URL: Joi.string().uri().required(),
  MEMU_API_KEY: Joi.string().optional(),
  // Defaults match Python `memu_client.py:64-65` (Story 13.4 / Q11).
  MEMU_USER_ID: Joi.string().default('jarvis'),
  MEMU_AGENT_ID: Joi.string().default('claude'),

  // Phase budget overrides — defaults match design/config-and-env.md §2.
  JARVIS_LIGHT_EXTRACTION_MAX_TOKENS: Joi.number().default(1_500_000),
  JARVIS_LIGHT_EXTRACTION_MAX_ITERATIONS: Joi.number().default(300),
  JARVIS_LIGHT_RECORD_MAX_TOKENS: Joi.number().default(1_500_000),
  JARVIS_LIGHT_RECORD_MAX_ITERATIONS: Joi.number().default(300),
  JARVIS_DEEP_PHASE1_MAX_TOKENS: Joi.number().default(1_500_000),
  JARVIS_DEEP_PHASE1_MAX_ITERATIONS: Joi.number().default(300),
  JARVIS_DEEP_PHASE2_MAX_TOKENS: Joi.number().default(1_500_000),
  JARVIS_DEEP_PHASE2_MAX_ITERATIONS: Joi.number().default(300),
  JARVIS_DEEP_PHASE3_MAX_TOKENS: Joi.number().default(2_000_000),
  JARVIS_DEEP_PHASE3_MAX_ITERATIONS: Joi.number().default(300),
  JARVIS_HEALTH_FIX_MAX_TOKENS: Joi.number().default(1_500_000),
  JARVIS_HEALTH_FIX_MAX_ITERATIONS: Joi.number().default(300),
  JARVIS_WEEKLY_REVIEW_MAX_TOKENS: Joi.number().default(1_500_000),
  JARVIS_WEEKLY_REVIEW_MAX_ITERATIONS: Joi.number().default(300),

  // Deep-dream scoring weights (Story 13.11 / Q6 RESOLVED 2026-05-08).
  // Defaults from Python `services/deep_dream.py:321-329` (DEFAULT_SCORING_WEIGHTS
  // + DEFAULT_DECAY_RATE). Cross-story extension to Story 13.1's config schema:
  // env-var route is cleaner than diverging `config.yml` from Python (which
  // doesn't wire config.yml for these). The epic AC text "configurable via
  // config.yml" is doc drift; Python is the truth.
  SCORING_WEIGHT_FREQ: Joi.number().default(0.25),
  SCORING_WEIGHT_RECENCY: Joi.number().default(0.25),
  SCORING_WEIGHT_RELEVANCE: Joi.number().default(0.2),
  SCORING_WEIGHT_CONSISTENCY: Joi.number().default(0.2),
  SCORING_WEIGHT_BREADTH: Joi.number().default(0.1),
  SCORING_DECAY_RATE: Joi.number().default(0.03),
});
