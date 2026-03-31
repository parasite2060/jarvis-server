from datetime import date
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import DreamError
from app.models.tables import Dream, ExtractedMemory, Transcript
from app.services.memory_updater import MemoryItem

SAMPLE_EXTRACTION: dict[str, Any] = {
    "no_extract": False,
    "summary": "Discussed architecture decisions",
    "decisions": [
        {
            "content": "Use FastAPI because async-first",
            "reasoning": "async-first and Pydantic integration",
            "vault_target": "decisions",
            "source_date": "2026-03-31",
        }
    ],
    "preferences": [
        {
            "content": "Prefer httpx over requests",
            "vault_target": "memory",
            "source_date": "2026-03-31",
        }
    ],
    "patterns": [],
    "corrections": [],
    "facts": [
        {
            "content": "Project uses PostgreSQL",
            "vault_target": "memory",
            "source_date": "2026-03-31",
        }
    ],
}

NO_EXTRACT_RESULT: dict[str, Any] = {
    "no_extract": True,
    "summary": "Quick fix, nothing notable",
    "decisions": [],
    "preferences": [],
    "patterns": [],
    "corrections": [],
    "facts": [],
}


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
        # Inspect the statement to figure out what entity is being queried
        # SQLAlchemy select() stores columns_clause_froms
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


@pytest.mark.asyncio
async def test_full_pipeline_success() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_extract.assert_called_once_with("User: hello\n\nAssistant: hi there")
    mock_memu.assert_called_once()

    memories = [i for i in factory.added_items if isinstance(i, ExtractedMemory)]
    assert len(memories) == 3
    types = {m.type for m in memories}
    assert types == {"decisions", "preferences", "facts"}

    decision_mem = next(m for m in memories if m.type == "decisions")
    assert decision_mem.reasoning == "async-first and Pydantic integration"
    assert decision_mem.vault_target == "decisions"
    assert decision_mem.source_date == date(2026, 3, 31)

    assert dream.status == "completed"
    assert dream.memories_extracted == 3
    assert dream.duration_ms is not None
    assert dream.completed_at is not None
    assert transcript.status == "processed"
    assert transcript.light_dream_id == dream.id


@pytest.mark.asyncio
async def test_no_extract_pipeline() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=NO_EXTRACT_RESULT)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    memories = [i for i in factory.added_items if isinstance(i, ExtractedMemory)]
    assert len(memories) == 0
    assert dream.status == "completed"
    assert dream.memories_extracted == 0
    mock_memu.assert_called_once()
    assert transcript.status == "processed"


@pytest.mark.asyncio
async def test_gpt_failure_marks_dream_failed() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(side_effect=DreamError("API timeout"))
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "API timeout" in dream.error_message
    assert dream.memories_extracted == 0
    assert transcript.status == "failed"
    mock_memu.assert_called_once()


@pytest.mark.asyncio
async def test_memu_failure_doesnt_fail_dream() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(side_effect=Exception("MemU unreachable"))

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.status == "completed"
    assert dream.memories_extracted == 3
    memories = [i for i in factory.added_items if isinstance(i, ExtractedMemory)]
    assert len(memories) == 3


@pytest.mark.asyncio
async def test_transcript_not_found_returns_early() -> None:
    factory = FakeSessionFactory(None, _make_dream())
    mock_extract = AsyncMock()
    mock_memu = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 99999)

    mock_extract.assert_not_called()
    mock_memu.assert_not_called()


@pytest.mark.asyncio
async def test_duration_ms_is_recorded() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(return_value={"task_id": "abc"})

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.duration_ms is not None
    assert isinstance(dream.duration_ms, int)
    assert dream.duration_ms >= 0


@pytest.mark.asyncio
async def test_all_memory_types_stored_with_correct_fields() -> None:
    full_extraction: dict[str, Any] = {
        "no_extract": False,
        "summary": "Full extraction",
        "decisions": [
            {
                "content": "Use FastAPI",
                "reasoning": "async-first",
                "vault_target": "decisions",
                "source_date": "2026-03-31",
            }
        ],
        "preferences": [
            {
                "content": "Prefer httpx",
                "vault_target": "memory",
                "source_date": "2026-03-31",
            }
        ],
        "patterns": [
            {
                "content": "Always READ before WRITE",
                "vault_target": "patterns",
                "source_date": "2026-03-31",
            }
        ],
        "corrections": [
            {
                "content": "CORRECTION: Was JWT -> Now session auth",
                "vault_target": "memory",
                "source_date": "2026-03-31",
            }
        ],
        "facts": [
            {
                "content": "Project uses PostgreSQL",
                "vault_target": "projects",
                "source_date": "2026-03-31",
            }
        ],
    }
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=full_extraction)
    mock_memu = AsyncMock(return_value={"task_id": "abc"})

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    memories = [i for i in factory.added_items if isinstance(i, ExtractedMemory)]
    assert len(memories) == 5

    types = sorted(m.type for m in memories)
    assert types == ["corrections", "decisions", "facts", "patterns", "preferences"]

    decision_mem = next(m for m in memories if m.type == "decisions")
    assert decision_mem.content == "Use FastAPI"
    assert decision_mem.reasoning == "async-first"
    assert decision_mem.vault_target == "decisions"
    assert decision_mem.source_date == date(2026, 3, 31)

    correction = next(m for m in memories if m.type == "corrections")
    assert correction.reasoning is None
    assert correction.vault_target == "memory"

    pattern = next(m for m in memories if m.type == "patterns")
    assert pattern.vault_target == "patterns"
    assert pattern.content == "Always READ before WRITE"


