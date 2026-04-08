import contextlib
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.usage import RunUsage

from app.core.exceptions import DreamError
from app.models.tables import Dream
from app.services.dream_models import (
    ConsolidationOutput,
    ConsolidationStats,
    LightSleepOutput,
    ScoredCandidate,
    VaultUpdates,
)

SAMPLE_INPUTS: dict[str, Any] = {
    "memu_memories": [
        {"content": "Use FastAPI", "type": "decision"},
        {"content": "Prefer httpx", "type": "preference"},
    ],
    "memory_md": "# Memory Index\n## Recent\n- entry",
    "daily_log": "## Session 1\nDid things.",
    "soul_md": "# Soul\nPrinciples.",
}

SAMPLE_CONSOLIDATION_OUTPUT = ConsolidationOutput(
    memory_md="# Memory Index\n## Strong Patterns\n- Always async (3x)\n## Recent\n- entry",
    daily_summary="Productive day.",
    stats=ConsolidationStats(
        total_memories_processed=10,
        duplicates_removed=2,
        contradictions_resolved=1,
        patterns_promoted=1,
        stale_pruned=0,
    ),
    vault_updates=VaultUpdates(),
)

SAMPLE_CONSOLIDATION_DICT: dict[str, Any] = {
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
        "concepts": [],
        "connections": [],
        "lessons": [],
    },
}

SAMPLE_CONSOLIDATION_WITH_VAULT_DICT: dict[str, Any] = {
    **SAMPLE_CONSOLIDATION_DICT,
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
        "concepts": [],
        "connections": [],
        "lessons": [],
    },
}

SAMPLE_VAULT_FILES: list[dict[str, str]] = [
    {"path": "decisions/arch.md", "action": "create"},
    {"path": "decisions/_index.md", "action": "rewrite"},
]

