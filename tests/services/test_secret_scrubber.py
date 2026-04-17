# Synthetic fake secrets for regex tests. Not real credentials.
"""Unit tests for the SecretScrubber service.

Per Story 10.1 AC5, every AC3 pattern has a positive test with a realistic
fixture, and a 500+ char "no false positives" test ensures normal technical
conversation text passes through unchanged.
"""

from __future__ import annotations

from app.services.secret_scrubber import scrub


class TestOpenAIKeys:
    def test_redacts_openai_api_key(self) -> None:
        text = "My key is sk-FAKETESTKEYFORUNITTESTS000000000 please keep it secret."

        scrubbed, counts = scrub(text)

        assert "[REDACTED_API_KEY]" in scrubbed
        assert "sk-FAKETESTKEYFORUNITTESTS000000000" not in scrubbed
        assert counts.get("openai_api_key", 0) >= 1


class TestAnthropicKeys:
    def test_redacts_anthropic_api_key(self) -> None:
        text = "export ANTHROPIC=sk-ant-FAKETESTKEYFORUNITTESTS000000000"

        scrubbed, counts = scrub(text)

        assert "[REDACTED_API_KEY]" in scrubbed
        assert "sk-ant-FAKETESTKEYFORUNITTESTS000000000" not in scrubbed
        assert counts.get("anthropic_api_key", 0) >= 1


class TestAWSKeys:
    def test_redacts_aws_access_key(self) -> None:
        text = 'AWS_ACCESS_KEY_ID="AKIAFAKETESTKEYEXAMP"'

        scrubbed, counts = scrub(text)

        assert "[REDACTED_AWS_KEY]" in scrubbed
        assert "AKIAFAKETESTKEYEXAMP" not in scrubbed
        assert counts.get("aws_access_key", 0) >= 1


class TestGitHubTokens:
    def test_redacts_github_personal_token(self) -> None:
        text = "my GitHub PAT is ghp_FAKETESTTOKENFORUNITTESTS00000000000 for CI"

        scrubbed, counts = scrub(text)

        assert "[REDACTED_GITHUB_TOKEN]" in scrubbed
        assert "ghp_FAKETESTTOKENFORUNITTESTS00000000000" not in scrubbed
        assert counts.get("github_token", 0) >= 1

    def test_redacts_github_oauth_token(self) -> None:
        text = "OAuth credential gho_FAKETESTTOKENFORUNITTESTS00000000000 returned"

        scrubbed, counts = scrub(text)

        assert "[REDACTED_GITHUB_TOKEN]" in scrubbed
        assert "gho_FAKETESTTOKENFORUNITTESTS00000000000" not in scrubbed
        assert counts.get("github_token", 0) >= 1


class TestGoogleKeys:
    def test_redacts_google_api_key(self) -> None:
        text = "GOOGLE_API_KEY: AIzaSyFAKETESTKEYFORUNITTESTS0000000000"

        scrubbed, counts = scrub(text)

        assert "[REDACTED_GOOGLE_KEY]" in scrubbed
        assert "AIzaSyFAKETESTKEYFORUNITTESTS0000000000" not in scrubbed
        assert counts.get("google_api_key", 0) >= 1


class TestSlackTokens:
    def test_redacts_slack_bot_token(self) -> None:
        text = "SLACK_BOT=xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS"

        scrubbed, counts = scrub(text)

        assert "[REDACTED_SLACK_TOKEN]" in scrubbed
        assert "xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS" not in scrubbed
        assert counts.get("slack_token", 0) >= 1


class TestJWT:
    def test_redacts_jwt(self) -> None:
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.FAKETESTSIGNATUREFORUNITTESTS"
        text = f"Authorization header: {jwt}"

        scrubbed, counts = scrub(text)

        assert "[REDACTED_JWT]" in scrubbed
        assert jwt not in scrubbed
        assert counts.get("jwt", 0) >= 1


