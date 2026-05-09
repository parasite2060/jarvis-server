/**
 * Versioned secret-redaction pattern catalogue.
 * Byte-equal to the Python source at
 * `components/jarvis-server/app/services/secret_patterns.json` and the plugin copy at
 * `components/jarvis-claude-plugin/hooks/lib/secret_patterns.json`.
 * Story 13.15 ports these verbatim from Python; Story 11.7 enforces ongoing parity.
 */
export const PATTERN_VERSION = 1;

export type ReplacementType = 'literal' | 'backref' | 'function';

export interface PatternEntry {
  readonly name: string;
  readonly regex: string;
  readonly flags: string;
  readonly replacementType: ReplacementType;
  readonly replacement?: string;
  readonly function?: string;
}

/** Ordered exactly as declared in secret_patterns.json — order matters. */
export const PATTERNS: PatternEntry[] = [
  {
    name: 'pem',
    regex: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_PEM]',
  },
  {
    name: 'anthropic_api_key',
    regex: 'sk-ant-[A-Za-z0-9_-]{20,}',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'openai_api_key',
    regex: 'sk-[A-Za-z0-9_-]{20,}',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'aws_access_key',
    regex: 'AKIA[A-Z0-9]{16}',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_AWS_KEY]',
  },
  {
    name: 'github_token',
    regex: 'gh[pousr]_[A-Za-z0-9]{36,}',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    name: 'google_api_key',
    regex: 'AIzaSy[A-Za-z0-9_-]{33}',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_GOOGLE_KEY]',
  },
  {
    name: 'slack_token',
    regex: 'xox[baprs]-[A-Za-z0-9-]{10,}',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  {
    name: 'jwt',
    regex: 'eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
    flags: 'g',
    replacementType: 'literal',
    replacement: '[REDACTED_JWT]',
  },
  {
    name: 'url_basic_auth',
    regex: '(https?|postgres|postgresql|mongodb(?:\\+srv)?|redis|amqp|mysql)://([^\\s:/@]+):([^\\s@]+)@',
    flags: 'g',
    replacementType: 'function',
    function: 'url_basic_auth',
  },
  {
    name: 'bearer_token',
    regex: '([Bb]earer\\s+)[A-Za-z0-9_.\\-/+=]{20,}',
    flags: 'g',
    replacementType: 'backref',
    replacement: '$1[REDACTED_TOKEN]',
  },
  {
    name: 'json_secret_value',
    regex:
      '(\\\\?"(?:password|passwd|secret|api_key|apikey|api-secret|access_token|auth_token|refresh_token|client_secret|private_key|signing_key|encryption_key)\\\\?"\\s*:\\s*\\\\?")(?!\\[REDACTED)([^"\\\\]+)(\\\\?")',
    flags: 'gi',
    replacementType: 'backref',
    replacement: '$1[REDACTED]$3',
  },
  {
    name: 'env_secret_assignment',
    regex:
      '((?:API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|AUTH_SECRET|DB_PASSWORD|ENCRYPTION_KEY|SIGNING_KEY|PRIVATE_KEY)\\s*=\\s*)(?!\\[REDACTED)(\\S+)',
    flags: 'gi',
    replacementType: 'backref',
    replacement: '$1[REDACTED]',
  },
];

/** url_basic_auth replacement function — matches _redact_url_basic_auth in secret_scrubber.py. */
function redactUrlBasicAuth(match: RegExpMatchArray): string {
  return `${match[1]}://[REDACTED_USER]:[REDACTED_PW]@`;
}

const FUNCTION_REGISTRY: Record<string, (match: RegExpMatchArray) => string> = {
  url_basic_auth: redactUrlBasicAuth,
};

export { FUNCTION_REGISTRY };