SAMPLE_VALIDATED: dict[str, Any] = {
    **SAMPLE_CONSOLIDATION_DICT,
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

SAMPLE_PHASE1_OUTPUT = LightSleepOutput(
    candidates=[
        ScoredCandidate(content="Use FastAPI", category="decisions"),
        ScoredCandidate(content="Prefer httpx", category="preferences"),
    ],
    duplicates_removed=1,
    contradictions_found=0,
)

SAMPLE_PHASE1_EMPTY = LightSleepOutput(
    candidates=[],
    duplicates_removed=0,
    contradictions_found=0,
)

SAMPLE_PHASE1_USAGE = RunUsage(input_tokens=50, output_tokens=30, requests=1)

SAMPLE_USAGE = RunUsage(input_tokens=200, output_tokens=100, requests=1)


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
    consolidation_dict: dict[str, Any] | None = None,
    validated: dict[str, Any] | None = None,
    git_result: dict[str, str] | None = None,
    memu_sync: dict[str, int] | None = None,
    vault_files: list[dict[str, str]] | None = None,
    git_error: Exception | None = None,
    memu_error: Exception | None = None,
    phase1_output: LightSleepOutput | None = None,
    phase1_error: Exception | None = None,
) -> dict[str, Any]:
    cons_dict = consolidation_dict or SAMPLE_CONSOLIDATION_DICT
    patches: dict[str, Any] = {
        "app.tasks.deep_dream_task.async_session_factory": FakeSessionFactory(dream),
        "app.tasks.deep_dream_task.gather_consolidation_inputs": AsyncMock(
            return_value=SAMPLE_INPUTS
        ),
        "app.tasks.deep_dream_task._backup_files": AsyncMock(),
        "app.tasks.deep_dream_task.run_phase1_light_sleep": AsyncMock(
            return_value=(
                phase1_output or SAMPLE_PHASE1_OUTPUT,
                SAMPLE_PHASE1_USAGE,
                3,
            ),
            side_effect=phase1_error,
        ),
        "app.tasks.deep_dream_task.run_deep_dream_consolidation": AsyncMock(
            return_value=(SAMPLE_CONSOLIDATION_OUTPUT, SAMPLE_USAGE, 5)
        ),
        "app.tasks.deep_dream_task.consolidation_to_dict": MagicMock(
            return_value=cons_dict
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
        "app.tasks.deep_dream_task.git_ops_service.create_deep_dream_pr": AsyncMock(
            return_value=git_result or SAMPLE_GIT_RESULT,
            side_effect=git_error,
        ),
        "app.tasks.deep_dream_task.align_memu_with_memory": AsyncMock(
            return_value=memu_sync or SAMPLE_MEMU_SYNC,
            side_effect=memu_error,
        ),
        "app.tasks.deep_dream_task.git_ops_service.cleanup_branch": AsyncMock(),
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
async def test_skip_when_no_inputs() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=None)
    mock_consolidation = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.run_deep_dream_consolidation", mock_consolidation),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "skipped"
    mock_consolidation.assert_not_called()


@pytest.mark.asyncio
async def test_consolidation_failure_marks_failed() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidation = AsyncMock(side_effect=DreamError("API timeout"))
    mock_write = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.run_deep_dream_consolidation", mock_consolidation),
        patch("app.tasks.deep_dream_task.write_consolidated_files", mock_write),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "API timeout" in dream.error_message
    mock_write.assert_not_called()


@pytest.mark.asyncio
async def test_validation_failure_marks_failed() -> None:
    dream = _make_dream()
    factory = FakeSessionFactory(dream)
    mock_gather = AsyncMock(return_value=SAMPLE_INPUTS)
    mock_consolidation = AsyncMock(
        return_value=(SAMPLE_CONSOLIDATION_OUTPUT, SAMPLE_USAGE, 5)
    )
    mock_to_dict = MagicMock(return_value={"memory_md": "", "daily_summary": ""})
    mock_validate = AsyncMock(side_effect=ValueError("memory_md is empty"))
    mock_write = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.run_deep_dream_consolidation", mock_consolidation),
        patch("app.tasks.deep_dream_task.consolidation_to_dict", mock_to_dict),
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
    mock_consolidation = AsyncMock(
        return_value=(SAMPLE_CONSOLIDATION_OUTPUT, SAMPLE_USAGE, 5)
    )
    mock_to_dict = MagicMock(return_value=SAMPLE_CONSOLIDATION_DICT)
    mock_validate = AsyncMock(return_value=SAMPLE_VALIDATED)
    mock_write = AsyncMock(side_effect=RuntimeError("disk full"))

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.run_deep_dream_consolidation", mock_consolidation),
        patch("app.tasks.deep_dream_task.consolidation_to_dict", mock_to_dict),
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
    mock_consolidation = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.async_session_factory", factory),
        patch("app.tasks.deep_dream_task.gather_consolidation_inputs", mock_gather),
        patch("app.tasks.deep_dream_task.run_deep_dream_consolidation", mock_consolidation),
    ):
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "MemU down" in dream.error_message
    mock_consolidation.assert_not_called()


