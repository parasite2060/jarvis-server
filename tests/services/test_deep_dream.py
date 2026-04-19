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

    def test_failed_lesson_always_returns_max_score(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score = calculate_candidate_score(
            reinforcement_count=0,
            days_since_reinforced=999,
            in_active_project=False,
            has_contradiction=True,
            context_count=0,
            is_failed_lesson=True,
        )
        assert score == 1.0

    def test_failed_lesson_false_behaves_normally(self) -> None:
        from app.services.deep_dream import calculate_candidate_score

        score = calculate_candidate_score(
            reinforcement_count=0,
            days_since_reinforced=999,
            in_active_project=False,
            has_contradiction=True,
            context_count=0,
            is_failed_lesson=False,
        )
        assert score < 1.0

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
    (tmp_path / "concepts" / "_index.md").write_text("# Concepts\n", encoding="utf-8")

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
    (vault_workspace / "decisions" / "no-fm.md").write_text("# No FM\n", encoding="utf-8")
    (vault_workspace / "decisions" / "contradicted.md").write_text(
        "---\nhas_contradiction: true\n---\n# X\n", encoding="utf-8"
    )

    from app.services.deep_dream import run_health_checks

    report = await run_health_checks(vault_workspace, knowledge_gaps=["gap1"])

    # orphan + missing_fm + contradiction + gap + stale + backlinks +
    # unclassified + broken_wikilinks
    assert report.total_issues == (
        len(report.orphan_notes)
        + len(report.stale_notes)
        + len(report.missing_frontmatter)
        + len(report.unresolved_contradictions)
        + (1 if report.memory_overflow else 0)
        + len(report.knowledge_gaps)
        + len(report.missing_backlinks)
        + len(report.unclassified_lessons)
        + len(report.broken_wikilinks)
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
        "---\ntype: reference\nstatus: permanent\nlast_reviewed: 2024-01-01\n---\n# Old Ref",
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


# ── missing backlink detection tests ──


class TestMissingBacklinks:
    @pytest.mark.asyncio
    async def test_model_has_missing_backlinks_field(self) -> None:
        from app.services.dream_models import HealthReport

        report = HealthReport()
        assert report.missing_backlinks == []

    @pytest.mark.asyncio
    async def test_detects_missing_backlink(self, tmp_path: Path) -> None:
        decisions = tmp_path / "decisions"
        patterns = tmp_path / "patterns"
        decisions.mkdir()
        patterns.mkdir()
        (decisions / "_index.md").write_text("- [RC](runtime-choice.md) -- rc", encoding="utf-8")
        (patterns / "_index.md").write_text("- [AP](async-patterns.md) -- ap", encoding="utf-8")

        # Decision links to pattern, but pattern does NOT link back
        (decisions / "runtime-choice.md").write_text(
            "---\ntype: decision\nlast_reviewed: 2026-04-01\n---\n"
            "# Runtime Choice\nUse [[patterns/async-patterns]] for perf.\n",
            encoding="utf-8",
        )
        (patterns / "async-patterns.md").write_text(
            "---\ntype: pattern\nlast_reviewed: 2026-04-01\n---\n"
            "# Async Patterns\nNo links here.\n",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert len(report.missing_backlinks) == 1
        assert "decisions/runtime-choice.md" in report.missing_backlinks[0]
        assert "patterns/async-patterns.md" in report.missing_backlinks[0]
        assert "no reverse link" in report.missing_backlinks[0]

    @pytest.mark.asyncio
    async def test_no_flag_when_bidirectional(self, tmp_path: Path) -> None:
        decisions = tmp_path / "decisions"
        patterns = tmp_path / "patterns"
        decisions.mkdir()
        patterns.mkdir()
        (decisions / "_index.md").write_text("- [RC](runtime-choice.md) -- rc", encoding="utf-8")
        (patterns / "_index.md").write_text("- [AP](async-patterns.md) -- ap", encoding="utf-8")

        (decisions / "runtime-choice.md").write_text(
            "---\ntype: decision\nlast_reviewed: 2026-04-01\n---\n"
            "# Runtime Choice\nUse [[patterns/async-patterns]] for perf.\n",
            encoding="utf-8",
        )
        (patterns / "async-patterns.md").write_text(
            "---\ntype: pattern\nlast_reviewed: 2026-04-01\n---\n"
            "# Async Patterns\n## Related\n- [[decisions/runtime-choice]]\n",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert report.missing_backlinks == []

    @pytest.mark.asyncio
    async def test_skips_references_terminal_node(self, tmp_path: Path) -> None:
        decisions = tmp_path / "decisions"
        references = tmp_path / "references"
        decisions.mkdir()
        references.mkdir()
        (decisions / "_index.md").write_text("- [RC](runtime-choice.md) -- rc", encoding="utf-8")
        (references / "_index.md").write_text("- [CS](coding-standards.md) -- cs", encoding="utf-8")

        # Decision links to reference; reference does NOT link back (terminal node)
        (decisions / "runtime-choice.md").write_text(
            "---\ntype: decision\nlast_reviewed: 2026-04-01\n---\n"
            "# Runtime Choice\nPer [[references/coding-standards]].\n",
            encoding="utf-8",
        )
        (references / "coding-standards.md").write_text(
            "---\ntype: reference\nstatus: permanent\nlast_reviewed: 2026-04-01\n---\n"
            "# Coding Standards\nNo outbound links.\n",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert report.missing_backlinks == []

    @pytest.mark.asyncio
    async def test_total_issues_includes_missing_backlinks(self, tmp_path: Path) -> None:
        decisions = tmp_path / "decisions"
        patterns = tmp_path / "patterns"
        decisions.mkdir()
        patterns.mkdir()
        (decisions / "_index.md").write_text("- [RC](runtime-choice.md) -- rc", encoding="utf-8")
        (patterns / "_index.md").write_text("- [AP](async-patterns.md) -- ap", encoding="utf-8")

        (decisions / "runtime-choice.md").write_text(
            "---\ntype: decision\nlast_reviewed: 2026-04-01\n---\n"
            "# RC\nUse [[patterns/async-patterns]].\n",
            encoding="utf-8",
        )
        (patterns / "async-patterns.md").write_text(
            "---\ntype: pattern\nlast_reviewed: 2026-04-01\n---\n# AP\nNo backlink.\n",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert len(report.missing_backlinks) == 1
        assert report.total_issues >= 1
        # Verify missing_backlinks is counted in total
        expected_total = (
            len(report.orphan_notes)
            + len(report.stale_notes)
            + len(report.missing_frontmatter)
            + len(report.unresolved_contradictions)
            + (1 if report.memory_overflow else 0)
            + len(report.knowledge_gaps)
            + len(report.missing_backlinks)
            + len(report.unclassified_lessons)
        )
        assert report.total_issues == expected_total

    @pytest.mark.asyncio
    async def test_skips_nonexistent_target(self, tmp_path: Path) -> None:
        decisions = tmp_path / "decisions"
        decisions.mkdir()
        (decisions / "_index.md").write_text("- [RC](runtime-choice.md) -- rc", encoding="utf-8")

        # Links to a file that doesn't exist -- should not flag as missing backlink
        (decisions / "runtime-choice.md").write_text(
            "---\ntype: decision\nlast_reviewed: 2026-04-01\n---\n"
            "# RC\nSee [[patterns/nonexistent]].\n",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert report.missing_backlinks == []


# ── unclassified lessons health check tests ──


class TestUnclassifiedLessons:
    @pytest.mark.asyncio
    async def test_flags_old_lesson_without_outcome(self, tmp_path: Path) -> None:
        lessons_dir = tmp_path / "lessons"
        lessons_dir.mkdir()
        index = lessons_dir / "_index.md"
        index.write_text("- [Old Lesson](old-lesson.md) -- an old lesson", encoding="utf-8")
        old_lesson = lessons_dir / "old-lesson.md"
        old_lesson.write_text(
            "---\ntype: lesson\ncreated: 2025-01-01\nlast_reviewed: 2026-04-01\n---\n# Old Lesson",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert "lessons/old-lesson.md" in report.unclassified_lessons
        assert report.total_issues >= 1

    @pytest.mark.asyncio
    async def test_does_not_flag_lesson_with_outcome(self, tmp_path: Path) -> None:
        lessons_dir = tmp_path / "lessons"
        lessons_dir.mkdir()
        index = lessons_dir / "_index.md"
        index.write_text("- [Failed Lesson](failed-lesson.md) -- failed", encoding="utf-8")
        failed_lesson = lessons_dir / "failed-lesson.md"
        failed_lesson.write_text(
            "---\ntype: lesson\ncreated: 2025-01-01\noutcome: failed\n"
            "failure_reason: it broke\nlast_reviewed: 2026-04-01\n---\n# Failed Lesson",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert "lessons/failed-lesson.md" not in report.unclassified_lessons

    @pytest.mark.asyncio
    async def test_does_not_flag_recent_lesson_without_outcome(self, tmp_path: Path) -> None:
        lessons_dir = tmp_path / "lessons"
        lessons_dir.mkdir()
        index = lessons_dir / "_index.md"
        index.write_text("- [New Lesson](new-lesson.md) -- new", encoding="utf-8")
        new_lesson = lessons_dir / "new-lesson.md"
        new_lesson.write_text(
            "---\ntype: lesson\ncreated: 2026-04-01\nlast_reviewed: 2026-04-01\n---\n# New Lesson",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        assert report.unclassified_lessons == []

    @pytest.mark.asyncio
    async def test_total_issues_includes_unclassified_lessons(self, tmp_path: Path) -> None:
        lessons_dir = tmp_path / "lessons"
        lessons_dir.mkdir()
        index = lessons_dir / "_index.md"
        index.write_text("- [Old](old.md) -- old", encoding="utf-8")
        (lessons_dir / "old.md").write_text(
            "---\ntype: lesson\ncreated: 2025-01-01\nlast_reviewed: 2026-04-01\n---\n# Old",
            encoding="utf-8",
        )
        (tmp_path / "MEMORY.md").write_text("# Memory\n", encoding="utf-8")

        from app.services.deep_dream import run_health_checks

        report = await run_health_checks(tmp_path)

        expected_total = (
            len(report.orphan_notes)
            + len(report.stale_notes)
            + len(report.missing_frontmatter)
            + len(report.unresolved_contradictions)
            + (1 if report.memory_overflow else 0)
            + len(report.knowledge_gaps)
            + len(report.missing_backlinks)
            + len(report.unclassified_lessons)
        )
        assert report.total_issues == expected_total


class TestAutoFixHealthIssues:
    @pytest.mark.asyncio
    async def test_fixes_missing_backlinks(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()

        (decisions_dir / "_index.md").write_text("- [Choice](choice.md)", encoding="utf-8")
        (decisions_dir / "choice.md").write_text(
            "---\ntype: decision\ncreated: 2026-04-14\n"
            "updated: 2026-04-14\nlast_reviewed: 2026-04-14\n---\n\n"
            "# Choice\nSee [[patterns/my-pattern]]\n",
            encoding="utf-8",
        )
        (patterns_dir / "_index.md").write_text("- [My Pattern](my-pattern.md)", encoding="utf-8")
        (patterns_dir / "my-pattern.md").write_text(
            "---\ntype: pattern\ncreated: 2026-04-14\n"
            "updated: 2026-04-14\nlast_reviewed: 2026-04-14\n---\n\n"
            "# My Pattern\nSome content\n",
            encoding="utf-8",
        )

        from app.services.deep_dream import auto_fix_health_issues, run_health_checks

        report = await run_health_checks(tmp_path)
        assert len(report.missing_backlinks) > 0

        fixes = await auto_fix_health_issues(tmp_path, report)
        assert fixes["backlinks_fixed"] >= 1

        pattern_content = (patterns_dir / "my-pattern.md").read_text(encoding="utf-8")
        assert "[[decisions/choice]]" in pattern_content

    @pytest.mark.asyncio
    async def test_fixes_missing_frontmatter(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        (decisions_dir / "_index.md").write_text("- [No FM](no-fm.md)", encoding="utf-8")
        (decisions_dir / "no-fm.md").write_text(
            "# No Frontmatter\nJust content\n", encoding="utf-8"
        )

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            missing_frontmatter=["decisions/no-fm.md"],
            total_issues=1,
        )

        fixes = await auto_fix_health_issues(tmp_path, report)
        assert fixes["frontmatter_fixed"] == 1

        content = (decisions_dir / "no-fm.md").read_text(encoding="utf-8")
        assert content.startswith("---")
        assert "type: decision" in content
        assert "# No Frontmatter" in content

    @pytest.mark.asyncio
    async def test_fixes_orphan_notes(self, tmp_path: Path) -> None:
        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()
        (patterns_dir / "_index.md").write_text("# Patterns Index\n", encoding="utf-8")
        (patterns_dir / "orphan-pattern.md").write_text(
            "---\ntype: pattern\n---\n# Orphan\n", encoding="utf-8"
        )

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            orphan_notes=["patterns/orphan-pattern.md"],
            total_issues=1,
        )

        fixes = await auto_fix_health_issues(tmp_path, report)
        assert fixes["orphans_fixed"] == 1

        index = (patterns_dir / "_index.md").read_text(encoding="utf-8")
        assert "orphan-pattern.md" in index

    @pytest.mark.asyncio
    async def test_appends_to_existing_related_section(self, tmp_path: Path) -> None:
        concepts_dir = tmp_path / "concepts"
        concepts_dir.mkdir()
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()

        (concepts_dir / "_index.md").write_text("- [C](c.md)", encoding="utf-8")
        (concepts_dir / "c.md").write_text(
            "---\ntype: concept\ncreated: 2026-04-14\n"
            "updated: 2026-04-14\nlast_reviewed: 2026-04-14\n---\n\n"
            "# Concept C\nContent\n\n## Related\n- [[patterns/existing]]\n",
            encoding="utf-8",
        )

        (decisions_dir / "_index.md").write_text("- [D](d.md)", encoding="utf-8")
        (decisions_dir / "d.md").write_text(
            "---\ntype: decision\ncreated: 2026-04-14\n"
            "updated: 2026-04-14\nlast_reviewed: 2026-04-14\n---\n\n"
            "# Decision D\nSee [[concepts/c]]\n",
            encoding="utf-8",
        )

        from app.services.deep_dream import auto_fix_health_issues, run_health_checks

        report = await run_health_checks(tmp_path)
        await auto_fix_health_issues(tmp_path, report)

        concept_content = (concepts_dir / "c.md").read_text(encoding="utf-8")
        assert "[[decisions/d]]" in concept_content
        assert "[[patterns/existing]]" in concept_content

    @pytest.mark.asyncio
    async def test_no_fixes_when_no_issues(self, tmp_path: Path) -> None:
        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(total_issues=0)
        fixes = await auto_fix_health_issues(tmp_path, report)
        assert fixes["total_fixed"] == 0


# ---------------------------------------------------------------------------
# Story 11.12: Bootstrap missing _index.md in orphan repair
# ---------------------------------------------------------------------------


class TestFixOrphanNotesBootstrap:
    """Story 11.12 — `_fix_orphan_notes` creates the folder's `_index.md`
    via `regenerate_index` when it does not exist, else appends idempotently."""

    @pytest.mark.asyncio
    async def test_fix_orphan_creates_missing_index(self, tmp_path: Path) -> None:
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "alpha.md").write_text(
            "---\ntype: template\ncreated: 2026-04-01\n"
            "updated: 2026-04-01\nlast_reviewed: 2026-04-01\n---\n\n"
            "# Alpha Template\n\nThe alpha template body.\n",
            encoding="utf-8",
        )
        (templates_dir / "beta.md").write_text(
            "---\ntype: template\ncreated: 2026-04-02\n"
            "updated: 2026-04-02\nlast_reviewed: 2026-04-02\n---\n\n"
            "# Beta Template\n\nThe beta template body.\n",
            encoding="utf-8",
        )

        from app.services.deep_dream import _fix_orphan_notes

        with (
            patch("app.services.vault_updater.settings") as mock_vu_settings,
            patch("app.services.memory_files.settings") as mock_mf_settings,
        ):
            mock_vu_settings.ai_memory_repo_path = str(tmp_path)
            mock_mf_settings.ai_memory_repo_path = str(tmp_path)
            fixed = await _fix_orphan_notes(
                tmp_path,
                ["templates/alpha.md", "templates/beta.md"],
                date(2026, 4, 18),
            )

        index_path = templates_dir / "_index.md"
        assert index_path.is_file()
        content = index_path.read_text(encoding="utf-8")
        assert "type: index" in content
        assert "# Templates Index" in content
        assert "(alpha.md)" in content
        assert "(beta.md)" in content
        assert fixed == 2

    @pytest.mark.asyncio
    async def test_fix_orphan_appends_to_existing_index(self, tmp_path: Path) -> None:
        concepts_dir = tmp_path / "concepts"
        concepts_dir.mkdir()
        existing_index = (
            "---\ntype: index\ntags: [concepts]\n"
            "created: 2026-04-01\nupdated: 2026-04-01\n"
            "last_reviewed: 2026-04-01\n---\n\n"
            "# Concepts Index\n\n"
            "- [Already Indexed](already-indexed.md) -- Some existing summary\n"
        )
        (concepts_dir / "_index.md").write_text(existing_index, encoding="utf-8")
        (concepts_dir / "already-indexed.md").write_text(
            "---\ntype: concept\n---\n# Already Indexed\n", encoding="utf-8"
        )
        (concepts_dir / "new-orphan.md").write_text(
            "---\ntype: concept\n---\n# New Orphan\n", encoding="utf-8"
        )

        from app.services.deep_dream import _fix_orphan_notes

        fixed = await _fix_orphan_notes(
            tmp_path,
            ["concepts/new-orphan.md"],
            date(2026, 4, 18),
        )

        content = (concepts_dir / "_index.md").read_text(encoding="utf-8")
        assert "- [Already Indexed](already-indexed.md) -- Some existing summary" in content
        assert "(new-orphan.md)" in content
        assert fixed == 1

    @pytest.mark.asyncio
    async def test_fix_orphan_is_idempotent_within_loop(self, tmp_path: Path) -> None:
        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()
        (patterns_dir / "_index.md").write_text(
            "---\ntype: index\n---\n\n# Patterns Index\n",
            encoding="utf-8",
        )
        (patterns_dir / "repeat.md").write_text(
            "---\ntype: pattern\n---\n# Repeat\n", encoding="utf-8"
        )

        from app.services.deep_dream import _fix_orphan_notes

        await _fix_orphan_notes(tmp_path, ["patterns/repeat.md"], date(2026, 4, 18))
        first = (patterns_dir / "_index.md").read_text(encoding="utf-8")

        fixed_second = await _fix_orphan_notes(tmp_path, ["patterns/repeat.md"], date(2026, 4, 18))
        second = (patterns_dir / "_index.md").read_text(encoding="utf-8")

        assert first == second
        assert fixed_second == 0
        assert first.count("(repeat.md)") == 1

    @pytest.mark.asyncio
    async def test_loop_iteration_bootstraps_missing_index(self, tmp_path: Path) -> None:
        """AC9 — integration: a full `auto_fix_health_issues` call inside the
        loop context bootstraps `_index.md` for an orphan whose folder lacks one."""
        templates_dir = tmp_path / "templates"
        templates_dir.mkdir()
        (templates_dir / "2026-04-06-factory-and-chain-patterns.md").write_text(
            "---\ntype: template\ncreated: 2026-04-06\n"
            "updated: 2026-04-06\nlast_reviewed: 2026-04-06\n---\n\n"
            "# Factory and Chain Patterns\n\nFactory and chain pattern template.\n",
            encoding="utf-8",
        )

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            orphan_notes=["templates/2026-04-06-factory-and-chain-patterns.md"],
            total_issues=1,
        )

        with (
            patch("app.services.vault_updater.settings") as mock_vu_settings,
            patch("app.services.memory_files.settings") as mock_mf_settings,
        ):
            mock_vu_settings.ai_memory_repo_path = str(tmp_path)
            mock_mf_settings.ai_memory_repo_path = str(tmp_path)
            fixes = await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))

        index_path = templates_dir / "_index.md"
        assert index_path.is_file()
        content = index_path.read_text(encoding="utf-8")
        assert "(2026-04-06-factory-and-chain-patterns.md)" in content
        assert fixes["orphans_fixed"] == 1

    @pytest.mark.asyncio
    async def test_fix_orphan_groups_by_folder(self, tmp_path: Path) -> None:
        for folder in ("templates", "decisions", "concepts"):
            (tmp_path / folder).mkdir()
            (tmp_path / folder / f"{folder[:-1]}-a.md").write_text(
                f"---\ntype: {folder[:-1]}\n---\n# {folder.title()} A\n",
                encoding="utf-8",
            )
            (tmp_path / folder / f"{folder[:-1]}-b.md").write_text(
                f"---\ntype: {folder[:-1]}\n---\n# {folder.title()} B\n",
                encoding="utf-8",
            )

        from app.services.deep_dream import _fix_orphan_notes

        regen_mock = AsyncMock(return_value={"path": "x/_index.md", "action": "rewrite"})
        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.deep_dream.regenerate_index", regen_mock),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            fixed = await _fix_orphan_notes(
                tmp_path,
                [
                    "templates/template-a.md",
                    "templates/template-b.md",
                    "decisions/decision-a.md",
                    "concepts/concept-a.md",
                    "concepts/concept-b.md",
                ],
                date(2026, 4, 18),
            )

        assert regen_mock.call_count == 3
        folders_called = {call.args[0] for call in regen_mock.call_args_list}
        assert folders_called == {"templates", "decisions", "concepts"}
        assert fixed == 5


# ---------------------------------------------------------------------------
# Story 11.13: Deterministic backlink writer + broken_wikilinks check
# ---------------------------------------------------------------------------


def _seed_file(path: Path, body: str, *, with_frontmatter: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if with_frontmatter:
        fm = (
            "---\ntype: note\ncreated: 2026-04-14\n"
            "updated: 2026-04-14\nlast_reviewed: 2026-04-14\n---\n\n"
        )
        path.write_text(fm + body, encoding="utf-8")
    else:
        path.write_text(body, encoding="utf-8")


class TestBacklinkWriter:
    """Story 11.13 — deterministic backlink repair in `auto_fix_health_issues`."""

    @pytest.mark.asyncio
    async def test_backlink_writer_adds_reverse_link(self, tmp_path: Path) -> None:
        (tmp_path / "decisions").mkdir()
        (tmp_path / "patterns").mkdir()
        _seed_file(
            tmp_path / "decisions" / "choice.md",
            "# Choice\n\nSee [[patterns/my-pattern]].\n",
        )
        _seed_file(
            tmp_path / "patterns" / "my-pattern.md",
            "# My Pattern\n\nPattern body.\n",
        )

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            missing_backlinks=[
                "decisions/choice.md \u2192 patterns/my-pattern.md (no reverse link)"
            ],
            total_issues=1,
        )
        fixes = await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))

        content = (tmp_path / "patterns" / "my-pattern.md").read_text(encoding="utf-8")
        assert "## Related" in content
        assert "[[decisions/choice]]" in content
        assert fixes["backlinks_fixed"] == 1

    @pytest.mark.asyncio
    async def test_backlink_writer_creates_related_section_if_missing(self, tmp_path: Path) -> None:
        (tmp_path / "decisions").mkdir()
        (tmp_path / "patterns").mkdir()
        _seed_file(tmp_path / "decisions" / "d.md", "# D\n")
        target_body = "# Target\n\nBody with no related section.\n"
        _seed_file(tmp_path / "patterns" / "target.md", target_body)

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            missing_backlinks=["decisions/d.md \u2192 patterns/target.md (no reverse link)"],
            total_issues=1,
        )
        await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))

        content = (tmp_path / "patterns" / "target.md").read_text(encoding="utf-8")
        assert "\n\n## Related\n" in content
        assert "- [[decisions/d]]\n" in content

    @pytest.mark.asyncio
    async def test_backlink_writer_is_idempotent(self, tmp_path: Path) -> None:
        (tmp_path / "decisions").mkdir()
        (tmp_path / "patterns").mkdir()
        _seed_file(tmp_path / "decisions" / "d.md", "# D\n")
        _seed_file(tmp_path / "patterns" / "t.md", "# T\n\nBody.\n")

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            missing_backlinks=["decisions/d.md \u2192 patterns/t.md (no reverse link)"],
            total_issues=1,
        )

        await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))
        first = (tmp_path / "patterns" / "t.md").read_text(encoding="utf-8")

        fixes_second = await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))
        second = (tmp_path / "patterns" / "t.md").read_text(encoding="utf-8")

        assert first == second
        assert fixes_second["backlinks_fixed"] == 0
        assert first.count("[[decisions/d]]") == 1

    @pytest.mark.asyncio
    async def test_backlink_writer_skips_references_target(self, tmp_path: Path) -> None:
        (tmp_path / "decisions").mkdir()
        (tmp_path / "references").mkdir()
        _seed_file(tmp_path / "decisions" / "d.md", "# D\n")
        ref_body = "# Ref\n\nTerminal reference.\n"
        _seed_file(tmp_path / "references" / "r.md", ref_body)
        before = (tmp_path / "references" / "r.md").read_text(encoding="utf-8")

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            missing_backlinks=["decisions/d.md \u2192 references/r.md (no reverse link)"],
            total_issues=1,
        )
        fixes = await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))

        after = (tmp_path / "references" / "r.md").read_text(encoding="utf-8")
        assert before == after
        assert fixes["backlinks_fixed"] == 0

    @pytest.mark.asyncio
    async def test_backlink_writer_handles_missing_source(self, tmp_path: Path) -> None:
        (tmp_path / "patterns").mkdir()
        target_body = "# T\n\nBody.\n"
        _seed_file(tmp_path / "patterns" / "t.md", target_body)
        before = (tmp_path / "patterns" / "t.md").read_text(encoding="utf-8")

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            missing_backlinks=["decisions/nonexistent.md \u2192 patterns/t.md (no reverse link)"],
            total_issues=1,
        )
        fixes = await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))

        after = (tmp_path / "patterns" / "t.md").read_text(encoding="utf-8")
        assert before == after
        assert fixes["backlinks_fixed"] == 0

    @pytest.mark.asyncio
    async def test_backlink_writer_preserves_existing_related_entries(self, tmp_path: Path) -> None:
        (tmp_path / "decisions").mkdir()
        (tmp_path / "concepts").mkdir()
        _seed_file(tmp_path / "decisions" / "d.md", "# D\n")
        existing = (
            "# T\n\nBody.\n\n"
            "## Related\n"
            "- [[patterns/existing-one]]\n"
            "- [[patterns/existing-two]]\n"
            "- [[concepts/existing-three]]\n"
        )
        _seed_file(tmp_path / "concepts" / "t.md", existing)

        from app.services.deep_dream import auto_fix_health_issues
        from app.services.dream_models import HealthReport

        report = HealthReport(
            missing_backlinks=["decisions/d.md \u2192 concepts/t.md (no reverse link)"],
            total_issues=1,
        )
        await auto_fix_health_issues(tmp_path, report, date(2026, 4, 18))

        content = (tmp_path / "concepts" / "t.md").read_text(encoding="utf-8")
        assert "[[patterns/existing-one]]" in content
        assert "[[patterns/existing-two]]" in content
        assert "[[concepts/existing-three]]" in content
        assert "[[decisions/d]]" in content


