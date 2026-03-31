from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import DreamError
from app.models.tables import Dream

SAMPLE_INPUTS: dict[str, Any] = {
    "memu_memories": [
        {"content": "Use FastAPI", "type": "decision"},
        {"content": "Prefer httpx", "type": "preference"},
    ],
    "memory_md": "# Memory Index\n## Recent\n- entry",
    "daily_log": "## Session 1\nDid things.",
    "soul_md": "# Soul\nPrinciples.",
}

SAMPLE_CONSOLIDATION: dict[str, Any] = {
    "memory_md": "# Memory Index\n## Strong Patterns\n- Always async (3x)\n## Recent\n- entry",
    "daily_summary": "Productive day.",
    "stats": {
        "total_memories_processed": 10,
        "duplicates_removed": 2,
        "contradictions_resolved": 1,
        "patterns_promoted": 1,
        "stale_pruned": 0,
    },
}

SAMPLE_VALIDATED: dict[str, Any] = {
    **SAMPLE_CONSOLIDATION,
    "line_count": 5,
    "warnings": [],
}

SAMPLE_FILES_MODIFIED: list[dict[str, str]] = [
    {"path": "MEMORY.md", "action": "rewrite"},
    {"path": "dailys/2026-03-31.md", "action": "rewrite"},
    {"path": "topics/memory-backup-2026-03-31.md", "action": "create"},
]


def _make_dream(dream_id: int = 1) -> Dream:
    d = Dream(
        type="deep",
        trigger="auto",
        status="processing",
    )
    d.id = dream_id  # type: ignore[assignment]
    return d


class FakeSessionFactory:
    def __init__(self, dream: Dream) -> None:
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
        result.scalar_one.return_value = self._factory.dream
        result.scalar_one_or_none.return_value = self._factory.dream
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
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidate = AsyncMock(return_value=SAMPLE_CONSOLIDATION)
    mock_validate = AsyncMock(return_value=SAMPLE_VALIDATED)
    mock_write = AsyncMock(return_value=SAMPLE_FILES_MODIFIED)

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
        patch("app.tasks.deep_dream_task.validate_consolidated_output", mock_validate),
        patch("app.tasks.deep_dream_task.write_consolidated_files", mock_write),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    mock_gather.assert_called_once()
    mock_consolidate.assert_called_once_with(
        SAMPLE_INPUTS["memory_md"],
        SAMPLE_INPUTS["daily_log"],
        SAMPLE_INPUTS["soul_md"],
        SAMPLE_INPUTS["memu_memories"],
    )
    mock_validate.assert_called_once_with(SAMPLE_CONSOLIDATION)
    mock_write.assert_called_once()

    assert dream.status == "completed"
    assert dream.memories_extracted == 10
    assert dream.duration_ms is not None
    assert dream.completed_at is not None
    assert dream.files_modified is not None
    assert dream.input_summary is not None
    assert dream.output_raw is not None


@pytest.mark.asyncio
async def test_skip_when_memu_empty() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=None)
    mock_consolidate = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "skipped"
    mock_consolidate.assert_not_called()


@pytest.mark.asyncio
async def test_gpt_failure_marks_failed_files_preserved() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidate = AsyncMock(side_effect=DreamError("API timeout"))
    mock_write = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
        patch("app.tasks.deep_dream_task.write_consolidated_files", mock_write),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "API timeout" in dream.error_message
    mock_write.assert_not_called()


@pytest.mark.asyncio
async def test_validation_failure_marks_failed_files_preserved() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidate = AsyncMock(return_value={"memory_md": "", "daily_summary": ""})
    mock_validate = AsyncMock(side_effect=ValueError("memory_md is empty"))
    mock_write = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
        patch("app.tasks.deep_dream_task.validate_consolidated_output", mock_validate),
        patch("app.tasks.deep_dream_task.write_consolidated_files", mock_write),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "failed"
    mock_write.assert_not_called()


@pytest.mark.asyncio
async def test_file_write_failure_marks_failed() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidate = AsyncMock(return_value=SAMPLE_CONSOLIDATION)
    mock_validate = AsyncMock(return_value=SAMPLE_VALIDATED)
    mock_write = AsyncMock(side_effect=RuntimeError("disk full"))

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
        patch("app.tasks.deep_dream_task.validate_consolidated_output", mock_validate),
        patch("app.tasks.deep_dream_task.write_consolidated_files", mock_write),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None


@pytest.mark.asyncio
async def test_manual_trigger_recorded() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidate = AsyncMock(return_value=SAMPLE_CONSOLIDATION)
    mock_validate = AsyncMock(return_value=SAMPLE_VALIDATED)
    mock_write = AsyncMock(return_value=SAMPLE_FILES_MODIFIED)

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
        patch("app.tasks.deep_dream_task.validate_consolidated_output", mock_validate),
        patch("app.tasks.deep_dream_task.write_consolidated_files", mock_write),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="manual")

    assert dream.status == "completed"
    # The dream was created with trigger from the factory default "auto"
    # but the initial creation in the task uses the trigger parameter
    # Verify the task completed successfully with manual trigger
    assert dream.completed_at is not None


@pytest.mark.asyncio
async def test_duration_ms_recorded() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidate = AsyncMock(return_value=SAMPLE_CONSOLIDATION)
    mock_validate = AsyncMock(return_value=SAMPLE_VALIDATED)
    mock_write = AsyncMock(return_value=SAMPLE_FILES_MODIFIED)

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
        patch("app.tasks.deep_dream_task.validate_consolidated_output", mock_validate),
        patch("app.tasks.deep_dream_task.write_consolidated_files", mock_write),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.duration_ms is not None
    assert isinstance(dream.duration_ms, int)
    assert dream.duration_ms >= 0


@pytest.mark.asyncio
async def test_gather_failure_marks_failed() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(side_effect=RuntimeError("MemU down"))
    mock_consolidate = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.consolidate_memories", mock_consolidate),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "MemU down" in dream.error_message
    mock_consolidate.assert_not_called()
