/**
 * Boot-failure-on-missing-env (Story 13.1 AC #2).
 *
 * Path chosen: feed an env fixture directly into the same Joi schema that
 * `AppConfigModule` wires into `ConfigModule.forRoot({ validationSchema })`.
 * Simpler than spawning a child process and avoids the side effects that
 * come from re-importing `config.module.ts` (which calls `forRoot()` at load
 * time).
 *
 * The fixture mirrors a populated `.env`; each negative test removes a single
 * required key and asserts the schema reports it.
 */
import { configValidationSchema } from './config.schema';

const baselineEnv: Record<string, string> = {
  HOST: '0.0.0.0',
  PORT: '8000',
  RUNTIME_ENV: 'test',
  NODE_ENV: 'test',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  MONGODB_URI: 'mongodb://localhost:27017/test',
  MONGODB_RETRY_ATTEMPTS: '3',
  MONGODB_RETRY_DELAY: '5000',
  MONGODB_CONNECT_TIMEOUT: '10000',
  MONGODB_TIMEOUT: '30000',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_USER: 'postgres',
  DATABASE_PASSWORD: 'postgres',
  DATABASE_NAME: 'jarvis',
  DATABASE_SCHEMA: 'jarvis',
  KAFKA_DEFAULT_BROKER_URL: 'localhost:9094',
  KAFKA_DEFAULT_CLIENT_ID: 'jarvis-test',
  KAFKA_DEFAULT_GROUP_ID: 'jarvis-test',
  API_KEY: 'test-api-key',
  VAULT_PATH: '/tmp/test-vault',
  VAULT_GIT_REMOTE: 'https://github.com/test/ai-memory.git',
  GH_TOKEN: 'test-token',
  AZURE_OPENAI_API_KEY: 'test-azure-key',
  AZURE_OPENAI_API_INSTANCE_NAME: 'test-instance',
  AZURE_OPENAI_API_DEPLOYMENT_NAME: 'gpt-test',
  AZURE_OPENAI_API_VERSION: '2025-05-01-preview',
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME: 'text-embedding-3-large',
  MEMU_API_URL: 'http://localhost:8080',
};

describe('config validation schema (boot-failure on missing env)', () => {
  it('should accept a fully-populated env without errors', () => {
    // Act
    const { error } = configValidationSchema.validate(baselineEnv, { abortEarly: false });

    // Assert
    expect(error).toBeUndefined();
  });

  it('should reject when AZURE_OPENAI_API_KEY is missing', () => {
    // Arrange
    const env = { ...baselineEnv };
    delete env['AZURE_OPENAI_API_KEY'];

    // Act
    const { error } = configValidationSchema.validate(env, { abortEarly: false });

    // Assert
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/AZURE_OPENAI_API_KEY/);
  });

  it('should reject when API_KEY is missing', () => {
    // Arrange
    const env = { ...baselineEnv };
    delete env['API_KEY'];

    // Act
    const { error } = configValidationSchema.validate(env, { abortEarly: false });

    // Assert
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/API_KEY/);
  });

  it('should reject when VAULT_PATH is missing', () => {
    // Arrange
    const env = { ...baselineEnv };
    delete env['VAULT_PATH'];

    // Act
    const { error } = configValidationSchema.validate(env, { abortEarly: false });

    // Assert
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/VAULT_PATH/);
  });

  it('should reject when VAULT_GIT_REMOTE is not a URI', () => {
    // Arrange
    const env = { ...baselineEnv, VAULT_GIT_REMOTE: 'not-a-uri' };

    // Act
    const { error } = configValidationSchema.validate(env, { abortEarly: false });

    // Assert
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/VAULT_GIT_REMOTE/);
  });

  it('should reject when MEMU_API_URL is not a URI', () => {
    // Arrange
    const env = { ...baselineEnv, MEMU_API_URL: 'not-a-uri' };

    // Act
    const { error } = configValidationSchema.validate(env, { abortEarly: false });

    // Assert
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/MEMU_API_URL/);
  });

  it('should default phase budgets when not set', () => {
    // Act
    const { value, error } = configValidationSchema.validate(baselineEnv, { abortEarly: false });

    // Assert
    expect(error).toBeUndefined();
    expect(value.JARVIS_LIGHT_EXTRACTION_MAX_TOKENS).toBe(1_500_000);
    expect(value.JARVIS_DEEP_PHASE3_MAX_TOKENS).toBe(2_000_000);
    expect(value.JARVIS_LIGHT_EXTRACTION_MAX_ITERATIONS).toBe(300);
    expect(value.LOG_LEVEL).toBe('info');
  });
});
