from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.usage import RunUsage

from app.core.exceptions import DreamError
from app.models.tables import Dream, Transcript
from app.services.dream_models import (
    ExtractionSummary,
    FileAction,
    MemoryItem,
    RecordResult,
    SessionLogEntry,
)

_TELEMETRY_PATCH = "app.tasks.light_dream_task.store_phase_telemetry"


@pytest.fixture(autouse=True)
def _mock_telemetry() -> Any:
    with patch(_TELEMETRY_PATCH, new_callable=AsyncMock, return_value=1):
        yield


SAMPLE_MEMORIES: list[MemoryItem] = [
    MemoryItem(
        content="Use FastAPI because async-first",
        reasoning="async-first and Pydantic integration",
        vault_target="decisions",
        source_date="2026-03-31",
    ),
    MemoryItem(
        content="Prefer httpx over requests",
        reasoning=None,
        vault_target="memory",
        source_date="2026-03-31",
    ),
    MemoryItem(
        content="Project uses PostgreSQL",
        reasoning=None,
        vault_target="memory",
        source_date="2026-03-31",
    ),
]


def _make_sample_summary(memories: list[MemoryItem] | None = None) -> ExtractionSummary:
    """Build a summary whose session_log carries the given memories.

    Mirrors production: session_log.memories is populated from deps.memories at
    end-of-extraction.
    """
    return ExtractionSummary(
        summary="Discussed architecture decisions",
        no_extract=False,
        session_log=SessionLogEntry(
            context="Architecture discussion",
            memories=memories or [],
        ),
    )


NO_EXTRACT_SUMMARY = ExtractionSummary(
    summary="Quick fix, nothing notable",
    no_extract=True,
    session_log=SessionLogEntry(),
)

SAMPLE_RECORD_RESULT = RecordResult(
    files=[
        FileAction(path="MEMORY.md", action="append"),
        FileAction(path="dailys/2026-03-31.md", action="create"),
    ],
    summary="Updated memory and daily log",
)

SAMPLE_USAGE = RunUsage(input_tokens=100, output_tokens=50, requests=1)


def _make_transcript(
    transcript_id: int = 1,
    status: str = "queued",
    parsed_text: str = "User: hello\n\nAssistant: hi there",
) -> Transcript:
    t = Transcript(
        session_id="sess-001",
        raw_content='{"messages": []}',
        parsed_text=parsed_text,
        status=status,
    )
    t.id = transcript_id  # type: ignore[assignment]
    t.light_dream_id = None
    t.segment_start_line = 0  # type: ignore[assignment]
    t.segment_end_line = 0  # type: ignore[assignment]
    t.last_processed_line = 0  # type: ignore[assignment]
    return t


def _make_dream(dream_id: int = 1) -> Dream:
    d = Dream(
        type="light",
        trigger="auto",
        status="processing",
    )
    d.id = dream_id  # type: ignore[assignment]
    return d


class FakeSessionFactory:
    """Tracks objects added and returns transcript/dream on queries."""

    def __init__(
        self,
        transcript: Transcript | None,
        dream: Dream,
    ) -> None:
        self.transcript = transcript
        self.dream = dream
        self.added_items: list[Any] = []

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
        stmt_str = str(stmt)
        if "transcripts" in stmt_str:
            result.scalar_one_or_none.return_value = self._factory.transcript
            result.scalar_one.return_value = self._factory.transcript
        elif "dreams" in stmt_str:
            result.scalar_one_or_none.return_value = self._factory.dream
            result.scalar_one.return_value = self._factory.dream
        else:
            result.scalar_one_or_none.return_value = None
            result.scalar_one.return_value = None
        return result

    def add(self, item: Any) -> None:
        self._factory.added_items.append(item)

    async def commit(self) -> None:
        pass

    async def refresh(self, item: Any) -> None:
        if isinstance(item, Dream):
            item.id = self._factory.dream.id