class TestBrokenWikilinks:
    """Story 11.13 — `_find_broken_wikilinks` structural check."""

    @pytest.mark.asyncio
    async def test_broken_wikilinks_catches_empty_filename(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _find_broken_wikilinks

        (tmp_path / "projects").mkdir()
        _seed_file(
            tmp_path / "projects" / "svc.md",
            "# Service\n\n## Related\n- [[decisions/]] — native librdkafka\n",
        )

        unresolved = _find_broken_wikilinks(tmp_path)
        assert any("projects/svc.md" in e and "[[decisions/]]" in e for e in unresolved)

    @pytest.mark.asyncio
    async def test_broken_wikilinks_catches_fabricated_target(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _find_broken_wikilinks

        (tmp_path / "patterns").mkdir()
        _seed_file(
            tmp_path / "patterns" / "arch.md",
            "# Arch\n\nSee [[projects/does-not-exist]].\n",
        )

        unresolved = _find_broken_wikilinks(tmp_path)
        assert any(
            "patterns/arch.md" in e and "[[projects/does-not-exist]]" in e for e in unresolved
        )

    @pytest.mark.asyncio
    async def test_broken_wikilinks_ignores_valid_links(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _find_broken_wikilinks

        (tmp_path / "decisions").mkdir()
        (tmp_path / "patterns").mkdir()
        _seed_file(tmp_path / "decisions" / "d.md", "# D\n\nSee [[patterns/p]].\n")
        _seed_file(tmp_path / "patterns" / "p.md", "# P\n\nSee [[decisions/d]].\n")

        unresolved = _find_broken_wikilinks(tmp_path)
        assert unresolved == []

    @pytest.mark.asyncio
    async def test_broken_wikilinks_ignores_dailys_and_backups(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _find_broken_wikilinks

        (tmp_path / "dailys").mkdir()
        (tmp_path / ".backups").mkdir()
        (tmp_path / "dailys" / "2026-04-18.md").write_text("[[decisions/gone]]", encoding="utf-8")
        (tmp_path / ".backups" / "MEMORY.md.2026-04-18.bak").write_text(
            "[[anywhere/]]", encoding="utf-8"
        )

        unresolved = _find_broken_wikilinks(tmp_path)
        assert unresolved == []

    @pytest.mark.asyncio
    async def test_broken_wikilinks_handles_references(self, tmp_path: Path) -> None:
        """References can be linked to without being flagged.

        A reference file with a valid forward link and no inbound link should
        not produce spurious `broken_wikilinks` entries — the check is about
        whether `target.md` resolves on disk, not about bidirectionality."""
        from app.services.deep_dream import _find_broken_wikilinks

        (tmp_path / "decisions").mkdir()
        (tmp_path / "references").mkdir()
        _seed_file(tmp_path / "decisions" / "d.md", "# D\n\nSee [[references/rfc]].\n")
        _seed_file(tmp_path / "references" / "rfc.md", "# RFC 7159\n\nTerminal reference.\n")

        unresolved = _find_broken_wikilinks(tmp_path)
        assert unresolved == []


# ── validate_vault_post_fix tests ──


@pytest.mark.asyncio
async def test_validate_vault_post_fix_happy_path() -> None:
    memory_md = "\n".join(f"- entry {i}" for i in range(50))
    daily_md = "## Session 1\nNotes."

    async def fake_read(path: str) -> str | None:
        if path == "MEMORY.md":
            return memory_md
        if path == "dailys/2026-04-18.md":
            return daily_md
        return None

    with patch("app.services.deep_dream.read_vault_file", side_effect=fake_read):
        from app.services.deep_dream import validate_vault_post_fix

        result = await validate_vault_post_fix(date(2026, 4, 18))

    assert result["validation_failed"] is False
    assert result["warnings"] == []


@pytest.mark.asyncio
async def test_validate_vault_post_fix_overflow() -> None:
    memory_md = "\n".join(f"- entry {i}" for i in range(250))
    daily_md = "## Session 1\nNotes."

    async def fake_read(path: str) -> str | None:
        if path == "MEMORY.md":
            return memory_md
        if path == "dailys/2026-04-18.md":
            return daily_md
        return None

    with patch("app.services.deep_dream.read_vault_file", side_effect=fake_read):
        from app.services.deep_dream import validate_vault_post_fix

        result = await validate_vault_post_fix(date(2026, 4, 18))

    assert result["validation_failed"] is True
    assert any("250" in w for w in result["warnings"])
    assert any("MEMORY.md" in w for w in result["warnings"])


@pytest.mark.asyncio
async def test_validate_vault_post_fix_missing_daily() -> None:
    memory_md = "- entry 1\n- entry 2"

    async def fake_read(path: str) -> str | None:
        if path == "MEMORY.md":
            return memory_md
        return None

    with patch("app.services.deep_dream.read_vault_file", side_effect=fake_read):
        from app.services.deep_dream import validate_vault_post_fix

        result = await validate_vault_post_fix(date(2026, 4, 18))

    assert result["validation_failed"] is True
    assert any("dailys/2026-04-18.md" in w for w in result["warnings"])


@pytest.mark.asyncio
async def test_validate_vault_post_fix_empty_memory() -> None:
    async def fake_read(path: str) -> str | None:
        if path == "MEMORY.md":
            return "   \n  \n"
        if path == "dailys/2026-04-18.md":
            return "## Session 1"
        return None

    with patch("app.services.deep_dream.read_vault_file", side_effect=fake_read):
        from app.services.deep_dream import validate_vault_post_fix

        result = await validate_vault_post_fix(date(2026, 4, 18))

    assert result["validation_failed"] is True
    assert any("MEMORY.md" in w and "empty" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# Story 11.10: Bounded health-check / health-fix loop
# ---------------------------------------------------------------------------

import contextlib  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

from pydantic_ai.usage import RunUsage  # noqa: E402

from app.models.tables import Dream  # noqa: E402
from app.services.dream_models import (  # noqa: E402
    ConsolidationOutput,
    ConsolidationStats,
    HealthFixAction,
    HealthFixOutput,
    HealthReport,
    LightSleepOutput,
    REMSleepOutput,
    ScoredCandidate,
    VaultUpdates,
)


def _make_dream_row() -> Dream:
    d = Dream(type="deep", trigger="auto", status="processing")
    d.id = 1  # type: ignore[assignment]
    return d


class _FakeSessionFactory:
    def __init__(self, dream: Dream) -> None:
        self.dream = dream
        self.added_items: list[Any] = []

    def __call__(self) -> "_FakeSessionFactory":
        return self

    async def __aenter__(self) -> "_FakeSession":
        return _FakeSession(self)

    async def __aexit__(self, *args: Any) -> None:
        return None


class _FakeSession:
    def __init__(self, factory: _FakeSessionFactory) -> None:
        self._factory = factory

    async def execute(self, stmt: Any) -> MagicMock:
        result = MagicMock()
        result.scalar_one.return_value = self._factory.dream
        result.scalar_one_or_none.return_value = self._factory.dream
        return result

    def add(self, item: Any) -> None:
        self._factory.added_items.append(item)

    async def commit(self) -> None:
        return None

    async def refresh(self, item: Any) -> None:
        if isinstance(item, Dream):
            item.id = self._factory.dream.id


_LOOP_USAGE = RunUsage(input_tokens=10, output_tokens=5, requests=1)


_LOOP_CONSOLIDATION = ConsolidationOutput(
    memory_md="# M\n- entry",
    daily_summary="Day.",
    stats=ConsolidationStats(),
    vault_updates=VaultUpdates(),
)

_LOOP_VALIDATED: dict[str, Any] = {
    "memory_md": "# M\n- entry",
    "daily_summary": "Day.",
    "stats": {},
    "vault_updates": {
        "decisions": [],
        "projects": [],
        "patterns": [],
        "templates": [],
        "concepts": [],
        "connections": [],
        "lessons": [],
    },
    "line_count": 2,
    "warnings": [],
}


def _report_with_contradictions(n: int) -> HealthReport:
    return HealthReport(
        unresolved_contradictions=[f"decisions/c{i}.md" for i in range(n)],
        total_issues=n,
    )


def _loop_fix_output(n_actions: int, iteration: int = 1) -> HealthFixOutput:
    return HealthFixOutput(
        actions=[
            HealthFixAction(
                issue_type="unresolved_contradiction",
                target_file=f"decisions/c{i}.md",
                action_taken="resolved_contradiction",
            )
            for i in range(n_actions)
        ],
        issues_resolved=n_actions,
        iteration=iteration,
    )


def _build_loop_patches(
    dream: Dream,
    *,
    health_check_sequence: list[HealthReport],
    run_health_fix_returns: list[Any] | None = None,
    run_health_fix_side_effect: list[Any] | None = None,
) -> dict[str, Any]:
    patches: dict[str, Any] = {
        "app.tasks.deep_dream_task.async_session_factory": _FakeSessionFactory(dream),
        "app.tasks.deep_dream_task.gather_consolidation_inputs": AsyncMock(
            return_value={
                "memu_memories": [{"content": "x"}],
                "memory_md": "m",
                "daily_log": "d",
                "soul_md": "s",
            }
        ),
        "app.tasks.deep_dream_task._backup_files": AsyncMock(),
        "app.tasks.deep_dream_task.run_phase1_light_sleep": AsyncMock(
            return_value=(
                LightSleepOutput(candidates=[ScoredCandidate(content="c", category="facts")]),
                _LOOP_USAGE,
                1,
                [],
            )
        ),
        "app.tasks.deep_dream_task.read_vault_file": AsyncMock(return_value=None),
        "app.tasks.deep_dream_task.run_phase2_rem_sleep": AsyncMock(
            return_value=(REMSleepOutput(), _LOOP_USAGE, 1, [])
        ),
        "app.tasks.deep_dream_task.run_deep_dream_consolidation": AsyncMock(
            return_value=(_LOOP_CONSOLIDATION, _LOOP_USAGE, 1, ["phase3-msg"])
        ),
        "app.tasks.deep_dream_task.consolidation_to_dict": MagicMock(return_value=_LOOP_VALIDATED),
        "app.tasks.deep_dream_task.validate_consolidated_output": AsyncMock(
            return_value=_LOOP_VALIDATED
        ),
        "app.tasks.deep_dream_task.write_consolidated_files": AsyncMock(
            return_value=[{"path": "MEMORY.md", "action": "rewrite"}]
        ),
        "app.tasks.deep_dream_task.update_vault_folders": AsyncMock(return_value=[]),
        "app.tasks.deep_dream_task.update_file_manifest": AsyncMock(),
        "app.tasks.deep_dream_task.append_vault_log": AsyncMock(),
        "app.tasks.deep_dream_task.git_ops_service.create_deep_dream_pr": AsyncMock(
            return_value={"git_branch": "", "git_pr_url": "", "git_pr_status": ""}
        ),
        "app.tasks.deep_dream_task.git_ops_service.cleanup_branch": AsyncMock(),
        "app.tasks.deep_dream_task.invalidate_context_cache": AsyncMock(),
        "app.tasks.deep_dream_task.align_memu_with_memory": AsyncMock(
            return_value={"items_synced": 0, "errors": 0}
        ),
        "app.tasks.deep_dream_task.auto_fix_health_issues": AsyncMock(
            return_value={"total_fixed": 0}
        ),
        "app.tasks.deep_dream_task.run_health_checks": AsyncMock(
            side_effect=list(health_check_sequence)
        ),
        "app.tasks.deep_dream_task.calculate_candidate_score": MagicMock(return_value=0.5),
        "app.tasks.deep_dream_task.validate_vault_post_fix": AsyncMock(
            return_value={"warnings": [], "validation_failed": False}
        ),
        "app.tasks.deep_dream_task.store_phase_telemetry": AsyncMock(return_value=1),
    }
    if run_health_fix_side_effect is not None:
        patches["app.tasks.deep_dream_task.run_health_fix"] = AsyncMock(
            side_effect=run_health_fix_side_effect
        )
    else:
        patches["app.tasks.deep_dream_task.run_health_fix"] = AsyncMock(
            side_effect=run_health_fix_returns or []
        )
    return patches


async def _run_loop(patches: dict[str, Any]) -> dict[str, AsyncMock]:
    mocks: dict[str, AsyncMock] = {}
    with contextlib.ExitStack() as stack:
        for target, mock_obj in patches.items():
            mocks[target] = stack.enter_context(patch(target, mock_obj))
        from app.tasks.deep_dream_task import deep_dream_task

        await deep_dream_task({}, trigger="auto")
    return mocks


class TestHealthFixLoop:
    """Story 11.10 — bounded health-check / health-fix loop."""

    @pytest.mark.asyncio
    async def test_loop_exits_on_clean_check(self) -> None:
        dream = _make_dream_row()
        clean = HealthReport(total_issues=0)
        patches = _build_loop_patches(
            dream,
            health_check_sequence=[clean],
        )
        mocks = await _run_loop(patches)

        mocks["app.tasks.deep_dream_task.run_health_fix"].assert_not_called()
        # No health_fix telemetry row written
        telemetry_calls = mocks["app.tasks.deep_dream_task.store_phase_telemetry"].call_args_list
        health_fix_rows = [c for c in telemetry_calls if c.kwargs.get("phase") == "health_fix"]
        assert len(health_fix_rows) == 0
        assert dream.status == "completed"

    @pytest.mark.asyncio
    async def test_loop_converges_in_two_iterations(self) -> None:
        dream = _make_dream_row()
        r3 = _report_with_contradictions(3)
        r1 = _report_with_contradictions(1)
        clean = HealthReport(total_issues=0)
        patches = _build_loop_patches(
            dream,
            # Sequence [3, 1, 0]: iter1 check=3 → fix; iter2 check=1 → fix; iter3 check=0 → break
            health_check_sequence=[r3, r1, clean],
            run_health_fix_returns=[
                (_loop_fix_output(3), _LOOP_USAGE, 1, ["m1"]),
                (_loop_fix_output(1), _LOOP_USAGE, 1, ["m2"]),
            ],
        )
        mocks = await _run_loop(patches)

        fix_mock = mocks["app.tasks.deep_dream_task.run_health_fix"]
        assert fix_mock.call_count == 2

        telemetry_calls = mocks["app.tasks.deep_dream_task.store_phase_telemetry"].call_args_list
        health_fix_rows = [c for c in telemetry_calls if c.kwargs.get("phase") == "health_fix"]
        assert len(health_fix_rows) == 2
        iterations = [row.kwargs["output_json"]["iteration"] for row in health_fix_rows]
        assert iterations == [1, 2]

        assert dream.status == "completed"
        assert dream.error_message is None

    @pytest.mark.asyncio
    async def test_loop_hits_iteration_cap(self) -> None:
        dream = _make_dream_row()
        r3 = _report_with_contradictions(3)
        patches = _build_loop_patches(
            dream,
            # Sequence [3, 3, 3, 3]: 4 checks total, 3 LLM fixes, then cap hit.
            health_check_sequence=[r3, r3, r3, r3],
            run_health_fix_returns=[
                (_loop_fix_output(3), _LOOP_USAGE, 1, ["m1"]),
                (_loop_fix_output(3), _LOOP_USAGE, 1, ["m2"]),
                (_loop_fix_output(3), _LOOP_USAGE, 1, ["m3"]),
            ],
        )
        mocks = await _run_loop(patches)

        fix_mock = mocks["app.tasks.deep_dream_task.run_health_fix"]
        assert fix_mock.call_count == 3

        telemetry_calls = mocks["app.tasks.deep_dream_task.store_phase_telemetry"].call_args_list
        health_fix_rows = [c for c in telemetry_calls if c.kwargs.get("phase") == "health_fix"]
        assert len(health_fix_rows) == 3

        assert dream.status == "partial"
        assert dream.error_message is not None
        assert "health_fix did not converge after 3 iterations" in dream.error_message

    @pytest.mark.asyncio
    async def test_iteration_failure_exits_to_partial(self) -> None:
        dream = _make_dream_row()
        r3 = _report_with_contradictions(3)
        patches = _build_loop_patches(
            dream,
            # iter1 check=3 → fix succeeds; iter2 check=3 → fix raises → partial exit
            health_check_sequence=[r3, r3],
            run_health_fix_side_effect=[
                (_loop_fix_output(3), _LOOP_USAGE, 1, ["m1"]),
                ValueError("agent returned malformed json"),
            ],
        )
        mocks = await _run_loop(patches)

        fix_mock = mocks["app.tasks.deep_dream_task.run_health_fix"]
        assert fix_mock.call_count == 2

        telemetry_calls = mocks["app.tasks.deep_dream_task.store_phase_telemetry"].call_args_list
        health_fix_rows = [c for c in telemetry_calls if c.kwargs.get("phase") == "health_fix"]
        assert len(health_fix_rows) == 2

        iter1_row = health_fix_rows[0]
        iter2_row = health_fix_rows[1]
        assert iter1_row.kwargs["status"] == "completed"
        assert iter2_row.kwargs["status"] == "failed"
        assert "malformed" in (iter2_row.kwargs.get("error_message") or "")

        assert dream.status == "partial"

    @pytest.mark.asyncio
    async def test_incomplete_actions_warn_and_partial(self) -> None:
        dream = _make_dream_row()
        r3 = _report_with_contradictions(3)
        clean = HealthReport(total_issues=0)
        patches = _build_loop_patches(
            dream,
            # iter1 check=3 → fix with 1/3 actions → partial marker;
            # iter2 check=0 → break (loop converges but dream remains partial)
            health_check_sequence=[r3, clean],
            run_health_fix_returns=[
                (_loop_fix_output(1), _LOOP_USAGE, 1, ["m1"]),
            ],
        )
        mocks = await _run_loop(patches)

        # Loop continues normally — one fix call, converges on iter 2's check
        fix_mock = mocks["app.tasks.deep_dream_task.run_health_fix"]
        assert fix_mock.call_count == 1

        assert dream.status == "partial"
        assert dream.error_message is not None
        assert "1/3 actions" in dream.error_message


# ---------------------------------------------------------------------------
# Story 11.11: Deterministic frontmatter prepend inside loop
# ---------------------------------------------------------------------------


class TestFixMissingFrontmatter:
    """Story 11.11 — idempotent prepend, folder→type map, note fallback."""

    @pytest.mark.asyncio
    async def test_prepends_default_for_pattern_file(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _fix_missing_frontmatter

        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()
        (patterns_dir / "foo.md").write_text("# Foo\n\nNo frontmatter here.\n", encoding="utf-8")
        today_str = date.today().isoformat()

        fixed = await _fix_missing_frontmatter(tmp_path, ["patterns/foo.md"], today_str)

        assert fixed == 1
        content = (patterns_dir / "foo.md").read_text(encoding="utf-8")
        assert content.startswith("---")
        assert "type: pattern" in content
        assert f"created: {today_str}" in content
        assert f"updated: {today_str}" in content
        assert "# Foo" in content

    @pytest.mark.asyncio
    async def test_prepends_for_project_file(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _fix_missing_frontmatter

        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        (projects_dir / "bar.md").write_text("# Bar project\n", encoding="utf-8")

        await _fix_missing_frontmatter(tmp_path, ["projects/bar.md"], date.today().isoformat())

        content = (projects_dir / "bar.md").read_text(encoding="utf-8")
        assert "type: project" in content

    @pytest.mark.asyncio
    async def test_uses_note_fallback_for_unknown_folder(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _fix_missing_frontmatter

        foobar = tmp_path / "foobar"
        foobar.mkdir()
        (foobar / "baz.md").write_text("# Baz\n", encoding="utf-8")

        await _fix_missing_frontmatter(tmp_path, ["foobar/baz.md"], date.today().isoformat())

        content = (foobar / "baz.md").read_text(encoding="utf-8")
        assert "type: note" in content

    @pytest.mark.asyncio
    async def test_is_idempotent_when_frontmatter_present(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _fix_missing_frontmatter

        existing = (
            "---\n"
            "type: decision\n"
            "status: active\n"
            "tags: [demo]\n"
            "created: 2026-04-01\n"
            "updated: 2026-04-01\n"
            "last_reviewed: 2026-04-01\n"
            "---\n\n"
            "# Already tagged\n"
        )
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        target = decisions_dir / "have-fm.md"
        target.write_text(existing, encoding="utf-8")
        original_bytes = target.read_bytes()

        fixed = await _fix_missing_frontmatter(
            tmp_path, ["decisions/have-fm.md"], date.today().isoformat()
        )

        assert fixed == 0
        assert target.read_bytes() == original_bytes

    @pytest.mark.asyncio
    async def test_is_idempotent_with_leading_whitespace(self, tmp_path: Path) -> None:
        """`lstrip()` guard — files with leading blank line already have frontmatter."""
        from app.services.deep_dream import _fix_missing_frontmatter

        existing = "\n---\ntype: pattern\ncreated: 2026-04-01\nupdated: 2026-04-01\n---\n\n# X\n"
        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()
        target = patterns_dir / "leading-ws.md"
        target.write_text(existing, encoding="utf-8")
        original_bytes = target.read_bytes()

        await _fix_missing_frontmatter(
            tmp_path, ["patterns/leading-ws.md"], date.today().isoformat()
        )

        assert target.read_bytes() == original_bytes

    @pytest.mark.asyncio
    async def test_multiple_files_only_modifies_missing(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _fix_missing_frontmatter

        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()
        (patterns_dir / "missing1.md").write_text("# One\n", encoding="utf-8")
        (patterns_dir / "missing2.md").write_text("# Two\n", encoding="utf-8")
        existing = "---\ntype: pattern\ncreated: 2026-04-01\nupdated: 2026-04-01\n---\n# Three\n"
        (patterns_dir / "has-fm.md").write_text(existing, encoding="utf-8")
        original_has_fm = (patterns_dir / "has-fm.md").read_bytes()

        fixed = await _fix_missing_frontmatter(
            tmp_path,
            ["patterns/missing1.md", "patterns/missing2.md", "patterns/has-fm.md"],
            date.today().isoformat(),
        )

        # Only 2 are actually modified — the third already has frontmatter.
        assert fixed == 2
        assert (patterns_dir / "has-fm.md").read_bytes() == original_has_fm
        assert (patterns_dir / "missing1.md").read_text(encoding="utf-8").startswith("---")
        assert (patterns_dir / "missing2.md").read_text(encoding="utf-8").startswith("---")

    @pytest.mark.asyncio
    async def test_catches_llm_regression(self, tmp_path: Path) -> None:
        """Simulates iteration N+1 after a previous iteration stripped frontmatter."""
        from app.services.deep_dream import _fix_missing_frontmatter

        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()
        # Iteration N: file had frontmatter. LLM rewrote it without frontmatter.
        (patterns_dir / "regressed.md").write_text(
            "# Regressed\n\nLLM stripped frontmatter.\n", encoding="utf-8"
        )

        # Iteration N+1: health check re-flags the file; auto-fix at top of loop
        # restores frontmatter deterministically.
        fixed = await _fix_missing_frontmatter(
            tmp_path, ["patterns/regressed.md"], date.today().isoformat()
        )

        assert fixed == 1
        content = (patterns_dir / "regressed.md").read_text(encoding="utf-8")
        assert content.startswith("---")
        assert "type: pattern" in content
        assert "# Regressed" in content

    @pytest.mark.asyncio
    async def test_skips_missing_file(self, tmp_path: Path) -> None:
        from app.services.deep_dream import _fix_missing_frontmatter

        fixed = await _fix_missing_frontmatter(
            tmp_path, ["decisions/does-not-exist.md"], date.today().isoformat()
        )

        assert fixed == 0
