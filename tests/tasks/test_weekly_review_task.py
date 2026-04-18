import contextlib
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.usage import RunUsage

from app.core.exceptions import DreamError
from app.models.tables import Dream, DreamPhase
from app.services.dream_agent import WEEKLY_REVIEW_USAGE_LIMITS
from app.services.dream_models import WeeklyReviewOutput

_TELEMETRY_PATCH = "app.tasks.weekly_review_task.store_phase_telemetry"


@pytest.fixture(autouse=True)
def _mock_telemetry() -> Any:
    """Autouse: prevent the real telemetry call from hitting the DB during unit tests."""
    with patch(_TELEMETRY_PATCH, new_callable=AsyncMock, return_value=1) as mock:
        yield mock


SAMPLE_MESSAGES: list[Any] = [
    MagicMock(model_dump=MagicMock(return_value={"role": "user", "content": "hi"})),
    MagicMock(model_dump=MagicMock(return_value={"role": "assistant", "content": "ok"})),
]

SAMPLE_REVIEW_OUTPUT = WeeklyReviewOutput(
    review_content="# Weekly Review: 2026-W15\n## Week Themes\n- Architecture\n",
    week_themes=["Architecture", "Testing"],
    stale_action_items=["Update deployment docs"],
    project_updates={"jarvis": "Completed weekly review feature"},
)

SAMPLE_EMPTY_REVIEW_OUTPUT = WeeklyReviewOutput(
    review_content="",
    week_themes=[],
    stale_action_items=[],
    project_updates={},
)

SAMPLE_USAGE = RunUsage(input_tokens=500, output_tokens=200, requests=1)

SAMPLE_GIT_RESULT: dict[str, str] = {
    "git_branch": "dream/review-2026-W15",
    "git_pr_url": "https://github.com/owner/repo/pull/99",
    "git_pr_status": "merged",
}


def _make_dream(dream_id: int = 1) -> Dream:
    d = Dream(
        type="weekly_review",
        trigger="auto",
        status="processing",
    )
    d.id = dream_id  # type: ignore[assignment]
    return d


class FakeSessionFactory:
    def __init__(self, dream: Dream) -> None:
        self.dream = dream

    def __call__(self) -> "FakeSessionFactory":
        return self

    async def __aenter__(self) -> "FakeSession":
        return FakeSession(self)

    async def __aexit__(self, *args: Any) -> None:
        pass


class FakeSession:
    def __init__(self, factory: FakeSessionFactory) -> None:
        self._factory = factory

    async def execute(self, stmt: Any) -> MagicMock:
        result = MagicMock()
        result.scalar_one.return_value = self._factory.dream
        return result

    def add(self, item: Any) -> None:
        pass

    async def commit(self) -> None:
        pass

    async def refresh(self, item: Any) -> None:
        if isinstance(item, Dream):
            item.id = self._factory.dream.id


def _phase_rows_from_telemetry_mock(telemetry_mock: AsyncMock) -> list[DreamPhase]:
    """Reconstruct DreamPhase rows from captured store_phase_telemetry calls.

    `store_phase_telemetry` writes one DreamPhase per call, so each call's kwargs
    map 1:1 to a DreamPhase row. Building DreamPhase objects from the kwargs lets
    tests assert on the row shape that would be persisted.
    """
    rows: list[DreamPhase] = []
    for call in telemetry_mock.call_args_list:
        kwargs = call.kwargs
        messages = kwargs.get("messages")
        usage = kwargs.get("usage")
        rows.append(
            DreamPhase(
                dream_id=kwargs.get("dream_id"),
                phase=kwargs.get("phase"),
                status=kwargs.get("status"),
                run_prompt=kwargs.get("run_prompt"),
                output_json=kwargs.get("output_json"),
                conversation_history=(
                    [m.model_dump() if hasattr(m, "model_dump") else m for m in messages]
                    if messages
                    else None
                ),
                input_tokens=getattr(usage, "input_tokens", None) if usage else None,
                output_tokens=getattr(usage, "output_tokens", None) if usage else None,
                total_tokens=getattr(usage, "total_tokens", None) if usage else None,
                tool_calls=kwargs.get("tool_calls", 0),
                duration_ms=kwargs.get("duration_ms"),
                error_message=kwargs.get("error_message"),
            )
        )
    return rows