@pytest.mark.asyncio
async def test_full_pipeline_with_file_updates() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})
    mock_update_files = AsyncMock(
        return_value=[
            {"path": "MEMORY.md", "action": "append", "line_count": 30, "memory_overflow": False},
            {"path": "dailys/2026-03-31.md", "action": "create"},
        ]
    )

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
        patch("app.tasks.light_dream_task.update_memory_files", mock_update_files),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_update_files.assert_called_once()
    call_args = mock_update_files.call_args
    assert call_args[0][0] == dream.id  # dream_id
    assert isinstance(call_args[0][1], list)  # memories list
    assert all(isinstance(m, MemoryItem) for m in call_args[0][1])
    assert len(call_args[0][1]) == 3  # 1 decision + 1 preference + 1 fact

    assert dream.status == "completed"
    assert dream.files_modified is not None
    assert len(dream.files_modified) == 2


@pytest.mark.asyncio
async def test_no_extract_skips_file_updates() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=NO_EXTRACT_RESULT)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})
    mock_update_files = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
        patch("app.tasks.light_dream_task.update_memory_files", mock_update_files),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_update_files.assert_not_called()
    assert dream.files_modified is None


@pytest.mark.asyncio
async def test_file_update_failure_doesnt_fail_dream() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})
    mock_update_files = AsyncMock(side_effect=RuntimeError("disk full"))

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
        patch("app.tasks.light_dream_task.update_memory_files", mock_update_files),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.status == "completed"
    assert dream.memories_extracted == 3
    assert dream.files_modified is None


@pytest.mark.asyncio
async def test_full_pipeline_with_git_pr() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})
    mock_update_files = AsyncMock(
        return_value=[
            {"path": "MEMORY.md", "action": "append", "line_count": 30, "memory_overflow": False},
            {"path": "dailys/2026-03-31.md", "action": "create"},
        ]
    )
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
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
        patch("app.tasks.light_dream_task.update_memory_files", mock_update_files),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
    ):
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
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})
    mock_update_files = AsyncMock(
        return_value=[
            {"path": "MEMORY.md", "action": "append"},
            {"path": "dailys/2026-03-31.md", "action": "create"},
        ]
    )
    mock_create_pr = AsyncMock(side_effect=RuntimeError("git push failed"))
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
        patch("app.tasks.light_dream_task.update_memory_files", mock_update_files),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    assert dream.status == "completed"
    assert dream.memories_extracted == 3
    assert dream.git_branch is None
    assert dream.git_pr_url is None
    # Cache NOT invalidated on git failure
    mock_invalidate.assert_not_called()
    # Cleanup still called
    mock_cleanup.assert_called_once()


@pytest.mark.asyncio
async def test_no_files_modified_skips_git_ops() -> None:
    transcript = _make_transcript()
    dream = _make_dream()
    factory = FakeSessionFactory(transcript, dream)
    mock_extract = AsyncMock(return_value=NO_EXTRACT_RESULT)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})
    mock_create_pr = AsyncMock()
    mock_cleanup = AsyncMock()
    mock_invalidate = AsyncMock()

    with (
        patch("app.tasks.light_dream_task.async_session_factory", factory),
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
    ):
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
    mock_extract = AsyncMock(return_value=SAMPLE_EXTRACTION)
    mock_memu = AsyncMock(return_value={"task_id": "abc", "status": "accepted"})
    mock_update_files = AsyncMock(
        return_value=[
            {"path": "MEMORY.md", "action": "append"},
        ]
    )
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
        patch("app.tasks.light_dream_task.extract_memories", mock_extract),
        patch("app.tasks.light_dream_task.memu_memorize", mock_memu),
        patch("app.tasks.light_dream_task.update_memory_files", mock_update_files),
        patch("app.tasks.light_dream_task.git_ops_service.create_light_dream_pr", mock_create_pr),
        patch("app.tasks.light_dream_task.git_ops_service.cleanup_branch", mock_cleanup),
        patch("app.tasks.light_dream_task.invalidate_context_cache", mock_invalidate),
    ):
        from app.tasks.light_dream_task import light_dream_task

        await light_dream_task({}, 1)

    mock_invalidate.assert_called_once()