class TestPEM:
    def test_redacts_multiline_pem_block(self) -> None:
        text = (
            "Here is my key:\n"
            "-----BEGIN RSA PRIVATE KEY-----\n"
            "FAKETESTKEYBASE64LINE1FAKETESTKEYBASE64LINE1\n"
            "FAKETESTKEYBASE64LINE2FAKETESTKEYBASE64LINE2\n"
            "-----END RSA PRIVATE KEY-----\n"
            "End of key."
        )

        scrubbed, counts = scrub(text)

        assert "[REDACTED_PEM]" in scrubbed
        assert "FAKETESTKEYBASE64LINE1" not in scrubbed
        assert "FAKETESTKEYBASE64LINE2" not in scrubbed
        assert "BEGIN RSA PRIVATE KEY" not in scrubbed
        assert counts.get("pem", 0) == 1
        assert scrubbed.count("[REDACTED_PEM]") == 1

    def test_redacts_generic_pem_block(self) -> None:
        text = (
            "-----BEGIN PRIVATE KEY-----\n"
            "FAKETESTKEYBASE64LINEAAAAAAAAAAAAAAAAAA\n"
            "-----END PRIVATE KEY-----"
        )

        scrubbed, counts = scrub(text)

        assert "[REDACTED_PEM]" in scrubbed
        assert counts.get("pem", 0) == 1


class TestURLBasicAuth:
    def test_redacts_postgres_connection_string(self) -> None:
        text = "DB_URL=postgres://testuser:testfakepassword@testhost:5432/testdb"

        scrubbed, counts = scrub(text)

        assert "testuser" not in scrubbed
        assert "testfakepassword" not in scrubbed
        assert "[REDACTED_USER]:[REDACTED_PW]@" in scrubbed
        assert "postgres://[REDACTED_USER]:[REDACTED_PW]@testhost:5432/testdb" in scrubbed
        assert counts.get("url_basic_auth", 0) >= 1

    def test_redacts_mongodb_srv_connection_string(self) -> None:
        text = "mongodb+srv://appuser:fakeapppass@cluster0.example.mongodb.net/app"

        scrubbed, counts = scrub(text)

        assert "appuser" not in scrubbed
        assert "fakeapppass" not in scrubbed
        assert "[REDACTED_USER]:[REDACTED_PW]@" in scrubbed
        assert counts.get("url_basic_auth", 0) >= 1

    def test_redacts_https_basic_auth(self) -> None:
        text = "https://me:fakesecretvalue@example.com/path"

        scrubbed, counts = scrub(text)

        assert "me:fakesecretvalue@" not in scrubbed
        assert "[REDACTED_USER]:[REDACTED_PW]@" in scrubbed
        assert counts.get("url_basic_auth", 0) >= 1


class TestBearerToken:
    def test_redacts_bearer_token(self) -> None:
        text = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890"

        scrubbed, counts = scrub(text)

        assert "[REDACTED_TOKEN]" in scrubbed
        assert "abcdefghijklmnopqrstuvwxyz1234567890" not in scrubbed
        assert counts.get("bearer_token", 0) >= 1


class TestJSONSecretValues:
    def test_redacts_json_password_value(self) -> None:
        text = '{"password": "my-super-secret-pass"}'

        scrubbed, counts = scrub(text)

        assert "[REDACTED]" in scrubbed
        assert "my-super-secret-pass" not in scrubbed
        assert counts.get("json_secret_value", 0) >= 1

    def test_redacts_json_client_secret(self) -> None:
        text = '{"client_secret": "fakeClientSecretValue123"}'

        scrubbed, counts = scrub(text)

        assert "[REDACTED]" in scrubbed
        assert "fakeClientSecretValue123" not in scrubbed
        assert counts.get("json_secret_value", 0) >= 1

    def test_redacts_json_refresh_token(self) -> None:
        text = '{"refresh_token": "fakeRefresh_abc123"}'

        scrubbed, counts = scrub(text)

        assert "[REDACTED]" in scrubbed
        assert "fakeRefresh_abc123" not in scrubbed
        assert counts.get("json_secret_value", 0) >= 1