def _pipeline_patches(
    dream: Dream,
    *,
    no_daily_logs: bool = False,
    review_output: WeeklyReviewOutput | None = None,
    agent_error: Exception | None = None,
    git_result: dict[str, str] | None = None,
    git_error: Exception | None = None,
    write_error: Exception | None = None,
) -> dict[str, Any]:
    async def mock_read_vault(path: str) -> str | None:
        if no_daily_logs:
            return None
        if path.startswith("dailys/"):
            return "## Session\nDid work."
        if path.endswith("/_index.md"):
            return "# Index\n- entry.md"
        return None

    mock_run_weekly = AsyncMock(
        return_value=(review_output or SAMPLE_REVIEW_OUTPUT, SAMPLE_USAGE, 10, SAMPLE_MESSAGES),
        side_effect=agent_error,
    )

    mock_write = AsyncMock(side_effect=write_error)

    patches: dict[str, Any] = {
        "app.tasks.weekly_review_task.async_session_factory": FakeSessionFactory(dream),
        "app.tasks.weekly_review_task.read_vault_file": AsyncMock(side_effect=mock_read_vault),
        "app.tasks.weekly_review_task.run_weekly_review": mock_run_weekly,
        "app.tasks.weekly_review_task.write_vault_file": mock_write,
        "app.tasks.weekly_review_task.git_ops_service.create_weekly_review_pr": AsyncMock(
            return_value=git_result or SAMPLE_GIT_RESULT,
            side_effect=git_error,
        ),
        "app.tasks.weekly_review_task.git_ops_service.cleanup_branch": AsyncMock(),
        "app.tasks.weekly_review_task.invalidate_context_cache": AsyncMock(),
    }
    return patches


async def _run_with_patches(patches: dict[str, Any], **kwargs: Any) -> dict[str, AsyncMock]:
    mocks: dict[str, AsyncMock] = {}
    with contextlib.ExitStack() as stack:
        for target, mock_obj in patches.items():
            mocks[target] = stack.enter_context(patch(target, mock_obj))

        from app.tasks.weekly_review_task import weekly_review_task

        await weekly_review_task({}, **kwargs)
    return mocks


@pytest.mark.asyncio
async def test_full_pipeline_success() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    assert dream.duration_ms is not None
    assert dream.completed_at is not None
    assert dream.files_modified is not None
    assert dream.git_branch == SAMPLE_GIT_RESULT["git_branch"]
    assert dream.git_pr_url == SAMPLE_GIT_RESULT["git_pr_url"]


@pytest.mark.asyncio
async def test_skip_when_no_daily_logs() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, no_daily_logs=True)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "skipped"


@pytest.mark.asyncio
async def test_skip_when_empty_review_content() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, review_output=SAMPLE_EMPTY_REVIEW_OUTPUT)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "skipped"


@pytest.mark.asyncio
async def test_agent_failure_marks_failed() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, agent_error=RuntimeError("LLM timeout"))

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "LLM timeout" in dream.error_message


@pytest.mark.asyncio
async def test_file_write_failure_marks_failed() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, write_error=RuntimeError("disk full"))

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None


@pytest.mark.asyncio
async def test_git_failure_does_not_fail_dream() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, git_error=RuntimeError("git push failed"))

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    assert dream.git_branch == ""


@pytest.mark.asyncio
async def test_review_file_includes_frontmatter() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    write_mock = patches["app.tasks.weekly_review_task.write_vault_file"]
    write_mock.assert_called_once()
    written_path = write_mock.call_args[0][0]
    written_content = write_mock.call_args[0][1]

    assert written_path.startswith("reviews/")
    assert "type: review" in written_content
    assert "tags: [review, weekly]" in written_content
    assert "week:" in written_content


@pytest.mark.asyncio
async def test_git_pr_uses_weekly_review_method() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    git_mock = patches["app.tasks.weekly_review_task.git_ops_service.create_weekly_review_pr"]
    git_mock.assert_called_once()


@pytest.mark.asyncio
async def test_context_cache_invalidated_after_pr() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    cache_mock = patches["app.tasks.weekly_review_task.invalidate_context_cache"]
    cache_mock.assert_called_once()


@pytest.mark.asyncio
async def test_weekly_review_cache_invalidates_on_git_failure() -> None:
    """Story 11.1 AC7a: git failure does not skip cache invalidation."""
    dream = _make_dream()
    patches = _pipeline_patches(dream, git_error=RuntimeError("git failed"))

    await _run_with_patches(patches, trigger="auto")

    cache_mock = patches["app.tasks.weekly_review_task.invalidate_context_cache"]
    cache_mock.assert_called_once()


