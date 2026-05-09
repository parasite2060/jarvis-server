import { SecretScrubberService } from './secret-scrubber.service';

describe('SecretScrubberService', () => {
  let target: SecretScrubberService;

  beforeEach(() => {
    target = new SecretScrubberService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // AC4: The service never emits matched content — only pattern IDs and counts are returned.
  // The caller (IngestTranscriptUseCase) owns telemetry; the service output is the proof.
  describe('AC4 — Output never exposes matched secret value', () => {
    it('should not include matched secret value in redactionCounts when scrub is called with OpenAI key', () => {
      // Arrange
      const input = 'sk-FAKEKEY0000000000000';

      // Act
      const result = target.scrub(input);

      // Assert
      const countsJson = JSON.stringify(result.redactionCounts);
      expect(countsJson).not.toContain('sk-FAKEKEY0000000000000');
      expect(result.redactionCounts['openai_api_key']).toBe(1);
    });

    it('should not include matched secret value in redactionCounts when scrub is called with AWS key', () => {
      // Arrange
      const input = 'AWS_SECRET=AKIAFAKEAWSKEYTEST001';

      // Act
      const result = target.scrub(input);

      // Assert
      const countsJson = JSON.stringify(result.redactionCounts);
      expect(countsJson).not.toContain('AKIAFAKEAWSKEYTEST001');
      expect(result.redactionCounts['aws_access_key']).toBe(1);
    });

    it('should not include matched secret value in redactionCounts when scrub is called with JWT bearer', () => {
      // Arrange
      const input = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature';

      // Act
      const result = target.scrub(input);

      // Assert
      const countsJson = JSON.stringify(result.redactionCounts);
      expect(countsJson).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature');
      expect(result.redactionCounts['jwt']).toBe(1);
    });
  });

  describe('AC7 — Byte-equivalence tests', () => {
    describe('pem', () => {
      it('should redact PEM private key block when input contains BEGIN/END markers', () => {
        // Arrange
        const input = 'Key: -----BEGIN PRIVATE KEY-----\nMIHuAgEAMB...xyz\n-----END PRIVATE KEY-----';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('Key: [REDACTED_PEM]');
        expect(result.redactionCounts['pem']).toBe(1);
      });
    });

    describe('anthropic_api_key', () => {
      it('should redact Anthropic API key when input contains sk-ant- prefix', () => {
        // Arrange
        const input = 'ANTHROPIC_KEY=sk-ant-api03FAKEKEY123456789012';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('ANTHROPIC_KEY=[REDACTED_API_KEY]');
        expect(result.redactionCounts['anthropic_api_key']).toBe(1);
      });
    });

    describe('openai_api_key', () => {
      it('should redact OpenAI API key when input contains sk- prefix', () => {
        // Arrange
        const input = 'OPENAI_KEY=sk-FAKEKEY000000000000000000000000000000000';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('OPENAI_KEY=[REDACTED_API_KEY]');
        expect(result.redactionCounts['openai_api_key']).toBe(1);
      });
    });

    describe('aws_access_key', () => {
      it('should redact AWS access key when input contains AKIA prefix', () => {
        // Arrange
        const input = 'AWS_ACCESS_KEY=AKIAFAKE0000000000AB';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('AWS_ACCESS_KEY=[REDACTED_AWS_KEY]');
        expect(result.redactionCounts['aws_access_key']).toBe(1);
      });
    });

    describe('github_token', () => {
      it('should redact GitHub token when input contains ghp/gho/ghs prefix', () => {
        // Arrange
        const input = 'ghp_FAKEGITHUBTOKEN1234567890123456789012345';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('[REDACTED_GITHUB_TOKEN]');
        expect(result.redactionCounts['github_token']).toBe(1);
      });
    });

    describe('google_api_key', () => {
      it('should redact Google API key when input contains AIzaSy prefix', () => {
        // Arrange
        const input = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('[REDACTED_GOOGLE_KEY]');
        expect(result.redactionCounts['google_api_key']).toBe(1);
      });
    });

    describe('slack_token', () => {
      it('should redact Slack token when input contains xoxb/xoxa/xoxp/xoxr/xoxs prefix', () => {
        // Arrange
        const input = 'xoxb-FakeSlackToken1234567890123';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('[REDACTED_SLACK_TOKEN]');
        expect(result.redactionCounts['slack_token']).toBe(1);
      });
    });

    describe('jwt', () => {
      it('should redact JWT when input contains eyJ header', () => {
        // Arrange
        const input = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('[REDACTED_JWT]');
        expect(result.redactionCounts['jwt']).toBe(1);
      });
    });

    describe('url_basic_auth', () => {
      it('should redact credentials in postgres URL when input contains user:pass@host', () => {
        // Arrange
        const input = 'postgres://admin:supersecret@db.host/db';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('postgres://[REDACTED_USER]:[REDACTED_PW]@db.host/db');
        expect(result.redactionCounts['url_basic_auth']).toBe(1);
      });

      it('should redact credentials in mongodb+srv URL when input contains user:pass@host', () => {
        // Arrange
        const input = 'mongodb+srv://user:pass123@cluster0.mongodb.net/db';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('mongodb+srv://[REDACTED_USER]:[REDACTED_PW]@cluster0.mongodb.net/db');
        expect(result.redactionCounts['url_basic_auth']).toBe(1);
      });

      it('should redact credentials in redis URL when input contains user:pass@host', () => {
        // Arrange
        const input = 'redis://redis-user:secretpass@redis.example.com:6379';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('redis://[REDACTED_USER]:[REDACTED_PW]@redis.example.com:6379');
        expect(result.redactionCounts['url_basic_auth']).toBe(1);
      });
    });

    describe('bearer_token', () => {
      it('should redact Bearer token when input contains capitalized Bearer prefix', () => {
        // Arrange
        const input = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9FAKEBEARERTOKEN';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('Bearer [REDACTED_TOKEN]');
        expect(result.redactionCounts['bearer_token']).toBe(1);
      });

      it('should redact bearer token when input contains lowercase bearer prefix', () => {
        // Arrange
        const input = 'bearer faketoken00000000000000000000000000000';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('bearer [REDACTED_TOKEN]');
        expect(result.redactionCounts['bearer_token']).toBe(1);
      });
    });

    describe('json_secret_value', () => {
      it('should redact JSON password field when input contains "password": "<value>"', () => {
        // Arrange
        const input = '{"password": "supersecret123"}';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('{"password": "[REDACTED]"}');
        expect(result.redactionCounts['json_secret_value']).toBe(1);
      });

      it('should redact JSON api_key field when input contains "api_key": "<value>" (case-insensitive)', () => {
        // Arrange
        const input = '{"api_key": "fakesecret000000000000000"}';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('{"api_key": "[REDACTED]"}');
        expect(result.redactionCounts['json_secret_value']).toBe(1);
      });

      it('should not redact JSON field when value is already [REDACTED]', () => {
        // Arrange
        const input = '{"password": "[REDACTED]"}';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('{"password": "[REDACTED]"}');
        expect(result.redactionCounts['json_secret_value']).toBeUndefined();
      });
    });

    describe('env_secret_assignment', () => {
      it('should redact env var API_KEY assignment when input contains KEY=<value>', () => {
        // Arrange
        const input = 'export API_KEY=supersecret000000000000000000000';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('export API_KEY=[REDACTED]');
        expect(result.redactionCounts['env_secret_assignment']).toBe(1);
      });

      it('should redact env var SECRET assignment when input contains SECRET=<value> (case-insensitive)', () => {
        // Arrange
        const input = 'SECRET=fakesecret000000000000000000000000000000';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('SECRET=[REDACTED]');
        expect(result.redactionCounts['env_secret_assignment']).toBe(1);
      });

      it('should not redact env var when value is already [REDACTED]', () => {
        // Arrange
        const input = 'PASSWORD=[REDACTED]';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.scrubbed).toBe('PASSWORD=[REDACTED]');
        expect(result.redactionCounts['env_secret_assignment']).toBeUndefined();
      });
    });

    describe('multiple patterns', () => {
      it('should count multiple secrets of different types when input contains OpenAI key, AWS key, and bearer token', () => {
        // Arrange
        const input =
          'API=sk-FAKEKEY000000000000000000000000000000000\n' + 'AWS=AKIAFAKEAWSKEYTEST001\n' + 'Bearer faketoken0000000000000000000000000000';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.redactionCounts['openai_api_key']).toBe(1);
        expect(result.redactionCounts['aws_access_key']).toBe(1);
        expect(result.redactionCounts['bearer_token']).toBe(1);
        expect(result.redactionCounts['pem']).toBeUndefined();
      });

      it('should count multiple secrets of the same type when input contains two OpenAI keys', () => {
        // Arrange
        const input = 'key1=sk-FAKEKEY000000000000000000000000000000000\n' + 'key2=sk-FAKEKEY000000000000000000000000000000001';

        // Act
        const result = target.scrub(input);

        // Assert
        expect(result.redactionCounts['openai_api_key']).toBe(2);
      });
    });
  });

  describe('AC7 — No false positives', () => {
    it('should leave realistic technical conversation unchanged when input contains no secrets', () => {
      // Arrange
      const text =
        'The deep-dream pipeline uses Temporal for orchestration and Postgres for persistence. ' +
        'The light-dream workflow calls the extraction agent with a transcript file path. ' +
        'JWTs are generated by the auth layer and validated by middleware. ' +
        'The context cache is invalidated after each dream completes. ' +
        'The weekly-review schedule runs every Monday at 09:00. ' +
        'The vault stores session logs and daily records as Markdown files. ' +
        'API keys are loaded from environment variables in config.service.ts. ' +
        'The conversation module handles transcript ingestion via POST /ingest. ' +
        'MemU provides semantic search across stored memories. ' +
        'The health-check agent reads health_issues.json and produces fix actions. ' +
        'Git operations use simple-git and gh CLI for PR creation. ' +
        'The scoring algorithm evaluates candidates based on recency and importance. ' +
        'Pattern matching in the scrubber uses regular expressions compiled at startup. ' +
        'The deep-dream phase 2 aggregates candidates from all daily sessions. ' +
        'The module map defines the directory structure under src/modules/. ' +
        'Temporal activities run as NestJS providers with dependency injection. ' +
        'The file manifest tracks hashes for optimistic concurrency. ' +
        'The conversation ingest endpoint accepts segmentStartLine and segmentEndLine. ' +
        'The cron schedule is configurable via PATCH /config. ' +
        'The health-fix agent handles LLM-owned issue categories only.';

      // Act
      const result = target.scrub(text);

      // Assert
      expect(result.scrubbed).toBe(text);
      expect(result.redactionCounts).toEqual({});
    });

    it('should leave already-redacted markers unchanged when input contains only [REDACTED] tokens', () => {
      // Arrange
      const text =
        'The API key was replaced with [REDACTED_API_KEY] in the logs. ' +
        'The AWS key is [REDACTED_AWS_KEY] and the GitHub token is [REDACTED_GITHUB_TOKEN].';

      // Act
      const result = target.scrub(text);

      // Assert
      expect(result.scrubbed).toBe(text);
      expect(result.redactionCounts).toEqual({});
    });
  });

  describe('edge cases', () => {
    it('should return empty counts when input is empty string', () => {
      // Arrange
      const input = '';

      // Act
      const result = target.scrub(input);

      // Assert
      expect(result.scrubbed).toBe('');
      expect(result.redactionCounts).toEqual({});
    });

    it('should return empty counts when input is whitespace only', () => {
      // Arrange
      const input = '   \n\t  ';

      // Act
      const result = target.scrub(input);

      // Assert
      expect(result.scrubbed).toBe('   \n\t  ');
      expect(result.redactionCounts).toEqual({});
    });
  });
});
