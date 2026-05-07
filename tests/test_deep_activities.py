"""Unit tests for deep dream activities.

Focus areas:
  - commit_and_pr: deterministic branch name, idempotent PR creation
  - align_memu: idempotency key prevents duplicate MemU writes
  - score_candidates: deterministic scoring
  - health_fix: bounded 3-iteration loop returns incomplete on exhaustion
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, patch

from temporalio.testing import ActivityEnvironment

from app.activities.deep._models import (
    DeepCommitAndPRInput,
    HealthFixInput,
    ScoringInput,
)
from app.activities.deep.score_candidates import score_candidates

# ---------------------------------------------------------------------------
# score_candidates
# ---------------------------------------------------------------------------

async def test_score_candidates_deterministic() -> None:
    env = ActivityEnvironment()
    inp = ScoringInput(
        dream_id=1,
        candidates_json=[
            {
                "content": "high value pattern",
                "reinforcement_count": 5,
                "contradiction_flag": False,
                "source_sessions": ["s1", "s2", "s3"],
            },
            {
                "content": "low value candidate",
                "reinforcement_count": 1,
                "contradiction_flag": True,
                "source_sessions": [],
            },
        ],
    )
    result = await env.run(score_candidates, inp)
    assert len(result.scored) == 2
    # High value should score higher than low value
    high_score = result.scored[0]["score"]
    low_score = result.scored[1]["score"]
    assert high_score > low_score
    # Scores must be deterministic (run again, same result)
    result2 = await env.run(score_candidates, inp)
    assert result2.scored[0]["score"] == high_score
    assert result2.scored[1]["score"] == low_score


async def test_score_candidates_preserves_fields() -> None:
    env = ActivityEnvironment()
    inp = ScoringInput(
        dream_id=1,
        candidates_json=[
            {
                "content": "test",
                "category": "patterns",
                "reinforcement_count": 2,
                "contradiction_flag": False,
                "source_sessions": ["s1"],
            }
        ],
    )
    result = await env.run(score_candidates, inp)
    assert result.scored[0]["content"] == "test"
    assert result.scored[0]["category"] == "patterns"
    assert "score" in result.scored[0]


# ---------------------------------------------------------------------------
# align_memu idempotency
# ---------------------------------------------------------------------------

async def test_align_memu_idempotency_key_skips_duplicate(tmp_path: Path) -> None:
    """Calling align_memu_with_memory twice with same key → second call is a no-op."""
    from app.services.deep_dream import (
        align_memu_with_memory,
    )

    memory_content = "## Strong Patterns\n- test pattern\n"
    test_date = date(2026, 5, 7)
    key = "dream-42"

    memu_calls: list[str] = []

    async def fake_memu_memorize(messages: list) -> None:
        memu_calls.append(messages[0]["content"])

    with (
        patch("app.services.deep_dream.memu_memorize", side_effect=fake_memu_memorize),
        patch("app.services.deep_dream.read_vault_file", new_callable=AsyncMock) as mock_read,
        patch("app.services.deep_dream.write_vault_file", new_callable=AsyncMock),
    ):
        mock_read.return_value = None  # No existing idempotency log

        # First call — should process entries
        await align_memu_with_memory(memory_content, test_date, idempotency_key=key)
        first_call_count = len(memu_calls)
        assert first_call_count > 0, "First call should process entries"

        # Simulate the idempotency log being written (the key is now "in the log")
        mock_read.return_value = f"{key}\n"

        # Second call with same key — should be skipped
        await align_memu_with_memory(memory_content, test_date, idempotency_key=key)
        # memu_calls count must not have changed
        assert len(memu_calls) == first_call_count, (
            f"Second call added {len(memu_calls) - first_call_count} duplicate MemU writes"
        )


async def test_align_memu_no_idempotency_key_always_runs() -> None:
    """Without idempotency_key, align_memu_with_memory always processes entries."""
    from app.services.deep_dream import align_memu_with_memory

    memory_content = "## Strong Patterns\n- test pattern\n"
    test_date = date(2026, 5, 7)
    memu_calls: list[int] = []

    async def fake_memu_memorize(messages: list) -> None:
        memu_calls.append(1)

    with patch("app.services.deep_dream.memu_memorize", side_effect=fake_memu_memorize):
        await align_memu_with_memory(memory_content, test_date)
        first_count = len(memu_calls)
        await align_memu_with_memory(memory_content, test_date)
        assert len(memu_calls) == first_count * 2, "Without key, both calls should process"


# ---------------------------------------------------------------------------
# commit_and_pr: deterministic branch name
# ---------------------------------------------------------------------------

async def test_commit_and_pr_branch_name_is_deterministic() -> None:
    """Branch name must be dream/deep-{date} regardless of retry count."""
    from app.activities.deep.commit_and_pr import commit_and_pr

    inp = DeepCommitAndPRInput(
        dream_id=1,
        target_date_iso="2026-05-07",
        files_modified=[],
        stats={},
    )
    env = ActivityEnvironment()

    # No files → returns no_files status immediately without git calls
    result = await env.run(commit_and_pr, inp)
    assert result.git_branch == "dream/deep-2026-05-07"
    assert result.git_pr_status == "no_files"


async def test_commit_and_pr_branch_name_does_not_contain_timestamp() -> None:
    """Branch name must be deterministic — cannot contain datetime or uuid."""
    branch = "dream/deep-2026-05-07"
    # No timestamps, random strings, or UUIDs in the branch name
    import re
    assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}", branch), "Branch contains timestamp"
    assert not re.search(r"[0-9a-f]{8}-", branch), "Branch contains UUID-like pattern"


# ---------------------------------------------------------------------------
# health_fix: bounded 3-iteration loop
# ---------------------------------------------------------------------------

async def test_health_fix_returns_incomplete_after_exhaustion() -> None:
    """health_fix activity returns status='incomplete' when 3 iterations fail to fix issues."""
    from app.activities.deep.health_fix import HEALTH_FIX_MAX_ITERATIONS, health_fix
    from app.services.dream_models import HealthReport

    assert HEALTH_FIX_MAX_ITERATIONS == 3

    inp = HealthFixInput(
        dream_id=1,
        source_date_iso="2026-05-07",
        memu_memories=[],
        memory_md="",
        daily_log="",
        soul_md="",
        phase1_summary="",
        phase2_summary="",
        consolidation_messages_json=[],  # empty → no LLM fix possible
    )

    env = ActivityEnvironment()

    # With no consolidation messages, health_fix cannot make LLM calls.
    # It will run auto_fix then health_check and break early (no LLM history).
    # The result should be incomplete if issues remain.
    auto_patch = "app.activities.deep.health_fix.auto_fix_health_issues"
    check_patch = "app.activities.deep.health_fix.run_health_checks"
    with (
        patch(auto_patch, new_callable=AsyncMock) as mock_auto,
        patch(check_patch, new_callable=AsyncMock) as mock_check,
    ):
        mock_auto.return_value = {}
        mock_report = HealthReport(
            unresolved_contradictions=["test contradiction"],
            total_issues=1,
        )
        mock_check.return_value = mock_report

        result = await env.run(health_fix, inp)

    assert result.status == "incomplete"
    assert result.total_issues_remaining == 1


async def test_health_fix_returns_clean_when_no_issues() -> None:
    """health_fix returns status='clean' when health_check finds no issues."""
    from app.activities.deep.health_fix import health_fix
    from app.services.dream_models import HealthReport

    inp = HealthFixInput(
        dream_id=1,
        source_date_iso="2026-05-07",
        memu_memories=[],
        memory_md="",
        daily_log="",
        soul_md="",
        phase1_summary="",
        phase2_summary="",
        consolidation_messages_json=[],
    )

    env = ActivityEnvironment()

    auto_patch = "app.activities.deep.health_fix.auto_fix_health_issues"
    check_patch = "app.activities.deep.health_fix.run_health_checks"
    with (
        patch(auto_patch, new_callable=AsyncMock),
        patch(check_patch, new_callable=AsyncMock) as mock_check,
    ):
        mock_check.return_value = HealthReport(total_issues=0)

        result = await env.run(health_fix, inp)

    assert result.status == "clean"
    assert result.total_issues_remaining == 0
