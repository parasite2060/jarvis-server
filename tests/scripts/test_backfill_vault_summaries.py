"""Story 11.14 — backfill_vault_summaries script tests."""

from pathlib import Path

import pytest

from scripts.backfill_vault_summaries import backfill


@pytest.mark.asyncio
async def test_skips_files_with_existing_summary(tmp_path: Path) -> None:
    decisions = tmp_path / "decisions"
    decisions.mkdir()
    content = (
        '---\ntype: decision\nsummary: "Already there"\n'
        "created: 2026-04-01\n---\n\n# Foo\n\nBody.\n"
    )
    target = decisions / "foo.md"
    target.write_text(content, encoding="utf-8")
    original_bytes = target.read_bytes()

    result = await backfill(vault_root=tmp_path, summary_override="should not be used")

    assert result.scanned == 1
    assert result.skipped == 1
    assert result.updated == 0
    assert target.read_bytes() == original_bytes


@pytest.mark.asyncio
async def test_inserts_summary_on_missing(tmp_path: Path) -> None:
    patterns = tmp_path / "patterns"
    patterns.mkdir()
    (patterns / "foo.md").write_text(
        "---\ntype: pattern\ncreated: 2026-04-01\nupdated: 2026-04-01\n---\n\n"
        "# Foo Pattern\n\nA pattern about foo handling.\n",
        encoding="utf-8",
    )

    result = await backfill(vault_root=tmp_path, summary_override="Mock summary")

    assert result.scanned == 1
    assert result.updated == 1
    assert result.failed == 0
    new_content = (patterns / "foo.md").read_text(encoding="utf-8")
    assert 'summary: "Mock summary"' in new_content
    # Preserves all other frontmatter fields.
    assert "type: pattern" in new_content
    assert "created: 2026-04-01" in new_content
    assert "updated: 2026-04-01" in new_content
    # Body preserved.
    assert "# Foo Pattern" in new_content
    assert "A pattern about foo handling." in new_content


@pytest.mark.asyncio
async def test_idempotent_second_run(tmp_path: Path) -> None:
    projects = tmp_path / "projects"
    projects.mkdir()
    (projects / "foo.md").write_text(
        "---\ntype: project\ncreated: 2026-04-01\n---\n\n# Foo Project\n\nBody.\n",
        encoding="utf-8",
    )

    # First run: adds summary.
    r1 = await backfill(vault_root=tmp_path, summary_override="First pass summary")
    assert r1.updated == 1

    bytes_after_first = (projects / "foo.md").read_bytes()

    # Second run: file now has summary; must skip.
    r2 = await backfill(vault_root=tmp_path, summary_override="Should not overwrite")
    assert r2.updated == 0
    assert r2.skipped == 1
    assert (projects / "foo.md").read_bytes() == bytes_after_first


@pytest.mark.asyncio
async def test_skips_file_without_frontmatter(tmp_path: Path) -> None:
    """Files lacking any frontmatter are out of scope — Story 11.11 owns that."""
    concepts = tmp_path / "concepts"
    concepts.mkdir()
    target = concepts / "raw.md"
    target.write_text("# Just a title\n\nRaw body with no frontmatter.\n", encoding="utf-8")
    original_bytes = target.read_bytes()

    result = await backfill(vault_root=tmp_path, summary_override="Unused")

    assert result.scanned == 1
    assert result.skipped == 1
    assert result.updated == 0
    assert target.read_bytes() == original_bytes


@pytest.mark.asyncio
async def test_skips_index_files(tmp_path: Path) -> None:
    decisions = tmp_path / "decisions"
    decisions.mkdir()
    (decisions / "_index.md").write_text(
        "---\ntype: index\ncreated: 2026-04-01\n---\n\n# Decisions Index\n",
        encoding="utf-8",
    )
    original_bytes = (decisions / "_index.md").read_bytes()

    result = await backfill(vault_root=tmp_path, summary_override="Unused")

    # _index.md is neither scanned nor touched.
    assert result.scanned == 0
    assert (decisions / "_index.md").read_bytes() == original_bytes


@pytest.mark.asyncio
async def test_scans_multiple_folders(tmp_path: Path) -> None:
    for folder in ("decisions", "patterns", "projects"):
        d = tmp_path / folder
        d.mkdir()
        (d / "one.md").write_text(
            f"---\ntype: {folder.rstrip('s')}\ncreated: 2026-04-01\n---\n\n"
            f"# {folder.title()} One\n\nBody.\n",
            encoding="utf-8",
        )

    result = await backfill(vault_root=tmp_path, summary_override="Auto")

    assert result.scanned == 3
    assert result.updated == 3
    # All three now have the summary.
    for folder in ("decisions", "patterns", "projects"):
        content = (tmp_path / folder / "one.md").read_text(encoding="utf-8")
        assert 'summary: "Auto"' in content
