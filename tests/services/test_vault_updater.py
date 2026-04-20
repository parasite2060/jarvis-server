from datetime import date
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.vault_updater import (
    FOLDER_TYPE_MAP,
    VAULT_FOLDERS,
    build_frontmatter,
    extract_created_date,
    regenerate_index,
    update_file_manifest,
    update_vault_folders,
    write_vault_folder_file,
)

SOURCE_DATE = date(2026, 3, 31)


class TestBuildFrontmatter:
    def test_generates_correct_yaml_block(self) -> None:
        result = build_frontmatter("decision", ["arch", "backend"], date(2026, 3, 29), SOURCE_DATE)
        assert "type: decision" in result
        assert "tags: [arch, backend]" in result
        assert "created: 2026-03-29" in result
        assert "updated: 2026-03-31" in result
        assert "last_reviewed: 2026-03-31" in result
        assert result.startswith("---\n")
        assert result.endswith("---\n")

    def test_all_folder_types(self) -> None:
        for folder, file_type in FOLDER_TYPE_MAP.items():
            result = build_frontmatter(file_type, [folder], SOURCE_DATE, SOURCE_DATE)
            assert f"type: {file_type}" in result

    def test_empty_tags(self) -> None:
        result = build_frontmatter("decision", [], SOURCE_DATE, SOURCE_DATE)
        assert "tags: []" in result

    def test_last_reviewed_equals_updated(self) -> None:
        result = build_frontmatter("pattern", ["coding"], date(2026, 1, 1), SOURCE_DATE)
        assert "last_reviewed: 2026-03-31" in result
        assert "updated: 2026-03-31" in result


class TestExtractCreatedDate:
    def test_extracts_date_from_frontmatter(self) -> None:
        content = "---\ntype: decision\ncreated: 2026-03-29\nupdated: 2026-03-31\n---\n"
        assert extract_created_date(content) == "2026-03-29"

    def test_returns_none_when_no_date(self) -> None:
        assert extract_created_date("# No frontmatter here") is None


class TestWriteVaultFolderFile:
    @pytest.mark.asyncio
    async def test_creates_new_file_with_frontmatter(self) -> None:
        entry: dict[str, Any] = {
            "filename": "arch-choices.md",
            "title": "Architecture Choices",
            "summary": "Clean Arch decisions",
            "content": (
                "# Architecture Choices\n\n## Clean Architecture\n\nChose Clean Arch because..."
            ),
            "tags": ["architecture"],
            "action": "create",
        }
        mock_write = AsyncMock()
        mock_read = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", mock_read),
        ):
            result = await write_vault_folder_file("decisions", entry, SOURCE_DATE)

        assert result == {"path": "decisions/arch-choices.md", "action": "create"}
        written_content: str = mock_write.call_args[0][1]
        assert "type: decision" in written_content
        assert "created: 2026-03-31" in written_content
        assert "# Architecture Choices" in written_content

    @pytest.mark.asyncio
    async def test_update_preserves_original_created_date(self) -> None:
        existing = (
            "---\ntype: decision\ntags: [arch]\ncreated: 2026-03-20\n"
            "updated: 2026-03-25\nlast_reviewed: 2026-03-25\n---\n\n# Old Content"
        )
        entry: dict[str, Any] = {
            "filename": "arch-choices.md",
            "title": "Architecture Choices",
            "summary": "Updated decisions",
            "content": "# Architecture Choices\n\nUpdated content here",
            "tags": ["architecture"],
            "action": "update",
        }
        mock_write = AsyncMock()
        mock_read = AsyncMock(return_value=existing)

        with (
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", mock_read),
        ):
            result = await write_vault_folder_file("decisions", entry, SOURCE_DATE)

        assert result == {"path": "decisions/arch-choices.md", "action": "update"}
        written_content: str = mock_write.call_args[0][1]
        assert "created: 2026-03-20" in written_content
        assert "updated: 2026-03-31" in written_content

    @pytest.mark.asyncio
    async def test_update_missing_file_falls_back_to_create(self) -> None:
        entry: dict[str, Any] = {
            "filename": "missing.md",
            "title": "Missing File",
            "summary": "Was supposed to exist",
            "content": "# Missing File\n\nContent",
            "tags": [],
            "action": "update",
        }
        mock_write = AsyncMock()
        mock_read = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", mock_read),
        ):
            result = await write_vault_folder_file("patterns", entry, SOURCE_DATE)

        assert result["action"] == "create"
        written_content: str = mock_write.call_args[0][1]
        assert "created: 2026-03-31" in written_content


