# Synthetic fake secrets for regex tests. Not real credentials.
"""Integration test for Story 10.1 — transcript POST + DB-level scrubbing.

Posts a transcript containing every supported secret type and asserts that
no original secret survives in `raw_content` or `parsed_text`. Uses the same
mocked-DB pattern as `test_conversation_chain_e2e.py`.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_db_session
from app.main import create_app
from app.services.secret_scrubber import SECRET_PATTERNS

API_KEY = "test-api-key"
AUTH_HEADER = {"Authorization": f"Bearer {API_KEY}"}


def _build_transcript_with_every_secret() -> str:
    payloads = [
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": (
                    "My OpenAI key is sk-FAKETESTKEYFORUNITTESTS000000000 and "
                    "my Anthropic one is sk-ant-FAKETESTKEYFORUNITTESTS000000000."
                ),
            },
        },
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": (
                    "AWS access key AKIAFAKETESTKEYEXAMP, "
                    "GitHub token ghp_FAKETESTTOKENFORUNITTESTS00000000000, "
                    "Google AIzaSyFAKETESTKEYFORUNITTESTS0000000000, "
                    "Slack xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS."
                ),
            },
        },
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": (
                    "Use header Authorization: Bearer "
                    "abcdefghijklmnopqrstuvwxyz1234567890 and JWT "
                    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0."
                    "FAKETESTSIGNATUREFORUNITTESTS."
                ),
            },
        },
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": (
                    "DB: postgres://testuser:testfakepassword@testhost:5432/testdb and "
                    "CLIENT_SECRET=fakeClientSecretValue, AUTH_SECRET=fakeAuthSecretValue."
                ),
            },
        },
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": (
                    'JSON blob: {"password": "plainFakePass123", '
                    '"refresh_token": "fakeRefreshValue_0001"}.'
                ),
            },
        },
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": (
                    "PEM:\\n-----BEGIN RSA PRIVATE KEY-----\\n"
                    "FAKEPEMBODYLINE1FAKEPEMBODYLINE1\\n"
                    "FAKEPEMBODYLINE2FAKEPEMBODYLINE2\\n"
                    "-----END RSA PRIVATE KEY-----"
                ),
            },
        },
    ]
    return "\n".join(json.dumps(p) for p in payloads)


ORIGINAL_SECRETS = [
    "sk-FAKETESTKEYFORUNITTESTS000000000",
    "sk-ant-FAKETESTKEYFORUNITTESTS000000000",
    "AKIAFAKETESTKEYEXAMP",
    "ghp_FAKETESTTOKENFORUNITTESTS00000000000",
    "AIzaSyFAKETESTKEYFORUNITTESTS0000000000",
    "xoxb-FAKE-FAKE-FAKE-FAKETOKENUNITTESTS",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.FAKETESTSIGNATUREFORUNITTESTS",
    "abcdefghijklmnopqrstuvwxyz1234567890",
    "testfakepassword",
    "fakeClientSecretValue",
    "fakeAuthSecretValue",
    "plainFakePass123",
    "fakeRefreshValue_0001",
    "FAKEPEMBODYLINE1",
    "FAKEPEMBODYLINE2",
]


class _FakeState:
    def __init__(self) -> None:
        self.transcripts: list[MagicMock] = []
        self._next_id = 1

    def make_session(self, session_id: str) -> AsyncMock:
        mock = AsyncMock()
        state = self
        call_idx = {"n": 0}

        async def _execute(stmt, *args, **kwargs) -> MagicMock:  # noqa: ANN001, ANN002, ANN003
            call_idx["n"] += 1
            r = MagicMock()
            n = call_idx["n"]
            if n == 1:
                r.scalar_one_or_none.return_value = None
            else:
                r.scalar.return_value = 0
            return r

        def _add(obj) -> None:  # noqa: ANN001
            obj.id = state._next_id
            state._next_id += 1
            state.transcripts.append(obj)

        async def _refresh(obj) -> None:  # noqa: ANN001
            pass

        async def _commit() -> None:
            pass

        mock.execute = AsyncMock(side_effect=_execute)
        mock.add = MagicMock(side_effect=_add)
        mock.refresh = AsyncMock(side_effect=_refresh)
        mock.commit = AsyncMock(side_effect=_commit)
        return mock


@pytest.mark.asyncio
async def test_post_transcript_redacts_all_secrets_before_db_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

    app = create_app()

    arq = AsyncMock()
    arq.enqueue_job = AsyncMock(return_value=AsyncMock(job_id="job-1"))
    app.state.redis_pool = arq

    state = _FakeState()
    session = state.make_session("session-secrets")

    async def _override_db() -> AsyncGenerator[AsyncMock, None]:
        yield session

    app.dependency_overrides[get_db_session] = _override_db

    transcript_jsonl = _build_transcript_with_every_secret()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/conversations",
            json={
                "sessionId": "session-secrets",
                "transcript": transcript_jsonl,
                "source": "stop",
            },
            headers=AUTH_HEADER,
        )

    assert resp.status_code == 202, resp.text
    assert len(state.transcripts) == 1

    stored = state.transcripts[0]

    for secret in ORIGINAL_SECRETS:
        assert secret not in stored.raw_content, f"Secret {secret!r} leaked into raw_content"
        assert secret not in stored.parsed_text, f"Secret {secret!r} leaked into parsed_text"

    for name, pattern, _replacement in SECRET_PATTERNS:
        if name == "url_basic_auth":
            continue
        assert not pattern.search(stored.raw_content), f"Pattern {name} still matches raw_content"
        assert not pattern.search(stored.parsed_text), f"Pattern {name} still matches parsed_text"


@pytest.mark.asyncio
async def test_post_transcript_without_secrets_is_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.main._run_migrations", AsyncMock())
    monkeypatch.setattr("app.main._start_arq_pool", AsyncMock())

    app = create_app()
    arq = AsyncMock()
    arq.enqueue_job = AsyncMock(return_value=AsyncMock(job_id="job-1"))
    app.state.redis_pool = arq

    state = _FakeState()
    session = state.make_session("session-clean")

    async def _override_db() -> AsyncGenerator[AsyncMock, None]:
        yield session

    app.dependency_overrides[get_db_session] = _override_db

    clean = (
        '{"type":"user","message":{"role":"user",'
        '"content":"Let us refactor the UserService."}}\n'
        '{"type":"assistant","message":{"role":"assistant",'
        '"content":"Agreed, move validation into a dedicated usecase class."}}'
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/conversations",
            json={
                "sessionId": "session-clean",
                "transcript": clean,
                "source": "stop",
            },
            headers=AUTH_HEADER,
        )

    assert resp.status_code == 202
    stored = state.transcripts[0]
    assert stored.raw_content == clean
