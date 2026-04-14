from datetime import date
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

SAMPLE_MEMU_MEMORIES: list[dict[str, Any]] = [
    {"content": "Use FastAPI because async-first", "type": "decision"},
    {"content": "Prefer httpx over requests", "type": "preference"},
]

SAMPLE_MEMORY_MD = """---
type: memory
tags: [memory, index]
created: 2026-03-01
updated: 2026-03-30
last_reviewed: 2026-03-30
---

# Memory Index

## Strong Patterns
- Always READ before WRITE for memory files (5x)

## Decisions
- Use FastAPI because async-first (2026-03-01)

## Facts
- Project uses PostgreSQL with pgvector

## Recent
- Added structured logging with structlog (2026-03-29)
"""

SAMPLE_DAILY_LOG = """---
type: daily
date: 2026-03-31
---

## Session 1
Discussed architecture decisions for dream pipeline.
"""

SAMPLE_SOUL_MD = "# Soul\nPrinciples and philosophy."


@pytest.mark.asyncio
async def test_gather_returns_all_vault_files_and_memu() -> None:
    mock_memu = AsyncMock(return_value={"memories": SAMPLE_MEMU_MEMORIES})
    mock_read = AsyncMock(side_effect=[SAMPLE_MEMORY_MD, SAMPLE_DAILY_LOG, SAMPLE_SOUL_MD])

    with (
        patch("app.services.deep_dream.memu_retrieve", mock_memu),
        patch("app.services.deep_dream.read_vault_file", mock_read),
    ):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is not None
    assert result["memu_memories"] == SAMPLE_MEMU_MEMORIES
    assert result["memory_md"] == SAMPLE_MEMORY_MD
    assert result["daily_log"] == SAMPLE_DAILY_LOG
    assert result["soul_md"] == SAMPLE_SOUL_MD
    mock_memu.assert_called_once_with(query="memories from 2026-03-31", method="rag")


@pytest.mark.asyncio
async def test_gather_returns_none_when_memu_empty() -> None:
    mock_memu = AsyncMock(return_value={"memories": []})

    with patch("app.services.deep_dream.memu_retrieve", mock_memu):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is None


@pytest.mark.asyncio
async def test_gather_returns_none_when_memu_no_memories_key() -> None:
    mock_memu = AsyncMock(return_value={})

    with patch("app.services.deep_dream.memu_retrieve", mock_memu):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is None


@pytest.mark.asyncio
async def test_gather_handles_missing_memory_md() -> None:
    mock_memu = AsyncMock(return_value={"memories": SAMPLE_MEMU_MEMORIES})
    mock_read = AsyncMock(side_effect=[None, SAMPLE_DAILY_LOG, SAMPLE_SOUL_MD])

    with (
        patch("app.services.deep_dream.memu_retrieve", mock_memu),
        patch("app.services.deep_dream.read_vault_file", mock_read),
    ):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is not None
    assert result["memory_md"] == ""


@pytest.mark.asyncio
async def test_gather_handles_missing_daily_log() -> None:
    mock_memu = AsyncMock(return_value={"memories": SAMPLE_MEMU_MEMORIES})
    mock_read = AsyncMock(side_effect=[SAMPLE_MEMORY_MD, None, SAMPLE_SOUL_MD])

    with (
        patch("app.services.deep_dream.memu_retrieve", mock_memu),
        patch("app.services.deep_dream.read_vault_file", mock_read),
    ):
        from app.services.deep_dream import gather_consolidation_inputs

        result = await gather_consolidation_inputs(date(2026, 3, 31))

    assert result is not None
    assert result["daily_log"] == ""


@pytest.mark.asyncio
async def test_validate_passes_valid_output() -> None:
    from app.services.deep_dream import validate_consolidated_output

    consolidation = {
        "memory_md": "# Memory Index\n## Strong Patterns\n- Entry (3x)\n",
        "daily_summary": "Productive day of coding.",
        "stats": {"total_memories_processed": 5},
    }

    result = await validate_consolidated_output(consolidation)

    assert result["line_count"] == 3
    assert result["warnings"] == []
    assert result["memory_md"] == consolidation["memory_md"]