@pytest.mark.asyncio
async def test_pipeline_includes_vault_updates_in_files_modified() -> None:
    dream = _make_dream()
    validated_with_vault = {**SAMPLE_CONSOLIDATION_WITH_VAULT_DICT, "line_count": 5, "warnings": []}
    patches = _pipeline_patches(
        dream,
        consolidation_dict=SAMPLE_CONSOLIDATION_WITH_VAULT_DICT,
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
    validated_with_vault = {**SAMPLE_CONSOLIDATION_WITH_VAULT_DICT, "line_count": 5, "warnings": []}
    patches = _pipeline_patches(
        dream,
        consolidation_dict=SAMPLE_CONSOLIDATION_WITH_VAULT_DICT,
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
    validated_with_vault = {**SAMPLE_CONSOLIDATION_WITH_VAULT_DICT, "line_count": 5, "warnings": []}
    patches = _pipeline_patches(
        dream,
        consolidation_dict=SAMPLE_CONSOLIDATION_WITH_VAULT_DICT,
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


# ── Git PR and MemU alignment tests ──


@pytest.mark.asyncio
async def test_pipeline_includes_git_pr_step() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    git_mock = patches["app.tasks.deep_dream_task.git_ops_service.create_deep_dream_pr"]
    git_mock.assert_called_once()
    call_args = git_mock.call_args
    assert len(call_args[0][0]) > 0


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

    cleanup_mock = patches["app.tasks.deep_dream_task.git_ops_service.cleanup_branch"]
    cleanup_mock.assert_called_once_with("dream/deep-2026-03-31")


@pytest.mark.asyncio
async def test_cleanup_branch_called_after_git_failure() -> None:
    """cleanup_branch runs in finally block even when git fails."""
    dream = _make_dream()
    patches = _pipeline_patches(dream, git_error=RuntimeError("git failed"))

    await _run_with_patches(patches, trigger="auto")

    # branch_name is "" because create_deep_dream_pr raised before returning
    # so cleanup_branch is NOT called (no branch to clean up)
    cleanup_mock = patches["app.tasks.deep_dream_task.git_ops_service.cleanup_branch"]
    cleanup_mock.assert_not_called()


# ── Phase 1: Light Sleep tests ──


@pytest.mark.asyncio
async def test_phase1_runs_before_consolidation() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    phase1_mock = patches["app.tasks.deep_dream_task.run_phase1_light_sleep"]
    phase1_mock.assert_called_once()
    consolidation_mock = patches["app.tasks.deep_dream_task.run_deep_dream_consolidation"]
    consolidation_mock.assert_called_once()


@pytest.mark.asyncio
async def test_phase1_empty_candidates_skips_dream() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, phase1_output=SAMPLE_PHASE1_EMPTY)

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "skipped"
    consolidation_mock = patches["app.tasks.deep_dream_task.run_deep_dream_consolidation"]
    consolidation_mock.assert_not_called()


@pytest.mark.asyncio
async def test_phase1_failure_marks_failed() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream, phase1_error=RuntimeError("LLM timeout"))

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "failed"
    assert dream.error_message is not None
    assert "Phase 1 failed" in dream.error_message
    consolidation_mock = patches["app.tasks.deep_dream_task.run_deep_dream_consolidation"]
    consolidation_mock.assert_not_called()


@pytest.mark.asyncio
async def test_backup_called_before_phase1() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)

    await _run_with_patches(patches, trigger="auto")

    backup_mock = patches["app.tasks.deep_dream_task._backup_files"]
    backup_mock.assert_called_once()


@pytest.mark.asyncio
async def test_backup_failure_does_not_block_pipeline() -> None:
    dream = _make_dream()
    patches = _pipeline_patches(dream)
    patches["app.tasks.deep_dream_task._backup_files"] = AsyncMock(
        side_effect=RuntimeError("disk full")
    )

    await _run_with_patches(patches, trigger="auto")

    assert dream.status == "completed"


# ── Backup function unit tests ──


@pytest.mark.asyncio
async def test_backup_files_writes_both_files() -> None:
    from datetime import date

    mock_read = AsyncMock(side_effect=lambda p: f"content-of-{p}")
    mock_write = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.read_vault_file", mock_read),
        patch("app.tasks.deep_dream_task.write_vault_file", mock_write),
    ):
        from app.tasks.deep_dream_task import _backup_files

        await _backup_files(date(2026, 4, 5))

    assert mock_write.call_count == 2
    write_calls = {call.args[0]: call.args[1] for call in mock_write.call_args_list}
    assert ".backups/MEMORY.md.2026-04-05.bak" in write_calls
    assert ".backups/dailys-2026-04-05.bak" in write_calls


@pytest.mark.asyncio
async def test_backup_files_skips_missing_files() -> None:
    from datetime import date

    mock_read = AsyncMock(return_value=None)
    mock_write = AsyncMock()

    with (
        patch("app.tasks.deep_dream_task.read_vault_file", mock_read),
        patch("app.tasks.deep_dream_task.write_vault_file", mock_write),
    ):
        from app.tasks.deep_dream_task import _backup_files

        await _backup_files(date(2026, 4, 5))

    mock_write.assert_not_called()