def _make_extraction_mock(
    memories: list[MemoryItem] | None = None,
    summary: ExtractionSummary | None = None,
    usage: RunUsage | None = None,
    side_effect: Exception | None = None,
) -> AsyncMock:
    """Create a mock for run_dream_extraction that mirrors production.

    Production semantics (dream_agent.run_dream_extraction):
    - Store tools append MemoryItem objects to `deps.memories`.
    - After the agent run, extraction assigns `output.session_log.memories = deps.memories`
      so memories travel as a property of SessionLogEntry, not a peer field.
    This mock reproduces both side effects.
    """
    mems = memories if memories is not None else SAMPLE_MEMORIES
    summ = summary or _make_sample_summary(memories=mems)
    usg = usage or SAMPLE_USAGE

    async def _fake_extraction(deps: Any) -> tuple:
        if side_effect:
            raise side_effect
        deps.memories.extend(mems)
        # Ensure the returned summary's session_log carries the same memories.
        if summ.session_log is not None and not summ.session_log.memories:
            summ.session_log.memories = list(mems)
        return (summ, usg, 3, [])

    return AsyncMock(side_effect=_fake_extraction)


def _make_no_extract_mock() -> AsyncMock:
    """Extraction that returns no_extract=True with no memories."""

    async def _fake_extraction(deps: Any) -> tuple:
        return (NO_EXTRACT_SUMMARY, SAMPLE_USAGE, 0, [])

    return AsyncMock(side_effect=_fake_extraction)


@pytest.mark.asyncio
async def test_full_pipeline_success() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/42",
            "git_pr_status": "merged",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_extract.assert_called_once()

    # Post-Story 9.35: memories are persisted inside dreams.session_log JSONB,
    # not as rows in a separate table.
    assert dream.session_log is not None
    assert isinstance(dream.session_log, dict)
    # All nine SessionLogEntry keys are always present.
    for key in (
        "context",
        "key_exchanges",
        "decisions_made",
        "lessons_learned",
        "failed_lessons",
        "action_items",
        "concepts",
        "connections",
        "memories",
    ):
        assert key in dream.session_log, f"session_log missing key: {key}"

    memories = dream.session_log["memories"]
    assert len(memories) == 3
    # Each element is a serialised MemoryItem
    # (dict with content/reasoning/vault_target/source_date).
    vault_targets = {m["vault_target"] for m in memories}
    assert vault_targets == {"decisions", "memory"}

    decision_mem = next(m for m in memories if m["vault_target"] == "decisions")
    assert decision_mem["reasoning"] == "async-first and Pydantic integration"
    assert decision_mem["source_date"] == "2026-03-31"

    assert dream.status == "completed"
    assert dream.duration_ms is not None
    assert dream.completed_at is not None
    assert transcript.status == "processed"
    assert transcript.light_dream_id == dream.id


@pytest.mark.asyncio
async def test_no_extract_pipeline() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_no_extract_mock()
    mock_merge = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    # no_extract=True: session_log stays NULL, no memories persisted.
    assert dream.session_log is None
    assert dream.status == "completed"
    mock_merge.assert_not_called()
    assert transcript.status == "processed"


@pytest.mark.asyncio
async def test_extraction_failure_marks_dream_failed() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock(side_effect=DreamError("API timeout"))
    mock_merge = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "API timeout" in dream.error_message
    # Extraction failure: session_log must stay NULL.
    assert dream.session_log is None
    assert transcript.status == "failed"
    mock_merge.assert_not_called()


@pytest.mark.asyncio
async def test_merge_failure_doesnt_fail_dream() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(side_effect=Exception("Merge agent unreachable"))

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.status == "completed"
    # session_log still persisted even when record fails (soft-fail).
    assert dream.session_log is not None
    assert len(dream.session_log["memories"]) == 3


@pytest.mark.asyncio
async def test_transcript_not_found_returns_early() -> None:
    factory = FakeSessionFactory(None, _make_dream())
    mock_extract = AsyncMock()
    mock_merge = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 99999)

    mock_extract.assert_not_called()
    mock_merge.assert_not_called()