@pytest.mark.asyncio
async def test_cleanup_branch_called() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    cleanup_mock = patches["app.tasks.weekly_review_task.git_ops_service.cleanup_branch"]
    cleanup_mock.assert_called_once()
    branch_arg = cleanup_mock.call_args[0][0]
    assert branch_arg.startswith("dream/review-")


@pytest.mark.asyncio
async def test_dream_row_type_is_weekly_review() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    assert dream.type == "weekly_review"


@pytest.mark.asyncio
async def test_manual_trigger_recorded() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="manual")

    assert dream.status == "completed"


def test_weekly_review_usage_limits_tool_calls() -> None:
    """AC2: pin tool_calls_limit at >= 80 to prevent silent regression."""
    assert WEEKLY_REVIEW_USAGE_LIMITS.tool_calls_limit is not None
    assert WEEKLY_REVIEW_USAGE_LIMITS.tool_calls_limit >= 80


@pytest.mark.asyncio
async def test_weekly_review_writes_phase_row_on_success(_mock_telemetry: AsyncMock) -> None:
    """AC11: success path writes exactly one DreamPhase row with expected fields."""
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    phase_rows = _phase_rows_from_telemetry_mock(_mock_telemetry)
    assert len(phase_rows) == 1
    row = phase_rows[0]
    assert isinstance(row, DreamPhase)
    assert row.phase == "weekly_review"
    assert row.status == "completed"
    assert row.run_prompt
    assert row.output_json is not None
    expected_keys = set(WeeklyReviewOutput.model_fields.keys())
    assert expected_keys.issubset(set(row.output_json.keys()))
    assert isinstance(row.conversation_history, list)
    assert len(row.conversation_history) > 0
    assert row.input_tokens is not None
    assert row.output_tokens is not None
    assert row.total_tokens is not None
    assert row.tool_calls is not None
    assert row.duration_ms is not None


@pytest.mark.asyncio
async def test_weekly_review_writes_phase_row_on_failure(_mock_telemetry: AsyncMock) -> None:
    """AC12: agent failure writes one DreamPhase row with status=failed; _mark_failed preserved."""
    dream = _make_dream()
    patches = _pipeline_patches(dream, agent_error=DreamError("test"))

    await _run_with_patches(patches, trigger="auto")

    phase_rows = _phase_rows_from_telemetry_mock(_mock_telemetry)
    assert len(phase_rows) == 1
    row = phase_rows[0]
    assert isinstance(row, DreamPhase)
    assert row.phase == "weekly_review"
    assert row.status == "failed"
    assert row.error_message is not None
    assert "test" in row.error_message

    assert dream.status == "failed"


@pytest.mark.asyncio
async def test_weekly_review_phase_row_written_for_empty_review(_mock_telemetry: AsyncMock) -> None:
    """AC7: empty review still writes telemetry (the agent ran successfully)."""
    dream = _make_dream()
    patches = _pipeline_patches(dream, review_output=SAMPLE_EMPTY_REVIEW_OUTPUT)

    await _run_with_patches(patches, trigger="auto")

    phase_rows = _phase_rows_from_telemetry_mock(_mock_telemetry)
    assert len(phase_rows) == 1
    assert phase_rows[0].status == "completed"


@pytest.mark.asyncio
async def test_weekly_review_no_phase_row_when_no_daily_logs(_mock_telemetry: AsyncMock) -> None:
    """AC9: skip-no-daily-logs path writes no phase row (agent never ran)."""
    dream = _make_dream()
    patches = _pipeline_patches(dream, no_daily_logs=True)

    await _run_with_patches(patches, trigger="auto")

    phase_rows = _phase_rows_from_telemetry_mock(_mock_telemetry)
    assert len(phase_rows) == 0
    assert dream.status == "skipped"


# ── Story 11.5: outcome enum tests ──


@pytest.mark.asyncio
async def test_weekly_review_outcome_wrote_files() -> None:
    """Happy path: review file written → outcome='wrote_files'."""
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    assert dream.outcome == "wrote_files"


@pytest.mark.asyncio
async def test_weekly_review_outcome_no_new_content() -> None:
    """Skipped path (no daily logs) → outcome='no_new_content'."""
    dream = _make_dream()
    patches = _pipeline_patches(dream, no_daily_logs=True)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "skipped"
    assert dream.outcome == "no_new_content"