@pytest.mark.asyncio
async def test_validate_truncates_over_200_lines() -> None:
    from app.services.deep_dream import validate_consolidated_output

    long_md = "\n".join(f"- Line {i}" for i in range(250))
    consolidation = {
        "memory_md": long_md,
        "daily_summary": "Summary here.",
        "stats": {},
    }

    result = await validate_consolidated_output(consolidation)

    assert result["line_count"] == 200
    assert len(result["memory_md"].splitlines()) == 200
    assert any("truncat" in w.lower() for w in result["warnings"])


@pytest.mark.asyncio
async def test_validate_rejects_empty_memory_md() -> None:
    from app.services.deep_dream import validate_consolidated_output

    with pytest.raises(ValueError, match="memory_md is empty"):
        await validate_consolidated_output(
            {"memory_md": "", "daily_summary": "Summary.", "stats": {}}
        )


@pytest.mark.asyncio
async def test_validate_rejects_empty_daily_summary() -> None:
    from app.services.deep_dream import validate_consolidated_output

    with pytest.raises(ValueError, match="daily_summary is empty"):
        await validate_consolidated_output(
            {"memory_md": "# Memory\n- entry", "daily_summary": "", "stats": {}}
        )


@pytest.mark.asyncio
async def test_validate_warns_on_relative_dates() -> None:
    from app.services.deep_dream import validate_consolidated_output

    consolidation = {
        "memory_md": "# Memory Index\n- Did something yesterday\n",
        "daily_summary": "Summary.",
        "stats": {},
    }

    result = await validate_consolidated_output(consolidation)

    assert any("relative date" in w.lower() for w in result["warnings"])


@pytest.mark.asyncio
async def test_write_creates_backup() -> None:
    mock_read = AsyncMock(side_effect=["existing MEMORY.md content", ""])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        await write_consolidated_files(
            {"memory_md": "new content", "daily_summary": "day summary"},
            date(2026, 3, 31),
        )

    backup_call = mock_write.call_args_list[0]
    assert backup_call[0][0] == "topics/memory-backup-2026-03-31.md"
    assert backup_call[0][1] == "existing MEMORY.md content"


@pytest.mark.asyncio
async def test_write_rewrites_memory_md() -> None:
    mock_read = AsyncMock(side_effect=["old content", ""])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        await write_consolidated_files(
            {"memory_md": "new MEMORY.md", "daily_summary": "day summary"},
            date(2026, 3, 31),
        )

    memory_write = mock_write.call_args_list[1]
    assert memory_write[0][0] == "MEMORY.md"
    assert memory_write[0][1] == "new MEMORY.md"


@pytest.mark.asyncio
async def test_write_rewrites_daily_log() -> None:
    existing_daily = "---\ntype: daily\ndate: 2026-03-31\n---\n\n## Session 1\nOld content."
    mock_read = AsyncMock(side_effect=["old memory", existing_daily])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        await write_consolidated_files(
            {"memory_md": "new memory", "daily_summary": "Consolidated summary."},
            date(2026, 3, 31),
        )

    daily_write = mock_write.call_args_list[2]
    assert daily_write[0][0] == "dailys/2026-03-31.md"
    written_content: str = daily_write[0][1]
    assert written_content.startswith("---\ntype: daily\ndate: 2026-03-31\n---")
    assert "Consolidated summary." in written_content


@pytest.mark.asyncio
async def test_write_returns_correct_files_modified() -> None:
    mock_read = AsyncMock(side_effect=["old", ""])
    mock_write = AsyncMock()

    with (
        patch("app.services.deep_dream.read_vault_file", mock_read),
        patch("app.services.deep_dream.write_vault_file", mock_write),
    ):
        from app.services.deep_dream import write_consolidated_files

        result = await write_consolidated_files(
            {"memory_md": "new", "daily_summary": "sum"},
            date(2026, 3, 31),
        )

    assert len(result) == 3
    assert result[0] == {"path": "MEMORY.md", "action": "rewrite"}
    assert result[1] == {"path": "dailys/2026-03-31.md", "action": "rewrite"}
    assert result[2] == {"path": "topics/memory-backup-2026-03-31.md", "action": "create"}


# ── align_memu_with_memory tests ──


