from __future__ import annotations

import re

_PEM_PATTERN = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    re.DOTALL,
)

_ANTHROPIC_PATTERN = re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")
_OPENAI_PATTERN = re.compile(r"sk-[A-Za-z0-9_-]{20,}")
_AWS_PATTERN = re.compile(r"AKIA[A-Z0-9]{16}")
_GITHUB_PATTERN = re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")
_GOOGLE_PATTERN = re.compile(r"AIzaSy[A-Za-z0-9_-]{33}")
_SLACK_PATTERN = re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")
_JWT_PATTERN = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")

_URL_BASIC_AUTH_PATTERN = re.compile(
    r"(?P<scheme>https?|postgres|postgresql|mongodb(?:\+srv)?|redis|amqp|mysql)://"
    r"(?P<user>[^\s:/@]+):(?P<pw>[^\s@]+)@"
)

_BEARER_PATTERN = re.compile(r"([Bb]earer\s+)[A-Za-z0-9_.\-/+=]{20,}")

_JSON_SECRET_KEYS = (
    "password",
    "passwd",
    "secret",
    "api_key",
    "apikey",
    "api-secret",
    "access_token",
    "auth_token",
    "refresh_token",
    "client_secret",
    "private_key",
    "signing_key",
    "encryption_key",
)

_JSON_SECRET_KEY_GROUP = "|".join(re.escape(k) for k in _JSON_SECRET_KEYS)
_JSON_SECRET_PATTERN = re.compile(
    r'(\\?"(?:' + _JSON_SECRET_KEY_GROUP + r')\\?"\s*:\s*\\?")(?!\[REDACTED)([^"\\]+)(\\?")',
    re.IGNORECASE,
)

_ENV_SECRET_NAMES = (
    "API_KEY",
    "APIKEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "AUTH_TOKEN",
    "ACCESS_TOKEN",
    "REFRESH_TOKEN",
    "CLIENT_SECRET",
    "AUTH_SECRET",
    "DB_PASSWORD",
    "ENCRYPTION_KEY",
    "SIGNING_KEY",
    "PRIVATE_KEY",
)

_ENV_SECRET_PATTERN = re.compile(
    r"((?:" + "|".join(_ENV_SECRET_NAMES) + r")\s*=\s*)(?!\[REDACTED)(\S+)",
    re.IGNORECASE,
)


def _redact_url_basic_auth(match: re.Match[str]) -> str:
    return f"{match.group('scheme')}://[REDACTED_USER]:[REDACTED_PW]@"


SECRET_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("pem", _PEM_PATTERN, "[REDACTED_PEM]"),
    ("anthropic_api_key", _ANTHROPIC_PATTERN, "[REDACTED_API_KEY]"),
    ("openai_api_key", _OPENAI_PATTERN, "[REDACTED_API_KEY]"),
    ("aws_access_key", _AWS_PATTERN, "[REDACTED_AWS_KEY]"),
    ("github_token", _GITHUB_PATTERN, "[REDACTED_GITHUB_TOKEN]"),
    ("google_api_key", _GOOGLE_PATTERN, "[REDACTED_GOOGLE_KEY]"),
    ("slack_token", _SLACK_PATTERN, "[REDACTED_SLACK_TOKEN]"),
    ("jwt", _JWT_PATTERN, "[REDACTED_JWT]"),
    ("url_basic_auth", _URL_BASIC_AUTH_PATTERN, _redact_url_basic_auth),
    ("bearer_token", _BEARER_PATTERN, r"\1[REDACTED_TOKEN]"),
    ("json_secret_value", _JSON_SECRET_PATTERN, r"\1[REDACTED]\3"),
    ("env_secret_assignment", _ENV_SECRET_PATTERN, r"\1[REDACTED]"),
]


def scrub(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    scrubbed = text

    for name, pattern, replacement in SECRET_PATTERNS:
        scrubbed, count = pattern.subn(replacement, scrubbed)
        if count:
            counts[name] = count

    return scrubbed, counts
