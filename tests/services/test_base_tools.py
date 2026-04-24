"""Tests for Story 9.24: Standardized Base Tools.

Tests _register_base_tools, path traversal blocking, and tool registration
for all 6 agents.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.dream_agent import (
    DreamDeps,
    _register_base_tools,
    _resolve_vault_path,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BASE_TOOL_NAMES = {
    "read_file",
    "grep",
    "list_files",
    "file_info",
    "read_frontmatter",
    "memu_search",
    "memu_categories",
}

def _tool_names(agent: Any) -> set[str]:
    return {t.name for t in agent._function_toolset.tools.values()}


def _get_tool(agent: Any, name: str) -> Any:
    for t in agent._function_toolset.tools.values():
        if t.name == name:
            return t
    raise KeyError(f"Tool {name!r} not found")


@pytest.fixture
def vault_dir(tmp_path: Path) -> Path:
    """Create a temporary vault directory with test files."""
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "MEMORY.md").write_text("# Memory\n- test entry\n", encoding="utf-8")
    (vault / "dailys").mkdir()
    (vault / "dailys" / "2026-04-15.md").write_text(
        "# Daily Log: 2026-04-15\n## Sessions\n", encoding="utf-8"
    )
    (vault / "decisions").mkdir()
    (vault / "decisions" / "use-python.md").write_text(
        "---\ntitle: Use Python\nreinforcement_count: 2\n---\n# Use Python\n",
        encoding="utf-8",
    )
    (vault / "concepts").mkdir()
    (vault / "concepts" / "clean-arch.md").write_text(
        "---\ntitle: Clean Architecture\nstatus: active\n---\n"
        "# Clean Architecture\nContent here.\n",
        encoding="utf-8",
    )
    (vault / "no-frontmatter.md").write_text(
        "# No Frontmatter\nJust text.\n", encoding="utf-8"
    )
    (vault / "bad-frontmatter.md").write_text(
        "---\ntitle: broken\nno end marker\n", encoding="utf-8"
    )
    return vault


@pytest.fixture
def dream_deps(tmp_path: Path) -> DreamDeps:
    transcript = tmp_path / "transcript.txt"
    transcript.write_text(
        "User: hello\n\nAssistant: hi there\n\nUser: how are you?\n\n"
        "Assistant: I'm good\n\nUser: let's work on the project\n",
        encoding="utf-8",
    )
    return DreamDeps(
        transcript_id=1,
        workspace=tmp_path,
        session_id="test-session",
        project="test-project",
        token_count=100,
        created_at=datetime(2026, 4, 15, 10, 0, 0),
    )


# ---------------------------------------------------------------------------
# Path traversal tests
# ---------------------------------------------------------------------------


class TestPathTraversal:
    def test_path_traversal_blocked(self, vault_dir: Path) -> None:
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = _resolve_vault_path("../../etc/passwd")
            assert result is None

    def test_path_traversal_dot_dot_slash(self, vault_dir: Path) -> None:
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = _resolve_vault_path("../../../etc/shadow")
            assert result is None

    def test_valid_path_resolves(self, vault_dir: Path) -> None:
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = _resolve_vault_path("MEMORY.md")
            assert result is not None
            assert result.is_file()

    def test_nested_valid_path_resolves(self, vault_dir: Path) -> None:
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = _resolve_vault_path("decisions/use-python.md")
            assert result is not None
            assert result.is_file()


# ---------------------------------------------------------------------------
# _register_base_tools tests
# ---------------------------------------------------------------------------


class TestRegisterBaseTools:
    def test_registers_all_7_tools(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        _register_base_tools(agent)
        registered = _tool_names(agent)
        assert BASE_TOOL_NAMES.issubset(registered)

    @pytest.mark.asyncio
    async def test_read_file_full_content(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "read_file")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="MEMORY.md")
        assert "# Memory" in result
        assert "test entry" in result

    @pytest.mark.asyncio
    async def test_read_file_with_offset_limit(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "read_file")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="MEMORY.md", offset=0, limit=1)
        assert "lines 1-1" in result
        assert "# Memory" in result

    @pytest.mark.asyncio
    async def test_read_file_not_found(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "read_file")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="nonexistent.md")
        assert "File not found" in result

    @pytest.mark.asyncio
    async def test_read_file_path_traversal_blocked(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "read_file")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="../../etc/passwd")
        assert "File not found" in result

    @pytest.mark.asyncio
    async def test_grep_finds_matches(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "grep")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, pattern="Memory")
        assert "MEMORY.md" in result

    @pytest.mark.asyncio
    async def test_grep_recursive(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "grep")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, pattern="Python")
        assert "decisions/use-python.md" in result.replace("\\", "/")

    @pytest.mark.asyncio
    async def test_grep_invalid_regex(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "grep")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, pattern="[invalid")
        assert "Invalid regex" in result

    @pytest.mark.asyncio
    async def test_list_files(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "list_files")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx)
        assert "MEMORY.md" in result
        assert "decisions/" in result

    @pytest.mark.asyncio
    async def test_list_files_not_directory(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "list_files")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="MEMORY.md")
        assert "Not a directory" in result

    @pytest.mark.asyncio
    async def test_file_info(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "file_info")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="MEMORY.md")
        assert "lines=" in result
        assert "chars=" in result
        assert "estimated_tokens=" in result

    @pytest.mark.asyncio
    async def test_read_frontmatter(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "read_frontmatter")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="concepts/clean-arch.md")
        assert "title: Clean Architecture" in result
        assert "status: active" in result
        assert "# Clean Architecture" not in result  # body excluded

    @pytest.mark.asyncio
    async def test_read_frontmatter_no_frontmatter(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "read_frontmatter")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="no-frontmatter.md")
        assert "No frontmatter" in result

    @pytest.mark.asyncio
    async def test_read_frontmatter_malformed(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            _register_base_tools(agent)

        tool = _get_tool(agent, "read_frontmatter")
        ctx = MagicMock()
        with patch("app.services.dream_agent.settings") as mock_settings:
            mock_settings.jarvis_memory_path = str(vault_dir)
            result = await tool.function(ctx, path="bad-frontmatter.md")
        assert "Malformed frontmatter" in result

    @pytest.mark.asyncio
    async def test_memu_search_returns_results(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        _register_base_tools(agent)

        tool = _get_tool(agent, "memu_search")
        ctx = MagicMock()
        mock_result = {"results": [{"content": "test memory"}]}
        with patch(
            "app.services.memu_client.memu_retrieve",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            result = await tool.function(ctx, query="test")
        assert "[1] test memory" in result

    @pytest.mark.asyncio
    async def test_memu_search_unavailable(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        _register_base_tools(agent)

        tool = _get_tool(agent, "memu_search")
        ctx = MagicMock()
        with patch(
            "app.services.memu_client.memu_retrieve",
            new_callable=AsyncMock,
            side_effect=Exception("connection refused"),
        ):
            result = await tool.function(ctx, query="test")
        assert "MemU search unavailable" in result

    @pytest.mark.asyncio
    async def test_memu_categories_default_on_failure(self, vault_dir: Path) -> None:
        from pydantic_ai import Agent
        from pydantic_ai.models.test import TestModel

        agent: Agent[MagicMock, str] = Agent(TestModel(), output_type=str)
        _register_base_tools(agent)

        tool = _get_tool(agent, "memu_categories")
        ctx = MagicMock()
        with patch(
            "app.services.memu_client.memu_retrieve",
            new_callable=AsyncMock,
            side_effect=Exception("unavailable"),
        ):
            result = await tool.function(ctx)
        assert "Categories:" in result
        assert "decisions" in result
        assert "patterns" in result


# ---------------------------------------------------------------------------
# Agent tool registration verification
# ---------------------------------------------------------------------------


class TestAgentToolRegistration:
    """Verify each of the 6 agents has all 7 base tools registered."""

    def _clear_agent_singletons(self) -> None:
        """Reset cached agent singletons to force re-creation."""
        import app.services.dream_agent as module

        module._extraction_agent = None
        module._record_agent = None
        module._deep_dream_agent = None
        module._phase1_agent = None
        module._phase2_agent = None
        module._weekly_review_agent = None

    def test_extraction_agent_has_base_tools(self) -> None:
        self._clear_agent_singletons()
        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        registered = _tool_names(agent)
        assert BASE_TOOL_NAMES.issubset(registered), f"Missing: {BASE_TOOL_NAMES - registered}"

    def test_extraction_agent_does_not_have_transcript_tools(self) -> None:
        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        registered = _tool_names(agent)
        transcript_tools = {
            "read_transcript", "grep_transcript", "transcript_info",
        }
        overlap = transcript_tools & registered
        assert transcript_tools.isdisjoint(registered), f"Should not have: {overlap}"

    def test_record_agent_has_base_tools(self) -> None:
        self._clear_agent_singletons()
        from app.services.dream_agent import _get_record_agent

        agent = _get_record_agent()
        registered = _tool_names(agent)
        assert BASE_TOOL_NAMES.issubset(registered), f"Missing: {BASE_TOOL_NAMES - registered}"

    def test_deep_dream_agent_has_base_tools(self) -> None:
        self._clear_agent_singletons()
        from app.services.dream_agent import _get_deep_dream_agent

        agent = _get_deep_dream_agent()
        registered = _tool_names(agent)
        assert BASE_TOOL_NAMES.issubset(registered), f"Missing: {BASE_TOOL_NAMES - registered}"

    def test_phase1_agent_has_base_tools(self) -> None:
        self._clear_agent_singletons()
        from app.services.dream_agent import _get_phase1_agent

        agent = _get_phase1_agent()
        registered = _tool_names(agent)
        assert BASE_TOOL_NAMES.issubset(registered), f"Missing: {BASE_TOOL_NAMES - registered}"

    def test_phase2_agent_has_base_tools(self) -> None:
        self._clear_agent_singletons()
        from app.services.dream_agent import _get_phase2_agent

        agent = _get_phase2_agent()
        registered = _tool_names(agent)
        assert BASE_TOOL_NAMES.issubset(registered), f"Missing: {BASE_TOOL_NAMES - registered}"

    def test_weekly_review_agent_has_base_tools(self) -> None:
        self._clear_agent_singletons()
        from app.services.dream_agent import _get_weekly_review_agent

        agent = _get_weekly_review_agent()
        registered = _tool_names(agent)
        assert BASE_TOOL_NAMES.issubset(registered), f"Missing: {BASE_TOOL_NAMES - registered}"