CONSOLIDATION_MEMORY_MD = """---
type: memory
tags: [memory, index]
created: 2026-03-01
updated: 2026-03-31
last_reviewed: 2026-03-31
---

# Memory Index

## Strong Patterns
- Always READ before WRITE for memory files (5x)
- Use async-first patterns in all services (3x)

## Decisions
- Use FastAPI because async-first (2026-03-01)

## Facts
- Project uses PostgreSQL with pgvector

## Recent
- Added structured logging with structlog (2026-03-29)
"""


@pytest.mark.asyncio
async def test_align_memu_extracts_items_and_calls_memorize() -> None:
    mock_memorize = AsyncMock(return_value={"task_id": "123"})

    with patch("app.services.deep_dream.memu_memorize", mock_memorize):
        from app.services.deep_dream import align_memu_with_memory

        result = await align_memu_with_memory(CONSOLIDATION_MEMORY_MD, date(2026, 3, 31))

    assert result["items_synced"] == 4
    assert result["errors"] == 0
    assert mock_memorize.call_count == 4

    # Verify message format
    first_call = mock_memorize.call_args_list[0]
    messages = first_call[0][0]
    assert messages[0]["role"] == "user"
    assert "[Strong Patterns]" in messages[0]["content"]
    assert "deep_dream" in messages[0]["content"]


@pytest.mark.asyncio
async def test_align_memu_handles_partial_failure() -> None:
    call_count = 0

    async def mock_memorize(messages: list[dict[str, Any]]) -> dict[str, Any]:
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            msg = "MemU timeout"
            raise RuntimeError(msg)
        return {"task_id": "123"}

    with patch("app.services.deep_dream.memu_memorize", side_effect=mock_memorize):
        from app.services.deep_dream import align_memu_with_memory

        result = await align_memu_with_memory(CONSOLIDATION_MEMORY_MD, date(2026, 3, 31))

    assert result["items_synced"] == 3
    assert result["errors"] == 1


@pytest.mark.asyncio
async def test_align_memu_handles_completely_unreachable() -> None:
    mock_memorize = AsyncMock(side_effect=ConnectionError("MemU down"))

    with patch("app.services.deep_dream.memu_memorize", mock_memorize):
        from app.services.deep_dream import align_memu_with_memory

        result = await align_memu_with_memory(CONSOLIDATION_MEMORY_MD, date(2026, 3, 31))

    assert result["items_synced"] == 0
    assert result["errors"] == 4


@pytest.mark.asyncio
async def test_align_memu_empty_memory_md_returns_zero() -> None:
    mock_memorize = AsyncMock()

    with patch("app.services.deep_dream.memu_memorize", mock_memorize):
        from app.services.deep_dream import align_memu_with_memory

        result = await align_memu_with_memory("", date(2026, 3, 31))

    assert result["items_synced"] == 0
    assert result["errors"] == 0
    mock_memorize.assert_not_called()


# ── calculate_candidate_score tests ──


