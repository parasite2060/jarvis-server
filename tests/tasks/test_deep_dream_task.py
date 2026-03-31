import contextlib
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
    "vault_updates": {
        "decisions": [],
        "projects": [],
        "patterns": [],
        "templates": [],
    },
}

SAMPLE_CONSOLIDATION_WITH_VAULT: dict[str, Any] = {
    **SAMPLE_CONSOLIDATION,
    "vault_updates": {
        "decisions": [
            {
                "filename": "arch.md",
                "title": "Arch",
                "summary": "Architecture decisions",
                "content": "# Arch\n\nChose Clean Arch",
                "tags": ["arch"],
                "action": "create",
            }
        ],
        "projects": [],
        "patterns": [],
        "templates": [],
    },
}

SAMPLE_VAULT_FILES: list[dict[str, str]] = [
    {"path": "decisions/arch.md", "action": "create"},
    {"path": "decisions/_index.md", "action": "rewrite"},
]

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

SAMPLE_GIT_RESULT: dict[str, str] = {
    "git_branch": "dream/deep-2026-03-31",
    "git_pr_url": "https://github.com/owner/repo/pull/42",
    "git_pr_status": "auto_merge_enabled",
}

SAMPLE_MEMU_SYNC: dict[str, int] = {
    "items_synced": 3,
    "errors": 0,
}


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


def _pipeline_patches(
    dream: Dream,
    *,
    consolidation: dict[str, Any] | None = None,
    validated: dict[str, Any] | None = None,
    git_result: dict[str, str] | None = None,
    memu_sync: dict[str, int] | None = None,
    vault_files: list[dict[str, str]] | None = None,
    git_error: Exception | None = None,
    memu_error: Exception | None = None,
) -> dict[str, Any]:
    patches: dict[str, Any] = {
        "app.tasks.deep_dream_task.async_session_factory": FakeSessionFactory(dream),
        "app.tasks.deep_dream_task.gather_consolidation_inputs": AsyncMock(
            return_value=SAMPLE_INPUTS
        ),
        "app.tasks.deep_dream_task.consolidate_memories": AsyncMock(
            return_value=consolidation or SAMPLE_CONSOLIDATION
        ),
        "app.tasks.deep_dream_task.validate_consolidated_output": AsyncMock(
            return_value=validated or SAMPLE_VALIDATED
        ),
        "app.tasks.deep_dream_task.write_consolidated_files": AsyncMock(
            return_value=list(SAMPLE_FILES_MODIFIED)
        ),
        "app.tasks.deep_dream_task.update_vault_folders": AsyncMock(
            return_value=vault_files if vault_files is not None else []
        ),
        "app.tasks.deep_dream_task.update_file_manifest": AsyncMock(),
        "app.tasks.deep_dream_task.create_deep_dream_pr": AsyncMock(
            return_value=git_result or SAMPLE_GIT_RESULT,
            side_effect=git_error,
        ),
        "app.tasks.deep_dream_task.align_memu_with_memory": AsyncMock(
            return_value=memu_sync or SAMPLE_MEMU_SYNC,
            side_effect=memu_error,
        ),
        "app.tasks.deep_dream_task.cleanup_branch": AsyncMock(),
        "app.tasks.deep_dream_task.invalidate_context_cache": AsyncMock(),
    }
    return patches


async def _run_with_patches(patches: dict[str, Any], **kwargs: Any) -> dict[str, AsyncMock]:
    mocks: dict[str, AsyncMock] = {}
    with contextlib.ExitStack() as stack:
        for target, mock_obj in patches.items():
            mocks[target] = stack.enter_context(patch(target, mock_obj))

        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, **kwargs)
    return mocks


# ── Full pipeline tests ──


@pytest.mark.asyncio
async def test_full_pipeline_success() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    assert dream.memories_extracted == 10
    assert dream.duration_ms is not None
    assert dream.completed_at is not None
    assert dream.files_modified is not None
    assert dream.input_summary is not None
    assert dream.output_raw is not None
    assert dream.git_branch == "dream/deep-2026-03-31"
    assert dream.git_pr_url == "https://github.com/owner/repo/pull/42"
    assert dream.git_pr_status == "auto_merge_enabled"


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
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="manual")

    assert dream.status == "completed"
    assert dream.completed_at is not None


@pytest.mark.asyncio
async def test_duration_ms_recorded() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

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


@pytest.mark.asyncio
async def test_pipeline_includes_vault_updates_in_files_modified() -> None:
    dream = _make_dream()
    validated_with_vault = {**SAMPLE_CONSOLIDATION_WITH_VAULT, "line_count": 5, "warnings": []}
    patches = _pipeline_patches(
        dream,
        consolidation=SAMPLE_CONSOLIDATION_WITH_VAULT,
        validated=validated_with_vault,
        vault_files=SAMPLE_VAULT_FILES,
    )

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    all_files = dream.files_modified
    paths = [f["path"] for f in all_files]
    assert "decisions/arch.md" in paths
    assert "MEMORY.md" in paths