class TestEnvVarAssignments:
    def test_redacts_client_secret_env(self) -> None:
        text = "CLIENT_SECRET=fakeClientSecretValue"

        scrubbed, counts = scrub(text)

        assert "fakeClientSecretValue" not in scrubbed
        assert "CLIENT_SECRET=[REDACTED]" in scrubbed
        assert counts.get("env_secret_assignment", 0) >= 1

    def test_redacts_auth_secret_env(self) -> None:
        text = "AUTH_SECRET=fakeAuthSecretValue"

        scrubbed, counts = scrub(text)

        assert "fakeAuthSecretValue" not in scrubbed
        assert "AUTH_SECRET=[REDACTED]" in scrubbed
        assert counts.get("env_secret_assignment", 0) >= 1

    def test_redacts_db_password_env(self) -> None:
        text = "DB_PASSWORD=fakeDbPassword"

        scrubbed, counts = scrub(text)

        assert "fakeDbPassword" not in scrubbed
        assert counts.get("env_secret_assignment", 0) >= 1

    def test_redacts_encryption_key_env(self) -> None:
        text = "ENCRYPTION_KEY=fakeEncryptionKeyValue"

        scrubbed, counts = scrub(text)

        assert "fakeEncryptionKeyValue" not in scrubbed
        assert counts.get("env_secret_assignment", 0) >= 1

    def test_redacts_signing_key_env(self) -> None:
        text = "SIGNING_KEY=fakeSigningKeyValue"

        scrubbed, counts = scrub(text)

        assert "fakeSigningKeyValue" not in scrubbed
        assert counts.get("env_secret_assignment", 0) >= 1


class TestNoFalsePositives:
    def test_realistic_technical_conversation_unchanged(self) -> None:
        text = (
            "Let's walk through the refactor of `UserService`. The current implementation "
            "keeps the business logic inside the controller which makes it hard to test. "
            "I suggested moving the `validateUser` method into a dedicated class under "
            "`src/modules/user/usecases/validate-user.usecase.ts` so we can inject it with "
            "NestJS DI. The repository pattern we use for Mongo gives us a clean boundary: "
            "domain entities don't import Mongoose, and `mapToEntity()` converts the "
            "persistence shape. One gotcha we hit: when the order of decorators on a class "
            "is wrong, the pipe validation silently skips. Order matters. Also discussed "
            "whether to centralize logging or keep it per-module — decided per-module for "
            "now since the telemetry library auto-injects correlation IDs. For API "
            "documentation we'll use OpenAPI via Nest's built-in plugin; should generate "
            "clean specs from the DTOs we already have. Finally: talked about retry "
            "strategies for transient Kafka errors, backoff with jitter is the way."
        )
        assert len(text) >= 500

        scrubbed, counts = scrub(text)

        assert scrubbed == text
        assert counts == {}

    def test_empty_input(self) -> None:
        scrubbed, counts = scrub("")

        assert scrubbed == ""
        assert counts == {}

    def test_word_password_in_prose_not_redacted(self) -> None:
        text = "I need to rotate the password I shared last week."

        scrubbed, counts = scrub(text)

        assert scrubbed == text
        assert counts == {}


class TestCombinedInput:
    def test_multiple_secrets_all_redacted(self) -> None:
        text = (
            "OpenAI: sk-FAKETESTKEYFORUNITTESTS000000000\n"
            "GitHub: ghp_FAKETESTTOKENFORUNITTESTS00000000000\n"
            "DB: postgres://appuser:fakeapppass@db:5432/app\n"
            "-----BEGIN RSA PRIVATE KEY-----\n"
            "FAKEPEMBODY1FAKEPEMBODY1FAKEPEMBODY1\n"
            "-----END RSA PRIVATE KEY-----\n"
        )

        scrubbed, counts = scrub(text)

        assert "sk-FAKETESTKEYFORUNITTESTS000000000" not in scrubbed
        assert "ghp_FAKETESTTOKENFORUNITTESTS00000000000" not in scrubbed
        assert "appuser" not in scrubbed
        assert "fakeapppass" not in scrubbed
        assert "FAKEPEMBODY1" not in scrubbed

        assert counts.get("openai_api_key", 0) >= 1
        assert counts.get("github_token", 0) >= 1
        assert counts.get("url_basic_auth", 0) >= 1
        assert counts.get("pem", 0) >= 1