class TestRegenerateIndex:
    @pytest.mark.asyncio
    async def test_scans_folder_and_builds_index(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        arch_content = (
            "---\ntype: decision\ncreated: 2026-03-29\n---\n\n"
            "# Architecture Choices\n\nSome content"
        )
        (decisions_dir / "arch-choices.md").write_text(arch_content, encoding="utf-8")
        tool_content = (
            "---\ntype: decision\ncreated: 2026-03-30\n---\n\n"
            "# Tool Selections\n\nFastAPI and PostgreSQL"
        )
        (decisions_dir / "tool-selections.md").write_text(tool_content, encoding="utf-8")
        (decisions_dir / "_index.md").write_text(
            "---\ntype: index\ncreated: 2026-03-29\n---\n\n# Decisions Index\n",
            encoding="utf-8",
        )

        mock_write = AsyncMock()

        async def fake_read(path: str) -> str | None:
            full = tmp_path / path
            if full.exists():
                return full.read_text(encoding="utf-8")
            return None

        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            result = await regenerate_index("decisions", SOURCE_DATE)

        assert result == {"path": "decisions/_index.md", "action": "rewrite"}
        written: str = mock_write.call_args[0][1]
        assert "# Decisions Index" in written
        assert "[Architecture Choices](arch-choices.md)" in written
        assert "[Tool Selections](tool-selections.md)" in written
        assert "type: index" in written
        assert "created: 2026-03-29" in written

    @pytest.mark.asyncio
    async def test_excludes_index_from_entries(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        (decisions_dir / "_index.md").write_text("# Index", encoding="utf-8")
        (decisions_dir / "one.md").write_text("# One Entry\n\nContent", encoding="utf-8")

        mock_write = AsyncMock()

        async def fake_read(path: str) -> str | None:
            full = tmp_path / path
            if full.exists():
                return full.read_text(encoding="utf-8")
            return None

        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            await regenerate_index("decisions", SOURCE_DATE)

        written: str = mock_write.call_args[0][1]
        assert "_index.md" not in written.split("# Decisions Index")[1]

    @pytest.mark.asyncio
    async def test_handles_empty_folder(self, tmp_path: Path) -> None:
        empty_dir = tmp_path / "templates"
        empty_dir.mkdir()

        mock_write = AsyncMock()

        async def fake_read(path: str) -> str | None:
            full = tmp_path / path
            if full.exists():
                return full.read_text(encoding="utf-8")
            return None

        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            result = await regenerate_index("templates", SOURCE_DATE)

        assert result == {"path": "templates/_index.md", "action": "rewrite"}
        written: str = mock_write.call_args[0][1]
        assert "# Templates Index" in written
        assert "- [" not in written


class TestUpdateVaultFolders:
    @pytest.mark.asyncio
    async def test_processes_all_four_folders(self) -> None:
        vault_updates: dict[str, list[dict[str, Any]]] = {
            "decisions": [
                {
                    "filename": "d.md",
                    "title": "D",
                    "summary": "Sum",
                    "content": "# D\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
            "projects": [
                {
                    "filename": "p.md",
                    "title": "P",
                    "summary": "Sum",
                    "content": "# P\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
            "patterns": [
                {
                    "filename": "pat.md",
                    "title": "Pat",
                    "summary": "Sum",
                    "content": "# Pat\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
            "templates": [
                {
                    "filename": "t.md",
                    "title": "T",
                    "summary": "Sum",
                    "content": "# T\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
        }

        mock_write_file = AsyncMock(
            side_effect=lambda f, e, d: {"path": f"{f}/{e['filename']}", "action": "create"}
        )
        mock_regen = AsyncMock(
            side_effect=lambda f, d, summaries=None: {"path": f"{f}/_index.md", "action": "rewrite"}
        )

        with (
            patch("app.services.vault_updater.write_vault_folder_file", mock_write_file),
            patch("app.services.vault_updater.regenerate_index", mock_regen),
        ):
            results = await update_vault_folders(vault_updates, SOURCE_DATE)

        assert len(results) == 8  # 4 files + 4 indexes
        paths = [r["path"] for r in results]
        assert "decisions/d.md" in paths
        assert "projects/p.md" in paths
        assert "patterns/pat.md" in paths
        assert "templates/t.md" in paths
        assert "decisions/_index.md" in paths

    @pytest.mark.asyncio
    async def test_handles_partial_failure(self) -> None:
        vault_updates: dict[str, list[dict[str, Any]]] = {
            "decisions": [
                {
                    "filename": "fail.md",
                    "title": "Fail",
                    "summary": "Will fail",
                    "content": "# Fail",
                    "tags": [],
                    "action": "create",
                },
                {
                    "filename": "ok.md",
                    "title": "OK",
                    "summary": "Will succeed",
                    "content": "# OK",
                    "tags": [],
                    "action": "create",
                },
            ],
            "projects": [],
            "patterns": [],
            "templates": [],
        }

        call_count = 0

        async def mock_write(f: str, e: dict[str, Any], d: date) -> dict[str, str]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                msg = "disk error"
                raise RuntimeError(msg)
            return {"path": f"{f}/{e['filename']}", "action": "create"}

        mock_regen = AsyncMock(return_value={"path": "decisions/_index.md", "action": "rewrite"})

        with (
            patch("app.services.vault_updater.write_vault_folder_file", mock_write),
            patch("app.services.vault_updater.regenerate_index", mock_regen),
        ):
            results = await update_vault_folders(vault_updates, SOURCE_DATE)

        assert len(results) == 2  # 1 succeeded file + 1 index
        paths = [r["path"] for r in results]
        assert "decisions/ok.md" in paths
        assert "decisions/_index.md" in paths

    @pytest.mark.asyncio
    async def test_skips_empty_folders(self) -> None:
        vault_updates: dict[str, list[dict[str, Any]]] = {
            "decisions": [],
            "projects": [],
            "patterns": [],
            "templates": [],
        }

        mock_write_file = AsyncMock()
        mock_regen = AsyncMock()

        with (
            patch("app.services.vault_updater.write_vault_folder_file", mock_write_file),
            patch("app.services.vault_updater.regenerate_index", mock_regen),
        ):
            results = await update_vault_folders(vault_updates, SOURCE_DATE)

        assert results == []
        mock_write_file.assert_not_called()
        mock_regen.assert_not_called()


class TestUpdateFileManifest:
    @pytest.mark.asyncio
    async def test_upserts_file_hashes(self) -> None:
        files_modified = [
            {"path": "decisions/arch.md", "action": "create"},
            {"path": "decisions/_index.md", "action": "rewrite"},
        ]

        mock_read = AsyncMock(return_value="# Content here")
        mock_scalar = MagicMock()
        mock_scalar.scalar_one_or_none.return_value = None

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_scalar)
        mock_session.commit = AsyncMock()
        mock_session.add = MagicMock()

        mock_factory = MagicMock()
        mock_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_factory.return_value.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.read_vault_file", mock_read),
            patch("app.services.vault_updater.async_session_factory", mock_factory),
        ):
            await update_file_manifest(files_modified)

        assert mock_session.add.call_count == 2
        mock_session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_handles_db_errors_gracefully(self) -> None:
        files_modified = [{"path": "decisions/arch.md", "action": "create"}]

        mock_read = AsyncMock(return_value="# Content")
        mock_factory = MagicMock()
        mock_factory.return_value.__aenter__ = AsyncMock(
            side_effect=RuntimeError("DB connection failed")
        )
        mock_factory.return_value.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.read_vault_file", mock_read),
            patch("app.services.vault_updater.async_session_factory", mock_factory),
        ):
            await update_file_manifest(files_modified)


class TestVaultFoldersIncludeNewTypes:
    def test_vault_folders_includes_new_types(self) -> None:
        expected_new = {"concepts", "connections", "lessons", "references"}
        assert expected_new.issubset(set(VAULT_FOLDERS))

    def test_vault_folders_includes_original_types(self) -> None:
        expected_original = {"decisions", "projects", "patterns", "templates"}
        assert expected_original.issubset(set(VAULT_FOLDERS))

    def test_folder_type_map_covers_all_vault_folders(self) -> None:
        for folder in VAULT_FOLDERS:
            assert folder in FOLDER_TYPE_MAP, f"{folder} missing from FOLDER_TYPE_MAP"

    def test_folder_type_map_new_entries(self) -> None:
        assert FOLDER_TYPE_MAP["concepts"] == "concept"
        assert FOLDER_TYPE_MAP["connections"] == "connection"
        assert FOLDER_TYPE_MAP["lessons"] == "lesson"
        assert FOLDER_TYPE_MAP["references"] == "reference"


class TestWriteVaultFolderFileNewTypes:
    @pytest.mark.asyncio
    async def test_creates_concept_file(self) -> None:
        entry: dict[str, Any] = {
            "filename": "clean-arch.md",
            "title": "Clean Architecture",
            "summary": "Core concept",
            "content": "# Clean Architecture\n\n## What It Is\n\nSeparation of concerns...",
            "tags": ["architecture"],
            "action": "create",
        }
        mock_write = AsyncMock()
        mock_read = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", mock_read),
        ):
            result = await write_vault_folder_file("concepts", entry, SOURCE_DATE)

        assert result == {"path": "concepts/clean-arch.md", "action": "create"}
        written_content: str = mock_write.call_args[0][1]
        assert "type: concept" in written_content

    @pytest.mark.asyncio
    async def test_creates_connection_file(self) -> None:
        entry: dict[str, Any] = {
            "filename": "firmware-backend.md",
            "title": "Firmware to Backend",
            "summary": "Cross-domain mapping",
            "content": "# Firmware to Backend\n\n## Relationship\n\nBoth use...",
            "tags": ["cross-domain"],
            "action": "create",
        }
        mock_write = AsyncMock()
        mock_read = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", mock_read),
        ):
            result = await write_vault_folder_file("connections", entry, SOURCE_DATE)

        assert result == {"path": "connections/firmware-backend.md", "action": "create"}
        written_content: str = mock_write.call_args[0][1]
        assert "type: connection" in written_content

    @pytest.mark.asyncio
    async def test_creates_lesson_file(self) -> None:
        entry: dict[str, Any] = {
            "filename": "mock-db-failure.md",
            "title": "Mock DB Migration Failure",
            "summary": "DB mocks hid migration bug",
            "content": "# Mock DB Migration Failure\n\n## Lesson\n\nUse real DB...",
            "tags": ["testing"],
            "action": "create",
        }
        mock_write = AsyncMock()
        mock_read = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", mock_read),
        ):
            result = await write_vault_folder_file("lessons", entry, SOURCE_DATE)

        assert result == {"path": "lessons/mock-db-failure.md", "action": "create"}
        written_content: str = mock_write.call_args[0][1]
        assert "type: lesson" in written_content

    @pytest.mark.asyncio
    async def test_creates_reference_file(self) -> None:
        entry: dict[str, Any] = {
            "filename": "nestjs-coding-style.md",
            "title": "NestJS Coding Style",
            "summary": "Coding conventions",
            "content": "# NestJS Coding Style\n\nPascalCase classes...",
            "tags": ["standards"],
            "action": "create",
        }
        mock_write = AsyncMock()
        mock_read = AsyncMock(return_value=None)

        with (
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", mock_read),
        ):
            result = await write_vault_folder_file("references", entry, SOURCE_DATE)

        assert result == {"path": "references/nestjs-coding-style.md", "action": "create"}
        written_content: str = mock_write.call_args[0][1]
        assert "type: reference" in written_content


class TestUpdateVaultFoldersNewTypes:
    @pytest.mark.asyncio
    async def test_processes_new_folder_types(self) -> None:
        vault_updates: dict[str, list[dict[str, Any]]] = {
            "concepts": [
                {
                    "filename": "c.md",
                    "title": "C",
                    "summary": "Sum",
                    "content": "# C\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
            "connections": [
                {
                    "filename": "conn.md",
                    "title": "Conn",
                    "summary": "Sum",
                    "content": "# Conn\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
            "lessons": [
                {
                    "filename": "l.md",
                    "title": "L",
                    "summary": "Sum",
                    "content": "# L\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
            "references": [
                {
                    "filename": "r.md",
                    "title": "R",
                    "summary": "Sum",
                    "content": "# R\n\nContent",
                    "tags": [],
                    "action": "create",
                }
            ],
        }

        mock_write_file = AsyncMock(
            side_effect=lambda f, e, d: {"path": f"{f}/{e['filename']}", "action": "create"}
        )
        mock_regen = AsyncMock(
            side_effect=lambda f, d, summaries=None: {
                "path": f"{f}/_index.md",
                "action": "rewrite",
            }
        )

        with (
            patch("app.services.vault_updater.write_vault_folder_file", mock_write_file),
            patch("app.services.vault_updater.regenerate_index", mock_regen),
        ):
            results = await update_vault_folders(vault_updates, SOURCE_DATE)

        assert len(results) == 8  # 4 files + 4 indexes
        paths = [r["path"] for r in results]
        assert "concepts/c.md" in paths
        assert "connections/conn.md" in paths
        assert "lessons/l.md" in paths
        assert "references/r.md" in paths
        assert "concepts/_index.md" in paths
        assert "connections/_index.md" in paths
        assert "lessons/_index.md" in paths
        assert "references/_index.md" in paths


# ---------------------------------------------------------------------------
# Story 11.14: Persist vault summary in frontmatter
# ---------------------------------------------------------------------------


class TestExtractFrontmatterSummary:
    """Story 11.14 AC7 — parse `summary:` from frontmatter, quoted or unquoted."""

    def test_handles_double_quoted(self) -> None:
        from app.services.vault_updater import _extract_frontmatter_summary

        content = (
            '---\ntype: decision\nsummary: "Double quoted value"\n'
            "created: 2026-04-01\n---\n\n# Title\n"
        )
        assert _extract_frontmatter_summary(content) == "Double quoted value"

    def test_handles_single_quoted(self) -> None:
        from app.services.vault_updater import _extract_frontmatter_summary

        content = "---\ntype: decision\nsummary: 'Single quoted value'\n---\n\n# Title\n"
        assert _extract_frontmatter_summary(content) == "Single quoted value"

    def test_handles_unquoted(self) -> None:
        from app.services.vault_updater import _extract_frontmatter_summary

        content = "---\ntype: decision\nsummary: Unquoted value here\n---\n\n# Title\n"
        assert _extract_frontmatter_summary(content) == "Unquoted value here"

    def test_returns_none_on_no_frontmatter(self) -> None:
        from app.services.vault_updater import _extract_frontmatter_summary

        assert _extract_frontmatter_summary("# Title\n\nBody text.\n") is None

    def test_returns_none_on_frontmatter_without_summary(self) -> None:
        from app.services.vault_updater import _extract_frontmatter_summary

        content = "---\ntype: decision\ncreated: 2026-04-01\n---\n\n# Title\n"
        assert _extract_frontmatter_summary(content) is None

    def test_unescapes_quotes_in_double_quoted(self) -> None:
        from app.services.vault_updater import _extract_frontmatter_summary

        content = '---\nsummary: "He said \\"hi\\" there"\n---\n'
        assert _extract_frontmatter_summary(content) == 'He said "hi" there'


class TestExtractFirstSentenceHardened:
    """Story 11.14 AC9 — fallback must skip `## Decision`/`## What It Is` subheadings."""

    def test_skips_subheading_returns_prose(self) -> None:
        from app.services.vault_updater import _extract_first_sentence

        content = "# Title\n\n## Decision\nReal sentence here.\n"
        assert _extract_first_sentence(content) == "Real sentence here."

    def test_skips_multiple_subheadings(self) -> None:
        from app.services.vault_updater import _extract_first_sentence

        content = "# Title\n\n## Decision\n\n## Context\nFinal prose line.\n"
        assert _extract_first_sentence(content) == "Final prose line."

    def test_returns_empty_when_only_subheadings(self) -> None:
        """Pins the exact Dream 60 regression — must never return `## Decision`."""
        from app.services.vault_updater import _extract_first_sentence

        content = "# Title\n\n## Decision\n"
        assert _extract_first_sentence(content) == ""

    def test_returns_empty_on_bare_title(self) -> None:
        from app.services.vault_updater import _extract_first_sentence

        assert _extract_first_sentence("# Only a title\n") == ""

    def test_truncates_long_sentence(self) -> None:
        from app.services.vault_updater import _extract_first_sentence

        long_prose = "A" * 200
        content = f"# Title\n\n{long_prose}\n"
        result = _extract_first_sentence(content)
        assert len(result) == 100
        assert result.endswith("...")


class TestBuildFrontmatterSummary:
    """Story 11.14 AC3 — optional `summary` kwarg, omitted when empty."""

    def test_includes_summary_when_non_empty(self) -> None:
        fm = build_frontmatter(
            file_type="decision",
            tags=["auth"],
            created=date(2026, 4, 1),
            updated=date(2026, 4, 1),
            summary="Chose Supabase Auth because JWT claims support RLS",
        )
        assert 'summary: "Chose Supabase Auth because JWT claims support RLS"' in fm

    def test_omits_summary_when_empty(self) -> None:
        fm = build_frontmatter(
            file_type="decision",
            tags=[],
            created=date(2026, 4, 1),
            updated=date(2026, 4, 1),
        )
        assert "summary:" not in fm

    def test_escapes_internal_quote(self) -> None:
        fm = build_frontmatter(
            file_type="pattern",
            tags=[],
            created=date(2026, 4, 1),
            updated=date(2026, 4, 1),
            summary='Use "server-side" auth pattern',
        )
        assert 'summary: "Use \\"server-side\\" auth pattern"' in fm


class TestRegenerateIndexSummaryPrecedence:
    """Story 11.14 AC8 — this-dream dict → frontmatter `summary:` → first-sentence fallback."""

    async def _make_mocks(self, tmp_path: Path) -> tuple[AsyncMock, Any]:
        mock_write = AsyncMock()

        async def fake_read(path: str) -> str | None:
            full = tmp_path / path
            if full.exists():
                return full.read_text(encoding="utf-8")
            return None

        return mock_write, fake_read

    @pytest.mark.asyncio
    async def test_prefers_this_dream_summary(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        (decisions_dir / "foo.md").write_text(
            '---\ntype: decision\nsummary: "Frontmatter summary"\n'
            "created: 2026-04-01\n---\n\n# Foo\n\nBody prose.\n",
            encoding="utf-8",
        )

        mock_write, fake_read = await self._make_mocks(tmp_path)
        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            await regenerate_index(
                "decisions", SOURCE_DATE, summaries={"foo.md": "This-dream summary"}
            )

        written = mock_write.call_args[0][1]
        assert "This-dream summary" in written
        assert "Frontmatter summary" not in written

    @pytest.mark.asyncio
    async def test_uses_frontmatter_summary_when_dict_absent(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        (decisions_dir / "foo.md").write_text(
            '---\ntype: decision\nsummary: "Persisted summary"\n'
            "created: 2026-04-01\n---\n\n# Foo\n\nBody prose.\n",
            encoding="utf-8",
        )

        mock_write, fake_read = await self._make_mocks(tmp_path)
        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            await regenerate_index("decisions", SOURCE_DATE, summaries={})

        written = mock_write.call_args[0][1]
        assert "Persisted summary" in written

    @pytest.mark.asyncio
    async def test_falls_back_to_first_sentence(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        (decisions_dir / "foo.md").write_text(
            "---\ntype: decision\ncreated: 2026-04-01\n---\n\n# Foo\n\nLegacy prose sentence.\n",
            encoding="utf-8",
        )

        mock_write, fake_read = await self._make_mocks(tmp_path)
        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            await regenerate_index("decisions", SOURCE_DATE, summaries={})

        written = mock_write.call_args[0][1]
        assert "Legacy prose sentence." in written

    @pytest.mark.asyncio
    async def test_fallback_skips_subheading(self, tmp_path: Path) -> None:
        """Pins the exact Dream 60 bug — `## Decision` must NOT leak into the index."""
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        (decisions_dir / "foo.md").write_text(
            "---\ntype: decision\ncreated: 2026-04-01\n---\n\n"
            "# Foo\n\n## Decision\nReal sentence here.\n",
            encoding="utf-8",
        )

        mock_write, fake_read = await self._make_mocks(tmp_path)
        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            await regenerate_index("decisions", SOURCE_DATE, summaries={})

        written = mock_write.call_args[0][1]
        assert "Real sentence here." in written
        assert "## Decision" not in written.split("\n", 1)[1]  # not in index entry line

    @pytest.mark.asyncio
    async def test_fallback_empty_on_bare_subheading(self, tmp_path: Path) -> None:
        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        (decisions_dir / "foo.md").write_text(
            "---\ntype: decision\ncreated: 2026-04-01\n---\n\n# Foo\n\n## Decision\n",
            encoding="utf-8",
        )

        mock_write, fake_read = await self._make_mocks(tmp_path)
        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", mock_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            await regenerate_index("decisions", SOURCE_DATE, summaries={})

        written = mock_write.call_args[0][1]
        # Entry should exist but with no "-- summary" suffix (bare subheading → empty).
        assert "- [Foo](foo.md)\n" in written
        assert "- [Foo](foo.md) --" not in written


class TestWriteVaultFolderFileSummary:
    """Story 11.14 AC4/AC5 — writer persists summary; preserves existing on update."""

    @pytest.mark.asyncio
    async def test_persists_summary_on_create(self, tmp_path: Path) -> None:
        writes: list[tuple[str, str]] = []

        async def fake_write(path: str, content: str) -> None:
            writes.append((path, content))

        async def fake_read(path: str) -> str | None:
            return None  # Create path — no existing file.

        with (
            patch("app.services.vault_updater.write_vault_file", side_effect=fake_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            await write_vault_folder_file(
                "decisions",
                {
                    "filename": "foo.md",
                    "title": "Foo",
                    "summary": "Test summary",
                    "content": "# Foo\n\nBody.",
                    "tags": ["test"],
                    "action": "create",
                },
                SOURCE_DATE,
            )

        assert len(writes) == 1
        _, content = writes[0]
        assert 'summary: "Test summary"' in content

    @pytest.mark.asyncio
    async def test_preserves_existing_summary_on_update_without_summary(
        self, tmp_path: Path
    ) -> None:
        writes: list[tuple[str, str]] = []
        existing_content = (
            '---\ntype: decision\nsummary: "Preserved summary"\ncreated: 2026-04-01\n---\n\n# Foo\n'
        )

        async def fake_write(path: str, content: str) -> None:
            writes.append((path, content))

        async def fake_read(path: str) -> str | None:
            return existing_content

        with (
            patch("app.services.vault_updater.write_vault_file", side_effect=fake_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            await write_vault_folder_file(
                "decisions",
                {
                    "filename": "foo.md",
                    "title": "Foo",
                    "content": "# Foo\n\nUpdated body.",
                    "tags": [],
                    "action": "update",
                    # No summary supplied — must preserve existing.
                },
                SOURCE_DATE,
            )

        assert len(writes) == 1
        _, content = writes[0]
        assert 'summary: "Preserved summary"' in content

    @pytest.mark.asyncio
    async def test_incoming_summary_overrides_existing_on_update(self, tmp_path: Path) -> None:
        writes: list[tuple[str, str]] = []
        existing_content = (
            '---\ntype: decision\nsummary: "Old"\ncreated: 2026-04-01\n---\n\n# Foo\n'
        )

        async def fake_write(path: str, content: str) -> None:
            writes.append((path, content))

        async def fake_read(path: str) -> str | None:
            return existing_content

        with (
            patch("app.services.vault_updater.write_vault_file", side_effect=fake_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            await write_vault_folder_file(
                "decisions",
                {
                    "filename": "foo.md",
                    "title": "Foo",
                    "summary": "New summary",
                    "content": "# Foo\n\nUpdated.",
                    "tags": [],
                    "action": "update",
                },
                SOURCE_DATE,
            )

        _, content = writes[0]
        assert 'summary: "New summary"' in content
        assert 'summary: "Old"' not in content


class TestPartialFolderTouchPreservesUntouchedSummaries:
    """Story 11.14 AC16 integration — the exact Dream 60 regression pinned.

    Seed 3 files with persisted summaries; run update_vault_folders touching
    only file #1 with a new summary; assert index shows new_1 for file #1 and
    the persisted summaries (seed_2, seed_3) for the other two — NOT regressed
    to `## Decision` style fallbacks.
    """

    @pytest.mark.asyncio
    async def test_preserves_untouched_summaries(self, tmp_path: Path) -> None:
        from app.services.vault_updater import update_vault_folders

        decisions_dir = tmp_path / "decisions"
        decisions_dir.mkdir()
        for i, name in enumerate(["foo.md", "bar.md", "baz.md"], start=1):
            (decisions_dir / name).write_text(
                f'---\ntype: decision\nsummary: "seed_{i}"\n'
                f"created: 2026-04-01\n---\n\n# {name.removesuffix('.md').title()}\n\n"
                "## Decision\nProse.\n",
                encoding="utf-8",
            )

        async def fake_read(path: str) -> str | None:
            full = tmp_path / path
            if full.exists():
                return full.read_text(encoding="utf-8")
            return None

        async def fake_write(path: str, content: str) -> None:
            full = tmp_path / path
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(content, encoding="utf-8")

        vault_updates: dict[str, list[dict[str, Any]]] = {
            "decisions": [
                {
                    "filename": "foo.md",
                    "title": "Foo",
                    "summary": "new_1",
                    "content": "# Foo\n\n## Decision\nNew body.\n",
                    "tags": [],
                    "action": "update",
                }
            ]
        }

        with (
            patch("app.services.vault_updater.settings") as mock_settings,
            patch("app.services.vault_updater.write_vault_file", side_effect=fake_write),
            patch("app.services.vault_updater.read_vault_file", side_effect=fake_read),
        ):
            mock_settings.ai_memory_repo_path = str(tmp_path)
            await update_vault_folders(vault_updates, SOURCE_DATE)

        index_content = (tmp_path / "decisions" / "_index.md").read_text(encoding="utf-8")
        # Foo got new summary; Bar and Baz kept their persisted seeds.
        assert "-- new_1" in index_content
        assert "-- seed_2" in index_content
        assert "-- seed_3" in index_content
        # Critical: no `## Decision` leakage (Dream 60 bug).
        assert "-- ## Decision" not in index_content