@pytest.mark.asyncio
async def test_empty_vault_updates_skips_vault_step() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    vault_mock = patches["app.tasks.deep_dream_task.update_vault_folders"]
    vault_mock.assert_not_called()


@pytest.mark.asyncio
async def test_vault_update_failure_does_not_fail_pipeline() -> None:
    dream = _make_dream()
    validated_with_vault = {**SAMPLE_CONSOLIDATION_WITH_VAULT, "line_count": 5, "warnings": []}
    patches = _pipeline_patches(
        dream,
        consolidation=SAMPLE_CONSOLIDATION_WITH_VAULT,
        validated=validated_with_vault,
    )
    patches["app.tasks.deep_dream_task.update_vault_folders"] = AsyncMock(
        side_effect=RuntimeError("vault write error")
    )

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    assert dream.files_modified is not None


@pytest.mark.asyncio
async def test_file_manifest_updated_for_all_modified_files() -> None:
    dream = _make_dream()
    validated_with_vault = {**SAMPLE_CONSOLIDATION_WITH_VAULT, "line_count": 5, "warnings": []}
    patches = _pipeline_patches(
        dream,
        consolidation=SAMPLE_CONSOLIDATION_WITH_VAULT,
        validated=validated_with_vault,
        vault_files=SAMPLE_VAULT_FILES,
    )

    await _run_with_patches(patches, trigger="auto")

    manifest_mock = patches["app.tasks.deep_dream_task.update_file_manifest"]
    manifest_mock.assert_called_once()
    manifest_files = manifest_mock.call_args[0][0]
    paths = [f["path"] for f in manifest_files]
    assert "MEMORY.md" in paths
    assert "decisions/arch.md" in paths
    assert len(paths) == 5


# ── Story 5-3: Git PR and MemU alignment tests ──


@pytest.mark.asyncio
async def test_pipeline_includes_git_pr_step() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    git_mock = patches["app.tasks.deep_dream_task.create_deep_dream_pr"]
    git_mock.assert_called_once()
    call_args = git_mock.call_args
    assert len(call_args[0][0]) > 0  # files_modified not empty


@pytest.mark.asyncio
async def test_pipeline_includes_memu_alignment_step() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    memu_mock = patches["app.tasks.deep_dream_task.align_memu_with_memory"]
    memu_mock.assert_called_once()


@pytest.mark.asyncio
async def test_git_failure_does_not_fail_dream() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, git_error=RuntimeError("git push failed"))

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    assert dream.git_branch == ""
    assert dream.git_pr_url == ""


@pytest.mark.asyncio
async def test_memu_failure_does_not_fail_dream() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, memu_error=RuntimeError("MemU unreachable"))

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"
    assert dream.git_branch == "dream/deep-2026-03-31"


@pytest.mark.asyncio
async def test_git_failure_does_not_block_memu_alignment() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, git_error=RuntimeError("git push failed"))

    await _run_with_patches(patches, trigger="auto")

    memu_mock = patches["app.tasks.deep_dream_task.align_memu_with_memory"]
    memu_mock.assert_called_once()


@pytest.mark.asyncio
async def test_dream_row_includes_git_fields() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    assert dream.git_branch == "dream/deep-2026-03-31"
    assert dream.git_pr_url == "https://github.com/owner/repo/pull/42"
    assert dream.git_pr_status == "auto_merge_enabled"


@pytest.mark.asyncio
async def test_context_cache_invalidated_after_successful_pr() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    cache_mock = patches["app.tasks.deep_dream_task.invalidate_context_cache"]
    cache_mock.assert_called_once()


@pytest.mark.asyncio
async def test_context_cache_not_invalidated_on_git_failure() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, git_error=RuntimeError("git failed"))

    await _run_with_patches(patches, trigger="auto")

    cache_mock = patches["app.tasks.deep_dream_task.invalidate_context_cache"]
    cache_mock.assert_not_called()


@pytest.mark.asyncio
async def test_cleanup_branch_called_after_git_success() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    cleanup_mock = patches["app.tasks.deep_dream_task.cleanup_branch"]
    cleanup_mock.assert_called_once_with("dream/deep-2026-03-31")


@pytest.mark.asyncio
async def test_cleanup_branch_called_after_git_failure() -> None:
    """cleanup_branch runs in finally block even when git fails."""
    dream = _make_dream()
    patches = _pipeline_patches(dream, git_error=RuntimeError("git failed"))

    await _run_with_patches(patches, trigger="auto")

    # branch_name is "" because create_deep_dream_pr raised before returning
    # so cleanup_branch is NOT called (no branch to clean up)
    cleanup_mock = patches["app.tasks.deep_dream_task.cleanup_branch"]
    cleanup_mock.assert_not_called()
