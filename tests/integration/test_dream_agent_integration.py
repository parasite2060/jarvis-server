import os
from datetime import date, datetime

import pytest
import structlog

from app.services.dream_agent import (
    DeepDreamDeps,
    DreamDeps,
    run_deep_dream_consolidation,
    run_dream_extraction,
)
from app.services.dream_models import ConsolidationOutput, DreamExtraction

log = structlog.get_logger("jarvis.tests.integration.dream_agent")

pytestmark = pytest.mark.integration

SKIP_REASON = "Set RUN_INTEGRATION=1 to run integration tests"
skip_unless_integration = pytest.mark.skipif(
    os.environ.get("RUN_INTEGRATION") != "1",
    reason=SKIP_REASON,
)


def _build_short_transcript() -> list[str]:
    return [
        "user: I've decided to switch from REST to GraphQL for the new API",
        "assistant: That's a significant architectural decision. What drove it?",
        "user: We need real-time subscriptions and the frontend team prefers it",
        "assistant: Makes sense. GraphQL subscriptions are well-suited for that.",
        "user: Also, I prefer using Python 3.12 for all new services",
        "assistant: Good choice, the performance improvements are notable.",
        "user: One more thing - we should always use structured logging",
        "assistant: Agreed, structlog is excellent for that in Python.",
        "user: Let's use PostgreSQL instead of MongoDB for this project",
        "assistant: PostgreSQL with async drivers like asyncpg works great.",
    ]


def _build_long_transcript() -> list[str]:
    lines: list[str] = []
    topics = [
        ("database migration", "We need to plan the database migration carefully"),
        ("API design", "The API should follow REST best practices"),
        ("testing strategy", "We need both unit and integration tests"),
        ("deployment", "Let's use Docker and Kubernetes"),
        ("monitoring", "Prometheus and Grafana for metrics"),
    ]
    for i in range(100):
        topic, content = topics[i % len(topics)]
        role = "user" if i % 2 == 0 else "assistant"
        lines.append(f"{role}: [{topic}] {content} - message {i}")
    return lines


@skip_unless_integration
class TestLightDreamAgentIntegration:
    async def test_short_transcript_extraction(self) -> None:
        deps = DreamDeps(
            transcript_id=999,
            parsed_lines=_build_short_transcript(),
            session_id="integration-test-short",
            project="test-project",
            token_count=200,
            created_at=datetime(2026, 4, 5, 10, 0, 0),
        )

        extraction, usage, tool_call_count = await run_dream_extraction(deps)

        assert isinstance(extraction, DreamExtraction)
        log.info(
            "integration.light_dream.short",
            input_tokens=usage.request_tokens,
            output_tokens=usage.response_tokens,
            total_tokens=usage.total_tokens,
            tool_calls=tool_call_count,
            no_extract=extraction.no_extract,
        )

        if not extraction.no_extract:
            total_memories = sum(
                len(getattr(extraction, cat))
                for cat in ("decisions", "preferences", "patterns", "corrections", "facts")
            )
            assert total_memories > 0

    async def test_long_transcript_within_usage_limits(self) -> None:
        deps = DreamDeps(
            transcript_id=998,
            parsed_lines=_build_long_transcript(),
            session_id="integration-test-long",
            project="test-project",
            token_count=5000,
            created_at=datetime(2026, 4, 5, 10, 0, 0),
        )

        extraction, usage, tool_call_count = await run_dream_extraction(deps)

        assert isinstance(extraction, DreamExtraction)
        assert usage.total_tokens is None or usage.total_tokens <= 150_000
        log.info(
            "integration.light_dream.long",
            input_tokens=usage.request_tokens,
            output_tokens=usage.response_tokens,
            total_tokens=usage.total_tokens,
            tool_calls=tool_call_count,
        )


@skip_unless_integration
class TestDeepDreamAgentIntegration:
    async def test_consolidation_with_sample_memories(self) -> None:
        deps = DeepDreamDeps(
            source_date=date(2026, 4, 5),
            memu_memories=[
                {
                    "content": "User prefers dark mode in all applications",
                    "category": "preferences",
                    "vault_target": "memory",
                    "source_date": "2026-04-05",
                },
                {
                    "content": "Decided to use PostgreSQL for the new project",
                    "category": "decisions",
                    "vault_target": "decisions",
                    "source_date": "2026-04-05",
                },
                {
                    "content": "Always use structured logging with structlog",
                    "category": "patterns",
                    "vault_target": "patterns",
                    "source_date": "2026-04-05",
                },
            ],
            memory_md="# Memory\n\n## Preferences\n- Likes concise communication\n",
            daily_log="## 2026-04-05\n- Worked on dream agent implementation\n",
            soul_md="# Soul\nBe helpful, concise, and accurate.\n",
        )

        output, usage, tool_call_count = await run_deep_dream_consolidation(deps)

        assert isinstance(output, ConsolidationOutput)
        assert len(output.memory_md) > 0
        log.info(
            "integration.deep_dream",
            input_tokens=usage.request_tokens,
            output_tokens=usage.response_tokens,
            total_tokens=usage.total_tokens,
            tool_calls=tool_call_count,
            memory_md_lines=len(output.memory_md.splitlines()),
        )