class TestCalculateCandidateScore:
    def test_perfect_score_with_high_reinforcement(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score = calculate_candidate_score(
            reinforcement_count=10,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=5,
        )
        assert score == pytest.approx(1.0, abs=0.01)

    def test_zero_reinforcement_still_has_base_score(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score = calculate_candidate_score(
            reinforcement_count=0,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=0,
        )
        # recency=1.0 (days=0), relevance=1.0, consistency=1.0
        # freq=0, breadth=0
        expected = 0.25 * 1.0 + 0.20 * 1.0 + 0.20 * 1.0
        assert score == pytest.approx(expected, abs=0.01)

    def test_contradiction_zeroes_consistency(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score_clean = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=3,
        )
        score_contradiction = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=True,
            context_count=3,
        )
        assert score_clean > score_contradiction
        # Difference should be exactly the consistency weight (0.20)
        assert score_clean - score_contradiction == pytest.approx(0.20, abs=0.01)

    def test_recency_decays_over_time(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score_recent = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=3,
        )
        score_old = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=60,
            in_active_project=True,
            has_contradiction=False,
            context_count=3,
        )
        assert score_recent > score_old

    def test_inactive_project_lowers_relevance(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score_active = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=3,
        )
        score_inactive = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=0,
            in_active_project=False,
            has_contradiction=False,
            context_count=3,
        )
        assert score_active > score_inactive

    def test_custom_weights(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        custom_weights = {
            "frequency": 1.0,
            "recency": 0.0,
            "relevance": 0.0,
            "consistency": 0.0,
            "breadth": 0.0,
        }
        score = calculate_candidate_score(
            reinforcement_count=10,
            days_since_reinforced=0,
            in_active_project=False,
            has_contradiction=True,
            context_count=0,
            weights=custom_weights,
        )
        assert score == pytest.approx(1.0, abs=0.01)

    def test_frequency_capped_at_one(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score_10 = calculate_candidate_score(
            reinforcement_count=10,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=5,
        )
        score_20 = calculate_candidate_score(
            reinforcement_count=20,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=5,
        )
        assert score_10 == pytest.approx(score_20, abs=0.01)

    def test_reference_always_returns_max_score(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score = calculate_candidate_score(
            reinforcement_count=0,
            days_since_reinforced=999,
            in_active_project=False,
            has_contradiction=True,
            context_count=0,
            is_reference=True,
        )
        assert score == 1.0

    def test_reference_false_behaves_normally(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score = calculate_candidate_score(
            reinforcement_count=0,
            days_since_reinforced=999,
            in_active_project=False,
            has_contradiction=True,
            context_count=0,
            is_reference=False,
        )
        assert score < 1.0

    def test_breadth_capped_at_one(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score_5 = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=5,
        )
        score_10 = calculate_candidate_score(
            reinforcement_count=5,
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=False,
            context_count=10,
        )
        assert score_5 == pytest.approx(score_10, abs=0.01)


# ── run_health_checks tests ──


@pytest.fixture()
def vault_workspace(tmp_path: Path) -> Path:
    # Create a basic vault structure
    (tmp_path / "decisions").mkdir()
    (tmp_path / "patterns").mkdir()
    (tmp_path / "concepts").mkdir()

    # Create _index.md files
    (tmp_path / "decisions" / "_index.md").write_text(
        "# Decisions\n- [[arch-choices]]\n", encoding="utf-8"
    )
    (tmp_path / "patterns" / "_index.md").write_text(
        "# Patterns\n- [[async-patterns]]\n", encoding="utf-8"
    )
    (tmp_path / "concepts" / "_index.md").write_text(
        "# Concepts\n", encoding="utf-8"
    )

    # Create vault files with frontmatter
    (tmp_path / "decisions" / "arch-choices.md").write_text(
        "---\ntype: decision\nlast_reviewed: 2026-04-01\n---\n# Arch Choices\n",
        encoding="utf-8",
    )
    (tmp_path / "patterns" / "async-patterns.md").write_text(
        "---\ntype: pattern\nlast_reviewed: 2026-01-01\n---\n# Async Patterns\n",
        encoding="utf-8",
    )

    # MEMORY.md with reasonable size
    (tmp_path / "MEMORY.md").write_text(
        "\n".join(f"- Line {i}" for i in range(100)), encoding="utf-8"
    )

    return tmp_path


@pytest.mark.asyncio
async def test_health_checks_detects_orphan_notes(vault_workspace: Path) -> None:
    # Create an orphan file not in _index.md
    (vault_workspace / "concepts" / "orphan-concept.md").write_text(
        "---\ntype: concept\nlast_reviewed: 2026-04-01\n---\n# Orphan\n",
        encoding="utf-8",
    )

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(vault_workspace)

    assert "concepts/orphan-concept.md" in report.orphan_notes


@pytest.mark.asyncio
async def test_health_checks_detects_stale_notes(vault_workspace: Path) -> None:
    from app.services.deep_dream import run_health_checks

    # patterns/async-patterns.md has last_reviewed: 2026-01-01 which is stale
    report = await run_health_checks(vault_workspace, stale_days=60)

    assert "patterns/async-patterns.md" in report.stale_notes


@pytest.mark.asyncio
async def test_health_checks_detects_missing_frontmatter(vault_workspace: Path) -> None:
    (vault_workspace / "decisions" / "no-fm.md").write_text(
        "# No Frontmatter\nJust content.", encoding="utf-8"
    )

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(vault_workspace)

    assert "decisions/no-fm.md" in report.missing_frontmatter


@pytest.mark.asyncio
async def test_health_checks_detects_contradictions(vault_workspace: Path) -> None:
    (vault_workspace / "decisions" / "contradicted.md").write_text(
        "---\ntype: decision\nhas_contradiction: true\n"
        "contradiction_reason: outdated\n---\n# Old\n",
        encoding="utf-8",
    )

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(vault_workspace)

    assert "decisions/contradicted.md" in report.unresolved_contradictions


@pytest.mark.asyncio
async def test_health_checks_detects_memory_overflow(vault_workspace: Path) -> None:
    (vault_workspace / "MEMORY.md").write_text(
        "\n".join(f"- Line {i}" for i in range(200)), encoding="utf-8"
    )

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(vault_workspace)

    assert report.memory_overflow is True


@pytest.mark.asyncio
async def test_health_checks_no_overflow_under_threshold(vault_workspace: Path) -> None:
    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(vault_workspace)

    assert report.memory_overflow is False


@pytest.mark.asyncio
async def test_health_checks_includes_knowledge_gaps(vault_workspace: Path) -> None:
    from app.services.deep_dream import run_health_checks

    gaps = ["event sourcing", "CQRS"]
    report = await run_health_checks(vault_workspace, knowledge_gaps=gaps)

    assert report.knowledge_gaps == gaps
    assert report.total_issues >= 2


@pytest.mark.asyncio
async def test_health_checks_total_issues_correct(vault_workspace: Path) -> None:
    # Add orphan + missing frontmatter + contradiction
    (vault_workspace / "concepts" / "orphan.md").write_text(
        "---\ntype: concept\nlast_reviewed: 2026-04-01\n---\n# Orphan\n",
        encoding="utf-8",
    )
    (vault_workspace / "decisions" / "no-fm.md").write_text(
        "# No FM\n", encoding="utf-8"
    )
    (vault_workspace / "decisions" / "contradicted.md").write_text(
        "---\nhas_contradiction: true\n---\n# X\n", encoding="utf-8"
    )

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(vault_workspace, knowledge_gaps=["gap1"])

    # orphan + missing_fm + contradiction + gap + stale (async-patterns)
    assert report.total_issues == (
        len(report.orphan_notes)
        + len(report.stale_notes)
        + len(report.missing_frontmatter)
        + len(report.unresolved_contradictions)
        + (1 if report.memory_overflow else 0)
        + len(report.knowledge_gaps)
    )


@pytest.mark.asyncio
async def test_health_checks_handles_empty_vault(tmp_path: Path) -> None:
    (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(tmp_path)

    assert report.total_issues == 0
    assert report.orphan_notes == []
    assert report.stale_notes == []


@pytest.mark.asyncio
async def test_health_check_skips_references_stale(tmp_path: Path) -> None:
    refs_dir = tmp_path / "references"
    refs_dir.mkdir()
    index = refs_dir / "_index.md"
    index.write_text("- [Old Ref](old-ref.md) -- old reference", encoding="utf-8")
    old_ref = refs_dir / "old-ref.md"
    old_ref.write_text(
        "---\ntype: reference\nstatus: permanent\n"
        "last_reviewed: 2024-01-01\n---\n# Old Ref",
        encoding="utf-8",
    )
    (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(tmp_path)

    assert "references/old-ref.md" not in report.stale_notes


@pytest.mark.asyncio
async def test_health_check_checks_references_frontmatter(tmp_path: Path) -> None:
    refs_dir = tmp_path / "references"
    refs_dir.mkdir()
    index = refs_dir / "_index.md"
    index.write_text("- [Bad Ref](bad-ref.md) -- no frontmatter", encoding="utf-8")
    bad_ref = refs_dir / "bad-ref.md"
    bad_ref.write_text("# Bad Ref\nNo frontmatter here", encoding="utf-8")
    (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(tmp_path)

    assert "references/bad-ref.md" in report.missing_frontmatter


@pytest.mark.asyncio
async def test_health_check_skips_references_contradictions(tmp_path: Path) -> None:
    refs_dir = tmp_path / "references"
    refs_dir.mkdir()
    index = refs_dir / "_index.md"
    index.write_text("- [Ref](ref-with-flag.md) -- ref", encoding="utf-8")
    ref_file = refs_dir / "ref-with-flag.md"
    ref_file.write_text(
        "---\ntype: reference\nhas_contradiction: true\n---\n# Ref",
        encoding="utf-8",
    )
    (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(tmp_path)

    assert "references/ref-with-flag.md" not in report.unresolved_contradictions