@pytest.mark.asyncio
async def test_duration_ms_is_recorded() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/1",
            "git_pr_status": "created",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.duration_ms is not None
    assert isinstance(dream.duration_ms, int)
    assert dream.duration_ms >= 0


@pytest.mark.asyncio
async def test_all_memory_types_stored_with_correct_fields() -> None:
    # vault_target -> category mapping: if vault_target is in MEMORY_CATEGORIES it maps directly,
    # otherwise falls back to "facts". Only "decisions", "patterns", "facts" from MEMORY_CATEGORIES
    # overlap with VaultTarget values. Other vault_targets like "memory", "projects" map to "facts".
    all_memories = [
        MemoryItem(
            content="Use FastAPI",
            reasoning="async-first",
            vault_target="decisions",
            source_date="2026-03-31",
        ),
        MemoryItem(
            content="Prefer httpx",
            reasoning=None,
            vault_target="memory",
            source_date="2026-03-31",
        ),
        MemoryItem(
            content="Always READ before WRITE",
            reasoning=None,
            vault_target="patterns",
            source_date="2026-03-31",
        ),
        MemoryItem(
            content="Project uses PostgreSQL",
            reasoning=None,
            vault_target="projects",
            source_date="2026-03-31",
        ),
    ]
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock(memories=all_memories)
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/1",
            "git_pr_status": "created",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    # Memories persist inside dreams.session_log JSONB; each entry carries its
    # original vault_target — no more coercion to a MEMORY_CATEGORIES subset.
    assert dream.session_log is not None
    memories = dream.session_log["memories"]
    assert len(memories) == 4

    vault_targets = sorted(m["vault_target"] for m in memories)
    assert vault_targets == ["decisions", "memory", "patterns", "projects"]

    decision_mem = next(m for m in memories if m["vault_target"] == "decisions")
    assert decision_mem["content"] == "Use FastAPI"
    assert decision_mem["reasoning"] == "async-first"
    assert decision_mem["source_date"] == "2026-03-31"

    memory_target = next(m for m in memories if m["vault_target"] == "memory")
    assert memory_target["content"] == "Prefer httpx"

    project = next(m for m in memories if m["vault_target"] == "projects")
    assert project["content"] == "Project uses PostgreSQL"

    pattern = next(m for m in memories if m["vault_target"] == "patterns")
    assert pattern["content"] == "Always READ before WRITE"


@pytest.mark.asyncio
async def test_full_pipeline_with_merge_and_files() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/42",
            "git_pr_status": "merged",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_merge.assert_called_once()
    assert dream.status == "completed"
    assert dream.files_modified is not None
    assert len(dream.files_modified) == 2


@pytest.mark.asyncio
async def test_no_extract_skips_merge() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_no_extract_mock()
    mock_merge = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_merge.assert_not_called()
    assert dream.files_modified is None


@pytest.mark.asyncio
async def test_full_pipeline_with_git_pr() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/42",
            "git_pr_status": "merged",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_create_pr.assert_called_once()
    mock_invalidate.assert_called_once()
    mock_cleanup.assert_called_once()

    assert dream.status == "completed"
    assert dream.git_branch == "dream/light-2026-03-31-143000"
    assert dream.git_pr_url == "https://github.com/owner/repo/pull/42"
    assert dream.git_pr_status == "merged"


@pytest.mark.asyncio
async def test_git_failure_doesnt_fail_dream() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(side_effect=RuntimeError("git push failed"))
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.status == "completed"
    assert dream.session_log is not None
    assert len(dream.session_log["memories"]) == 3
    assert dream.git_branch is None
    assert dream.git_pr_url is None
    mock_invalidate.assert_not_called()
    mock_cleanup.assert_called_once()


@pytest.mark.asyncio
async def test_no_files_modified_skips_git_ops() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_no_extract_mock()
    mock_merge = AsyncMock()
    mock_create_pr = AsyncMock()
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_create_pr.assert_not_called()
    mock_invalidate.assert_not_called()
    mock_cleanup.assert_not_called()
    assert dream.git_branch is None


@pytest.mark.asyncio
async def test_context_cache_invalidated_after_pr() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-100000",
            "git_pr_url": "https://github.com/owner/repo/pull/1",
            "git_pr_status": "created",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_invalidate.assert_called_once()


@pytest.mark.asyncio
async def test_last_processed_line_set_on_success() -> None:
    transcript = _make_transcript()
    transcript.segment_end_line = 900  # type: ignore[assignment]
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/42",
            "git_pr_status": "merged",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert transcript.status == "processed"
    assert transcript.last_processed_line == 900


@pytest.mark.asyncio
async def test_last_processed_line_not_set_on_failure() -> None:
    transcript = _make_transcript()
    transcript.segment_end_line = 900  # type: ignore[assignment]
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock(side_effect=DreamError("API timeout"))
    mock_merge = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert transcript.status == "failed"
    assert transcript.last_processed_line != 900


@pytest.mark.asyncio
async def test_segment_position_update_with_is_continuation() -> None:
    """Verify last_processed_line is updated even for continuation transcripts."""
    transcript = _make_transcript()
    transcript.segment_end_line = 1200  # type: ignore[assignment]
    transcript.is_continuation = True  # type: ignore[assignment]
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/42",
            "git_pr_status": "merged",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert transcript.status == "processed"
    assert transcript.last_processed_line == 1200
    assert transcript.is_continuation is True


@pytest.mark.asyncio
async def test_segment_position_preserved_across_chain() -> None:
    """First transcript sets position=450, second starts from 450 and goes to 900."""
    transcript1 = _make_transcript(transcript_id=1)
    transcript1.segment_start_line = 0  # type: ignore[assignment]
    transcript1.segment_end_line = 450  # type: ignore[assignment]
    dream1 = _make_dream(dream_id=1)
    factory1 = FakeSessionFactory(transcript1, dream1)
    mock_extract = _make_extraction_mock()
    mock_merge = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-143000",
            "git_pr_url": "https://github.com/owner/repo/pull/42",
            "git_pr_status": "merged",
        }
    )
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory1),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert transcript1.last_processed_line == 450

    transcript2 = _make_transcript(transcript_id=2)
    transcript2.segment_start_line = 430  # type: ignore[assignment]
    transcript2.segment_end_line = 900  # type: ignore[assignment]
    transcript2.is_continuation = True  # type: ignore[assignment]
    dream2 = _make_dream(dream_id=2)
    factory2 = FakeSessionFactory(transcript2, dream2)
    mock_extract2 = _make_extraction_mock()
    mock_merge2 = AsyncMock(return_value=(SAMPLE_RECORD_RESULT, SAMPLE_USAGE, 2, []))
    mock_create_pr2 = AsyncMock(
        return_value={
            "git_branch": "dream/light-2026-03-31-144000",
            "git_pr_url": "https://github.com/owner/repo/pull/43",
            "git_pr_status": "merged",
        }
    )

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory2),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract2),
        patch("app.tasks.light_dream_task.run_record", mock_merge2),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr2),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 2)

    assert transcript2.last_processed_line == 900
    assert transcript2.segment_start_line == 430


@pytest.mark.asyncio
async def test_last_processed_line_not_set_when_segment_end_line_zero() -> None:
    transcript = _make_transcript()
    transcript.segment_end_line = 0  # type: ignore[assignment]
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = _make_no_extract_mock()
    mock_merge = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.run_dream_extraction", mock_extract),
        patch("app.tasks.light_dream_task.run_record", mock_merge),
        patch("app.config.settings") as mock_settings,
    ):
        mock_settings.jarvis_memory_path = "/tmp/test-memory"
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert transcript.status == "processed"
    assert transcript.last_processed_line != 900
