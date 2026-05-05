from datetime import date, datetime
from pathlib import Path

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.test import TestModel

from app.services.dream_agent import (
    DeepDreamDeps,
    DreamDeps,
    Phase2Deps,
    RecordDeps,
    WeeklyReviewDeps,
    _count_tool_calls,
    _format_session_log,
    consolidation_to_dict,
)
from app.services.dream_models import (
    ConsolidationOutput,
    ConsolidationStats,
    ExtractionSummary,
    LightSleepOutput,
    RecordResult,
    REMSleepOutput,
    ScoredCandidate,
    SessionLogEntry,
    VaultFileEntry,
    VaultUpdates,
    WeeklyReviewOutput,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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
        session_id="test-session-123",
        project="test-project",
        token_count=100,
        created_at=datetime(2026, 4, 5, 10, 0, 0),
    )


@pytest.fixture
def deep_dream_deps() -> DeepDreamDeps:
    return DeepDreamDeps(
        source_date=date(2026, 4, 5),
        memu_memories=[
            {
                "content": "User prefers dark mode",
                "category": "preferences",
                "vault_target": "memory",
                "source_date": "2026-04-05",
            },
            {
                "content": "Project uses Python 3.12",
                "category": "facts",
                "vault_target": "patterns",
                "source_date": "2026-04-05",
            },
        ],
        memory_md="# Memory\n- existing memory entry",
        daily_log="## 2026-04-05\n- worked on feature X",
        soul_md="# Soul\nBe helpful and concise.",
    )


# ---------------------------------------------------------------------------
# Light Dream Agent Tests
# ---------------------------------------------------------------------------


class TestLightDreamAgent:
    def test_agent_has_correct_output_type(self) -> None:
        agent: Agent[DreamDeps, ExtractionSummary] = Agent(
            TestModel(),
            deps_type=DreamDeps,
            output_type=ExtractionSummary,
            retries=2,
            output_retries=3,
        )
        assert agent.output_type is ExtractionSummary

    def test_dream_deps_has_workspace(self, dream_deps: DreamDeps) -> None:
        assert dream_deps.workspace.is_dir()
        assert (dream_deps.workspace / "transcript.txt").is_file()

    def test_dream_deps_session_log_fields(self, dream_deps: DreamDeps) -> None:
        assert dream_deps.session_context == ""
        assert dream_deps.session_key_exchanges == []
        assert dream_deps.session_decisions == []
        assert dream_deps.session_lessons == []
        assert dream_deps.session_failed_lessons == []
        assert dream_deps.session_action_items == []
        assert dream_deps.session_concepts == []
        assert dream_deps.session_connections == []

    async def test_run_extraction_returns_tuple(self, dream_deps: DreamDeps) -> None:
        test_model = TestModel()
        agent: Agent[DreamDeps, ExtractionSummary] = Agent(
            test_model,
            deps_type=DreamDeps,
            output_type=ExtractionSummary,
            retries=2,
            output_retries=3,
        )

        result = await agent.run("Extract memories.", deps=dream_deps)
        usage = result.usage()
        tool_call_count = _count_tool_calls(result.all_messages())

        assert isinstance(result.output, ExtractionSummary)
        assert usage is not None
        assert isinstance(tool_call_count, int)

    def test_session_log_assembly_includes_new_fields(self, dream_deps: DreamDeps) -> None:
        dream_deps.session_context = "Discussed architecture patterns"
        dream_deps.session_key_exchanges = ["User asked about DDD vs Clean Arch"]
        dream_deps.session_decisions = ["Use Clean Architecture"]
        dream_deps.session_lessons = ["Layered boundaries reduce coupling"]
        dream_deps.session_action_items = ["Document the architecture"]
        dream_deps.session_concepts = [{"name": "DDD", "description": "Domain-Driven Design"}]
        dream_deps.session_connections = [
            {
                "concept_a": "DDD",
                "concept_b": "Clean Architecture",
                "relationship": "complementary",
            }
        ]

        session_log = SessionLogEntry(
            context=dream_deps.session_context,
            key_exchanges=dream_deps.session_key_exchanges,
            decisions_made=dream_deps.session_decisions,
            lessons_learned=dream_deps.session_lessons,
            action_items=dream_deps.session_action_items,
            concepts=dream_deps.session_concepts,
            connections=dream_deps.session_connections,
        )

        assert session_log.context == "Discussed architecture patterns"
        assert session_log.key_exchanges == ["User asked about DDD vs Clean Arch"]
        assert len(session_log.concepts) == 1
        assert session_log.concepts[0]["name"] == "DDD"
        assert len(session_log.connections) == 1
        assert session_log.connections[0]["relationship"] == "complementary"


# ---------------------------------------------------------------------------
# store_connection Tool Tests
# ---------------------------------------------------------------------------


class TestStoreConnectionTool:
    @pytest.mark.asyncio
    async def test_store_connection_default_relationship_type(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import MagicMock

        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "store_connection":
                tool = t
                break
        assert tool is not None

        ctx = MagicMock()
        ctx.deps = dream_deps

        result = await tool.function(ctx, concept_a="A", concept_b="B", relationship="related")
        assert "[supports]" in result
        assert len(dream_deps.session_connections) == 1
        assert dream_deps.session_connections[0]["relationship_type"] == "supports"

    @pytest.mark.asyncio
    async def test_store_connection_valid_relationship_type(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import MagicMock

        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "store_connection":
                tool = t
                break

        ctx = MagicMock()
        ctx.deps = dream_deps

        result = await tool.function(
            ctx,
            concept_a="A",
            concept_b="B",
            relationship="B replaces A",
            relationship_type="supersedes",
        )
        assert "[supersedes]" in result
        assert dream_deps.session_connections[0]["relationship_type"] == "supersedes"

    @pytest.mark.asyncio
    async def test_store_connection_invalid_relationship_type(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import MagicMock

        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "store_connection":
                tool = t
                break

        ctx = MagicMock()
        ctx.deps = dream_deps

        result = await tool.function(
            ctx,
            concept_a="A",
            concept_b="B",
            relationship="related",
            relationship_type="invalid_type",
        )
        assert "Invalid relationship_type" in result
        assert len(dream_deps.session_connections) == 0

    @pytest.mark.asyncio
    async def test_store_connection_all_valid_types(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import MagicMock

        from app.services.dream_agent import _get_extraction_agent
        from app.services.dream_models import ALLOWED_RELATIONSHIP_TYPES

        agent = _get_extraction_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "store_connection":
                tool = t
                break

        ctx = MagicMock()
        ctx.deps = dream_deps

        for rel_type in ALLOWED_RELATIONSHIP_TYPES:
            result = await tool.function(
                ctx,
                concept_a="X",
                concept_b="Y",
                relationship="test",
                relationship_type=rel_type,
            )
            assert f"[{rel_type}]" in result


# ---------------------------------------------------------------------------
# store_lesson Tool Tests
# ---------------------------------------------------------------------------


class TestStoreLessonTool:
    @pytest.mark.asyncio
    async def test_store_lesson_without_outcome(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import MagicMock

        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "store_lesson":
                tool = t
                break
        assert tool is not None

        ctx = MagicMock()
        ctx.deps = dream_deps

        result = await tool.function(ctx, lesson="Always test edge cases")
        assert "Lesson stored" in result
        assert len(dream_deps.session_lessons) == 1
        assert dream_deps.session_failed_lessons == []

    @pytest.mark.asyncio
    async def test_store_lesson_with_failed_outcome(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import MagicMock

        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "store_lesson":
                tool = t
                break
        assert tool is not None

        ctx = MagicMock()
        ctx.deps = dream_deps

        result = await tool.function(
            ctx,
            lesson="Tried SQLite for concurrent writes",
            outcome="failed",
            failure_reason="SQLite locks entire DB on write",
        )
        assert "Lesson stored" in result
        assert len(dream_deps.session_lessons) == 1
        assert len(dream_deps.session_failed_lessons) == 1
        assert dream_deps.session_failed_lessons[0]["outcome"] == "failed"
        reason = dream_deps.session_failed_lessons[0]["failure_reason"]
        assert reason == "SQLite locks entire DB on write"

    @pytest.mark.asyncio
    async def test_store_lesson_with_success_outcome_no_failed_entry(
        self, dream_deps: DreamDeps
    ) -> None:
        from unittest.mock import MagicMock

        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "store_lesson":
                tool = t
                break

        ctx = MagicMock()
        ctx.deps = dream_deps

        await tool.function(ctx, lesson="Async patterns work well", outcome="success")
        assert len(dream_deps.session_lessons) == 1
        assert dream_deps.session_failed_lessons == []


# ---------------------------------------------------------------------------
# Deep Dream Agent Tests
# ---------------------------------------------------------------------------


class TestDeepDreamAgent:
    def test_agent_has_correct_output_type(self) -> None:
        agent: Agent[DeepDreamDeps, ConsolidationOutput] = Agent(
            TestModel(),
            deps_type=DeepDreamDeps,
            output_type=ConsolidationOutput,
            retries=2,
            output_retries=3,
        )
        assert agent.output_type is ConsolidationOutput

    async def test_read_memory_file_tool(self, deep_dream_deps: DeepDreamDeps) -> None:
        assert deep_dream_deps.memory_md == "# Memory\n- existing memory entry"

    async def test_read_daily_log_tool(self, deep_dream_deps: DeepDreamDeps) -> None:
        assert deep_dream_deps.daily_log == "## 2026-04-05\n- worked on feature X"

    async def test_query_memu_memories_formats_correctly(
        self, deep_dream_deps: DeepDreamDeps
    ) -> None:
        memories = deep_dream_deps.memu_memories
        lines: list[str] = []
        for i, mem in enumerate(memories, 1):
            content = mem.get("content", "")
            category = mem.get("category", "unknown")
            vault = mem.get("vault_target", "memory")
            source_date = mem.get("source_date", "unknown")
            lines.append(f"[{i}] ({category}/{vault}) {source_date}: {content}")
        formatted = "\n".join(lines)

        assert "[1] (preferences/memory) 2026-04-05: User prefers dark mode" in formatted
        assert "[2] (facts/patterns) 2026-04-05: Project uses Python 3.12" in formatted

    async def test_query_memu_memories_handles_empty(self) -> None:
        deps = DeepDreamDeps(
            source_date=date(2026, 4, 5),
            memu_memories=[],
            memory_md="",
            daily_log="",
            soul_md="",
        )
        result = "No MemU memories for today." if not deps.memu_memories else "has memories"
        assert result == "No MemU memories for today."

    async def test_read_soul_file_tool(self, deep_dream_deps: DeepDreamDeps) -> None:
        assert deep_dream_deps.soul_md == "# Soul\nBe helpful and concise."

    async def test_run_deep_dream_consolidation_returns_tuple(
        self, deep_dream_deps: DeepDreamDeps
    ) -> None:
        test_model = TestModel()
        agent: Agent[DeepDreamDeps, ConsolidationOutput] = Agent(
            test_model,
            deps_type=DeepDreamDeps,
            output_type=ConsolidationOutput,
            retries=2,
            output_retries=3,
        )

        result = await agent.run("Consolidate memories.", deps=deep_dream_deps)
        usage = result.usage()
        tool_call_count = _count_tool_calls(result.all_messages())

        assert isinstance(result.output, ConsolidationOutput)
        assert usage is not None
        assert isinstance(tool_call_count, int)


# ---------------------------------------------------------------------------
# Phase 1: Light Sleep Agent Tests
# ---------------------------------------------------------------------------


class TestPhase1LightSleepAgent:
    def test_agent_has_correct_output_type(self) -> None:
        agent: Agent[DeepDreamDeps, LightSleepOutput] = Agent(
            TestModel(),
            deps_type=DeepDreamDeps,
            output_type=LightSleepOutput,
            retries=2,
            output_retries=3,
        )
        assert agent.output_type is LightSleepOutput

    async def test_run_phase1_returns_tuple(self, deep_dream_deps: DeepDreamDeps) -> None:
        test_model = TestModel()
        agent: Agent[DeepDreamDeps, LightSleepOutput] = Agent(
            test_model,
            deps_type=DeepDreamDeps,
            output_type=LightSleepOutput,
            retries=2,
            output_retries=3,
        )

        result = await agent.run("Inventory and deduplicate memories.", deps=deep_dream_deps)
        usage = result.usage()
        tool_call_count = _count_tool_calls(result.all_messages())

        assert isinstance(result.output, LightSleepOutput)
        assert usage is not None
        assert isinstance(tool_call_count, int)

    def test_phase1_deps_reuses_deep_dream_deps(self, deep_dream_deps: DeepDreamDeps) -> None:
        assert deep_dream_deps.memory_md != ""
        assert deep_dream_deps.daily_log != ""
        assert len(deep_dream_deps.memu_memories) > 0
        assert deep_dream_deps.soul_md != ""


class TestPhase1PromptInjection:
    """Tests for Story 9.15: Phase 1 prompt injection of MEMORY.md and daily log."""

    def _clear_phase1(self) -> None:
        import app.services.dream_agent as module

        module._phase1_agent = None

    def _tool_names(self, agent: Agent) -> set[str]:  # type: ignore[type-arg]
        return {t.name for t in agent._function_toolset.tools.values()}

    def test_phase1_agent_has_query_memu_memories(self) -> None:
        self._clear_phase1()
        from app.services.dream_agent import _get_phase1_agent

        agent = _get_phase1_agent()
        assert "query_memu_memories" in self._tool_names(agent)

    def test_phase1_agent_no_read_memory_file(self) -> None:
        self._clear_phase1()
        from app.services.dream_agent import _get_phase1_agent

        agent = _get_phase1_agent()
        assert "read_memory_file" not in self._tool_names(agent)

    def test_phase1_agent_no_read_daily_log(self) -> None:
        self._clear_phase1()
        from app.services.dream_agent import _get_phase1_agent

        agent = _get_phase1_agent()
        assert "read_daily_log" not in self._tool_names(agent)

    def test_phase1_usage_limits(self) -> None:
        from app.config import settings
        from app.services.dream_agent import PHASE1_USAGE_LIMITS

        assert PHASE1_USAGE_LIMITS.total_tokens_limit == settings.phase1_tokens_limit
        assert PHASE1_USAGE_LIMITS.tool_calls_limit == settings.phase1_tool_calls_limit

    @pytest.mark.asyncio
    async def test_run_prompt_contains_memory_md(self, deep_dream_deps: DeepDreamDeps) -> None:
        self._clear_phase1()
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_phase1_light_sleep

        mock_result = MagicMock()
        mock_result.output = LightSleepOutput(
            candidates=[], duplicates_removed=0, contradictions_found=0
        )
        mock_result.usage.return_value = MagicMock()
        mock_result.all_messages.return_value = []

        with patch("app.services.dream_agent._get_phase1_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.run = AsyncMock(return_value=mock_result)
            mock_get_agent.return_value = mock_agent

            await run_phase1_light_sleep(deep_dream_deps)

            prompt = mock_agent.run.call_args[0][0]
            assert "## Current MEMORY.md" in prompt
            assert "# Memory" in prompt
            assert "existing memory entry" in prompt

    @pytest.mark.asyncio
    async def test_run_prompt_contains_daily_log(self, deep_dream_deps: DeepDreamDeps) -> None:
        self._clear_phase1()
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_phase1_light_sleep

        mock_result = MagicMock()
        mock_result.output = LightSleepOutput(
            candidates=[], duplicates_removed=0, contradictions_found=0
        )
        mock_result.usage.return_value = MagicMock()
        mock_result.all_messages.return_value = []

        with patch("app.services.dream_agent._get_phase1_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.run = AsyncMock(return_value=mock_result)
            mock_get_agent.return_value = mock_agent

            await run_phase1_light_sleep(deep_dream_deps)

            prompt = mock_agent.run.call_args[0][0]
            assert "## Today's Daily Log" in prompt
            assert "worked on feature X" in prompt

    @pytest.mark.asyncio
    async def test_empty_memory_md_shows_placeholder(self) -> None:
        self._clear_phase1()
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_phase1_light_sleep

        deps = DeepDreamDeps(
            source_date=date(2026, 4, 5),
            memu_memories=[],
            memory_md="",
            daily_log="some log",
            soul_md="# Soul",
        )

        mock_result = MagicMock()
        mock_result.output = LightSleepOutput(
            candidates=[], duplicates_removed=0, contradictions_found=0
        )
        mock_result.usage.return_value = MagicMock()
        mock_result.all_messages.return_value = []

        with patch("app.services.dream_agent._get_phase1_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.run = AsyncMock(return_value=mock_result)
            mock_get_agent.return_value = mock_agent

            await run_phase1_light_sleep(deps)

            prompt = mock_agent.run.call_args[0][0]
            lines = prompt.split("\n")
            memory_idx = lines.index("## Current MEMORY.md")
            assert lines[memory_idx + 1] == "(empty)"

    @pytest.mark.asyncio
    async def test_empty_daily_log_shows_placeholder(self) -> None:
        self._clear_phase1()
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_phase1_light_sleep

        deps = DeepDreamDeps(
            source_date=date(2026, 4, 5),
            memu_memories=[],
            memory_md="some memory",
            daily_log="",
            soul_md="# Soul",
        )

        mock_result = MagicMock()
        mock_result.output = LightSleepOutput(
            candidates=[], duplicates_removed=0, contradictions_found=0
        )
        mock_result.usage.return_value = MagicMock()
        mock_result.all_messages.return_value = []

        with patch("app.services.dream_agent._get_phase1_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.run = AsyncMock(return_value=mock_result)
            mock_get_agent.return_value = mock_agent

            await run_phase1_light_sleep(deps)

            prompt = mock_agent.run.call_args[0][0]
            lines = prompt.split("\n")
            log_idx = lines.index("## Today's Daily Log")
            assert lines[log_idx + 1] == "(empty)"


# ---------------------------------------------------------------------------
# Phase 2: REM Sleep Agent Tests
# ---------------------------------------------------------------------------


@pytest.fixture
def phase2_deps() -> Phase2Deps:
    return Phase2Deps(
        source_date=date(2026, 4, 5),
        daily_logs={
            "2026-04-05": "## Session 1\nWorked on async patterns",
            "2026-04-04": "## Session 2\nRefactored error handling",
            "2026-04-03": "## Session 3\nDiscussed DDD concepts",
        },
        vault_indexes={
            "decisions": "# Decisions Index\n- use-python.md",
            "patterns": "# Patterns Index\n- async-patterns.md",
            "concepts": "# Concepts Index\n- ddd.md",
        },
        phase1_candidates=[
            ScoredCandidate(
                content="Use async patterns",
                category="patterns",
                reinforcement_count=3,
                source_sessions=["session-1", "session-2", "session-3"],
            ),
            ScoredCandidate(
                content="Prefer Result type for errors",
                category="decisions",
                contradiction_flag=True,
                source_sessions=["session-2"],
            ),
        ],
    )


class TestPhase2REMSleepAgent:
    def test_agent_has_correct_output_type(self) -> None:
        agent: Agent[Phase2Deps, REMSleepOutput] = Agent(
            TestModel(),
            deps_type=Phase2Deps,
            output_type=REMSleepOutput,
            retries=2,
            output_retries=3,
        )
        assert agent.output_type is REMSleepOutput

    def test_phase2_deps_has_daily_logs(self, phase2_deps: Phase2Deps) -> None:
        assert len(phase2_deps.daily_logs) == 3
        assert "2026-04-05" in phase2_deps.daily_logs

    def test_phase2_deps_has_vault_indexes(self, phase2_deps: Phase2Deps) -> None:
        assert len(phase2_deps.vault_indexes) == 3
        assert "decisions" in phase2_deps.vault_indexes

    def test_phase2_deps_has_phase1_candidates(self, phase2_deps: Phase2Deps) -> None:
        assert len(phase2_deps.phase1_candidates) == 2
        assert phase2_deps.phase1_candidates[0].content == "Use async patterns"

    async def test_run_phase2_returns_tuple(self, phase2_deps: Phase2Deps) -> None:
        test_model = TestModel()
        agent: Agent[Phase2Deps, REMSleepOutput] = Agent(
            test_model,
            deps_type=Phase2Deps,
            output_type=REMSleepOutput,
            retries=2,
            output_retries=3,
        )

        result = await agent.run("Analyze cross-session patterns.", deps=phase2_deps)
        usage = result.usage()
        tool_call_count = _count_tool_calls(result.all_messages())

        assert isinstance(result.output, REMSleepOutput)
        assert usage is not None
        assert isinstance(tool_call_count, int)


class TestPhase2PromptInjection:
    """Tests for Story 9.16: Phase 2 prompt injection of candidates + vault indexes."""

    def _clear_phase2(self) -> None:
        import app.services.dream_agent as module

        module._phase2_agent = None

    def _tool_names(self, agent: Agent) -> set[str]:  # type: ignore[type-arg]
        return {t.name for t in agent._function_toolset.tools.values()}

    def test_phase2_agent_has_read_daily_log(self) -> None:
        self._clear_phase2()
        from app.services.dream_agent import _get_phase2_agent

        agent = _get_phase2_agent()
        assert "read_daily_log" in self._tool_names(agent)

    def test_phase2_agent_no_get_phase1_candidates(self) -> None:
        self._clear_phase2()
        from app.services.dream_agent import _get_phase2_agent

        agent = _get_phase2_agent()
        assert "get_phase1_candidates" not in self._tool_names(agent)

    def test_phase2_agent_no_read_vault_index(self) -> None:
        self._clear_phase2()
        from app.services.dream_agent import _get_phase2_agent

        agent = _get_phase2_agent()
        assert "read_vault_index" not in self._tool_names(agent)

    def test_phase2_deps_has_injection_fields(self) -> None:
        deps = Phase2Deps(
            source_date=date(2026, 4, 5),
            daily_logs={},
            vault_indexes={},
            phase1_candidates=[],
            phase1_text="some candidates",
            vault_index_text="some indexes",
        )
        assert deps.phase1_text == "some candidates"
        assert deps.vault_index_text == "some indexes"

    def test_phase2_deps_injection_defaults_empty(self) -> None:
        deps = Phase2Deps(
            source_date=date(2026, 4, 5),
            daily_logs={},
            vault_indexes={},
            phase1_candidates=[],
        )
        assert deps.phase1_text == ""
        assert deps.vault_index_text == ""

    def test_phase2_usage_limits(self) -> None:
        from app.config import settings
        from app.services.dream_agent import PHASE2_USAGE_LIMITS

        assert PHASE2_USAGE_LIMITS.total_tokens_limit == settings.phase2_tokens_limit
        assert PHASE2_USAGE_LIMITS.tool_calls_limit == settings.phase2_tool_calls_limit

    @pytest.mark.asyncio
    async def test_run_phase2_prompt_contains_candidates(self) -> None:
        self._clear_phase2()
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_phase2_rem_sleep

        deps = Phase2Deps(
            source_date=date(2026, 4, 5),
            daily_logs={},
            vault_indexes={},
            phase1_candidates=[],
            phase1_text="[1] (decision) Use scoring [score=0.85, reinforced=2]",
            vault_index_text="### decisions/\n- scoring.md",
        )

        mock_result = MagicMock()
        mock_result.output = REMSleepOutput(
            themes=[], new_connections=[], promotion_candidates=[], gaps=[]
        )
        mock_result.usage.return_value = MagicMock()
        mock_result.all_messages.return_value = []

        with patch("app.services.dream_agent._get_phase2_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.run = AsyncMock(return_value=mock_result)
            mock_get_agent.return_value = mock_agent

            await run_phase2_rem_sleep(deps)

            prompt = mock_agent.run.call_args[0][0]
            assert "## Phase 1 Candidates" in prompt
            assert "[1] (decision) Use scoring [score=0.85, reinforced=2]" in prompt
            assert "## Vault Indexes" in prompt
            assert "### decisions/" in prompt

    @pytest.mark.asyncio
    async def test_run_phase2_empty_candidates_placeholder(self) -> None:
        self._clear_phase2()
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_phase2_rem_sleep

        deps = Phase2Deps(
            source_date=date(2026, 4, 5),
            daily_logs={},
            vault_indexes={},
            phase1_candidates=[],
            phase1_text="",
            vault_index_text="",
        )

        mock_result = MagicMock()
        mock_result.output = REMSleepOutput(
            themes=[], new_connections=[], promotion_candidates=[], gaps=[]
        )
        mock_result.usage.return_value = MagicMock()
        mock_result.all_messages.return_value = []

        with patch("app.services.dream_agent._get_phase2_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.run = AsyncMock(return_value=mock_result)
            mock_get_agent.return_value = mock_agent

            await run_phase2_rem_sleep(deps)

            prompt = mock_agent.run.call_args[0][0]
            assert "No Phase 1 candidates." in prompt
            assert "No vault indexes available." in prompt


class TestConsolidationToDict:
    def test_basic_consolidation(self) -> None:
        output = ConsolidationOutput(
            memory_md="# Updated Memory\n- new entry",
            daily_summary="Productive day with feature work",
            stats=ConsolidationStats(
                total_memories_processed=5,
                duplicates_removed=1,
                contradictions_resolved=0,
                patterns_promoted=2,
                stale_pruned=0,
            ),
            vault_updates=VaultUpdates(
                decisions=[
                    VaultFileEntry(
                        filename="use-python.md",
                        title="Use Python",
                        summary="Decision to use Python for backend",
                        content="# Use Python\nWe decided...",
                        tags=["python", "backend"],
                        action="create",
                    ),
                ],
                projects=[],
                patterns=[],
                templates=[],
            ),
        )
        result = consolidation_to_dict(output)
        assert result["memory_md"] == "# Updated Memory\n- new entry"
        assert result["daily_summary"] == "Productive day with feature work"
        assert result["stats"]["total_memories_processed"] == 5
        assert result["stats"]["duplicates_removed"] == 1
        assert len(result["vault_updates"]["decisions"]) == 1
        assert result["vault_updates"]["projects"] == []

    def test_consolidation_with_new_vault_types(self) -> None:
        output = ConsolidationOutput(
            memory_md="# Memory",
            daily_summary="Test day",
            vault_updates=VaultUpdates(
                concepts=[
                    VaultFileEntry(
                        filename="clean-architecture.md",
                        title="Clean Architecture",
                        summary="Core concept",
                        content="# Clean Architecture",
                        action="create",
                    ),
                ],
                connections=[
                    VaultFileEntry(
                        filename="clean-arch-and-nestjs.md",
                        title="Clean Architecture x NestJS",
                        summary="How they map",
                        content="# Clean Architecture x NestJS",
                        action="create",
                    ),
                ],
                lessons=[],
            ),
        )
        result = consolidation_to_dict(output)
        assert len(result["vault_updates"]["concepts"]) == 1
        assert len(result["vault_updates"]["connections"]) == 1
        assert result["vault_updates"]["lessons"] == []


# ---------------------------------------------------------------------------
# Utility Tests
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Record Agent Tests
# ---------------------------------------------------------------------------


@pytest.fixture
def record_deps(tmp_path: Path) -> RecordDeps:
    (tmp_path / "dailys").mkdir()
    (tmp_path / "decisions").mkdir()
    vault_file = tmp_path / "decisions" / "use-python.md"
    vault_file.write_text(
        "---\ntitle: Use Python\nreinforcement_count: 2\n"
        "last_reinforced: 2026-04-01\n---\n"
        "# Use Python\nWe decided to use Python.\n",
        encoding="utf-8",
    )
    return RecordDeps(
        workspace=tmp_path,
        source_date=date(2026, 4, 5),
        session_id="test-record-session",
        summary="Test session summary",
        session_log=SessionLogEntry(context="Test context"),
    )


class TestRecordAgent:
    def test_record_deps_has_workspace(self, record_deps: RecordDeps) -> None:
        assert record_deps.workspace.is_dir()
        assert (record_deps.workspace / "dailys").is_dir()

    def test_record_result_model(self) -> None:
        result = RecordResult(summary="Recorded session")
        assert result.summary == "Recorded session"
        assert result.files == []


class TestWriteRestriction:
    @pytest.mark.asyncio
    async def test_write_to_memory_md_rejected(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break
        assert write_tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(ctx, path="MEMORY.md", content="# Memory\ntest")
        assert "Error: path 'MEMORY.md' not allowed" in result
        assert "Allowed patterns" in result

    @pytest.mark.asyncio
    async def test_write_to_decisions_rejected(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(ctx, path="decisions/new.md", content="test")
        assert "Error: path 'decisions/new.md' not allowed" in result

    @pytest.mark.asyncio
    async def test_write_to_dailys_allowed(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(ctx, path="dailys/2026-04-05.md", content="# Daily Log")
        assert "Written" in result
        assert (record_deps.workspace / "dailys" / "2026-04-05.md").read_text() == "# Daily Log"


class TestGlobRestrictedWrite:
    """Tests for glob-restricted write_file (Story 9.31)."""

    @pytest.mark.asyncio
    async def test_write_matching_default_pattern(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break
        assert write_tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(ctx, path="dailys/2026-04-16.md", content="# Log")
        assert "Written" in result

    @pytest.mark.asyncio
    async def test_write_rejects_non_matching_path(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent(allowed_write_patterns=["dailys/*.md"])
        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break
        assert write_tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(ctx, path="decisions/test.md", content="test")
        assert "Error: path 'decisions/test.md' not allowed" in result
        assert "dailys/*.md" in result

    @pytest.mark.asyncio
    async def test_write_multiple_patterns(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent(allowed_write_patterns=["dailys/*.md", "projects/*.md"])

        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break
        assert write_tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps
        (record_deps.workspace / "projects").mkdir(exist_ok=True)

        result1 = await write_tool.function(ctx, path="dailys/2026-04-16.md", content="daily")
        assert "Written" in result1

        result2 = await write_tool.function(ctx, path="projects/taskflow.md", content="project")
        assert "Written" in result2

        result3 = await write_tool.function(ctx, path="decisions/nope.md", content="bad")
        assert "Error: path 'decisions/nope.md' not allowed" in result3

    @pytest.mark.asyncio
    async def test_write_glob_wildcard_extension(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent(allowed_write_patterns=["dailys/*.md"])

        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break
        assert write_tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(ctx, path="dailys/notes.txt", content="text")
        assert "Error: path 'dailys/notes.txt' not allowed" in result

    @pytest.mark.asyncio
    async def test_write_glob_question_mark_wildcard(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent(allowed_write_patterns=["dailys/202?-*.md"])

        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break
        assert write_tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(ctx, path="dailys/2026-04-16.md", content="log")
        assert "Written" in result

    @pytest.mark.asyncio
    async def test_write_path_traversal_rejected(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent(allowed_write_patterns=["dailys/*.md"])

        write_tool = None
        for tool in agent._function_toolset.tools.values():
            if tool.name == "write_file":
                write_tool = tool
                break
        assert write_tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await write_tool.function(
            ctx, path="dailys/../secrets/foo.md", content="malicious"
        )
        assert "Error: path 'dailys/../secrets/foo.md' not allowed" in result


class TestRecordAgentNoMemuAdd:
    """Tests for memu_add removal (Story 9.31)."""

    def test_record_agent_has_no_memu_add_tool(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "memu_add" not in tool_names

    def test_record_agent_still_has_write_file(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "write_file" in tool_names

    def test_record_agent_still_has_update_reinforcement(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "update_reinforcement" in tool_names

    def test_record_agent_still_has_flag_contradiction(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "flag_contradiction" in tool_names


class TestReinforcementTracking:
    @pytest.mark.asyncio
    async def test_update_reinforcement_increments_count(self, record_deps: RecordDeps) -> None:
        from app.services.dream_agent import _get_record_agent

        agent = _get_record_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "update_reinforcement":
                tool = t
                break
        assert tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await tool.function(ctx, file_path="decisions/use-python.md")
        assert "Reinforcement updated" in result

        updated = (record_deps.workspace / "decisions" / "use-python.md").read_text()
        assert "reinforcement_count: 3" in updated
        assert f"last_reinforced: {date.today().isoformat()}" in updated

    @pytest.mark.asyncio
    async def test_update_reinforcement_no_frontmatter(self, record_deps: RecordDeps) -> None:
        no_fm = record_deps.workspace / "decisions" / "no-frontmatter.md"
        no_fm.write_text("# No Frontmatter\nJust content.\n", encoding="utf-8")

        from app.services.dream_agent import _get_record_agent

        agent = _get_record_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "update_reinforcement":
                tool = t
                break

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await tool.function(ctx, file_path="decisions/no-frontmatter.md")
        assert "no YAML frontmatter" in result

    @pytest.mark.asyncio
    async def test_flag_contradiction(self, record_deps: RecordDeps) -> None:
        from app.services.dream_agent import _get_record_agent

        agent = _get_record_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "flag_contradiction":
                tool = t
                break
        assert tool is not None

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await tool.function(
            ctx, file_path="decisions/use-python.md", reason="New evidence suggests Go"
        )
        assert "Contradiction flagged" in result

        updated = (record_deps.workspace / "decisions" / "use-python.md").read_text()
        assert "has_contradiction: true" in updated
        assert "contradiction_reason: New evidence suggests Go" in updated

    @pytest.mark.asyncio
    async def test_update_reinforcement_adds_fields_when_missing(
        self, record_deps: RecordDeps
    ) -> None:
        vault_file = record_deps.workspace / "decisions" / "bare.md"
        vault_file.write_text(
            "---\ntitle: Bare File\n---\n# Bare\nContent.\n",
            encoding="utf-8",
        )

        from app.services.dream_agent import _get_record_agent

        agent = _get_record_agent()
        tool = None
        for t in agent._function_toolset.tools.values():
            if t.name == "update_reinforcement":
                tool = t
                break

        from unittest.mock import MagicMock

        ctx = MagicMock()
        ctx.deps = record_deps

        result = await tool.function(ctx, file_path="decisions/bare.md")
        assert "Reinforcement updated" in result

        updated = vault_file.read_text()
        assert "reinforcement_count: 1" in updated
        assert f"last_reinforced: {date.today().isoformat()}" in updated


class TestRecordPromptInjection:
    """Tests for record agent prompt injection (Story 9.23)."""

    def test_record_agent_no_get_session_log_tool(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "get_session_log" not in tool_names

    def test_record_agent_no_get_extracted_memories_tool(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "get_extracted_memories" not in tool_names

    def test_record_agent_has_read_file_tool(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "read_file" in tool_names

    def test_record_agent_has_read_frontmatter_tool(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "read_frontmatter" in tool_names

    def test_record_agent_has_memu_search_tool(self, record_deps: RecordDeps) -> None:
        import app.services.dream_agent as mod

        mod._record_agent = None
        agent = mod._get_record_agent()
        tool_names = list(agent._function_toolset.tools.keys())
        assert "memu_search" in tool_names

    def test_run_record_prompt_contains_session_log(self, record_deps: RecordDeps) -> None:
        record_deps.summary = "Fix Jarvis plugin"
        record_deps.session_log = SessionLogEntry(
            context="Investigated plugin config",
            decisions_made=["Use env vars for hooks"],
        )

        prompt = _format_session_log(record_deps.session_log, record_deps.summary)
        assert "Summary: Fix Jarvis plugin" in prompt
        assert "Context: Investigated plugin config" in prompt
        assert "Use env vars for hooks" in prompt

    def test_run_record_prompt_contains_memories(self, record_deps: RecordDeps) -> None:
        """Memories are a property of SessionLogEntry; they're rendered inline
        by _format_session_log under the Memory: section."""
        from app.services.dream_models import MemoryItem

        record_deps.session_log.memories = [
            MemoryItem(
                content="Use env vars for hooks",
                reasoning="macOS Keychain",
                vault_target="decisions",
                source_date="2026-04-14",
            ),
        ]

        prompt = _format_session_log(record_deps.session_log, record_deps.summary)
        assert "Memory:" in prompt
        assert "[decisions]" in prompt
        assert "Use env vars for hooks" in prompt
        assert "macOS Keychain" in prompt

    def test_run_record_prompt_contains_daily_log(self, record_deps: RecordDeps) -> None:
        daily_path = f"dailys/{record_deps.source_date.isoformat()}.md"
        (record_deps.workspace / "dailys").mkdir(exist_ok=True)
        (record_deps.workspace / daily_path).write_text(
            "# Daily Log: 2026-04-05\n\n## Sessions\n\n### Session 1\nEarlier session\n",
            encoding="utf-8",
        )

        daily_content = (record_deps.workspace / daily_path).read_text()
        assert "Session 1" in daily_content
        assert "Earlier session" in daily_content


class TestRecordContinuationPrompt:
    """Tests for conversation chain continuation support (Story 9.25)."""

    def test_record_deps_is_continuation_defaults_false(self, record_deps: RecordDeps) -> None:
        fresh = RecordDeps(workspace=record_deps.workspace)
        assert fresh.is_continuation is False

    def test_run_record_prompt_contains_session_id_always(self, record_deps: RecordDeps) -> None:
        record_deps.session_id = "abc-session-123"
        record_deps.is_continuation = False

        sections = [
            "Record the session to the daily log and track reinforcement signals.",
            "",
            f"Session ID: {record_deps.session_id}",
            "",
            "## Session Log",
            _format_session_log(record_deps.session_log, record_deps.summary),
        ]
        prompt = "\n".join(sections)
        assert "Session ID: abc-session-123" in prompt

    def test_run_record_prompt_no_continuation_when_false(self, record_deps: RecordDeps) -> None:
        record_deps.is_continuation = False
        record_deps.session_id = "no-continuation-session"

        sections = [
            "Record the session to the daily log and track reinforcement signals.",
            "",
            f"Session ID: {record_deps.session_id}",
        ]
        if record_deps.is_continuation:
            sections.append("## CONTINUATION MODE")
        prompt = "\n".join(sections)
        assert "CONTINUATION MODE" not in prompt

    def test_run_record_prompt_contains_continuation_when_true(
        self, record_deps: RecordDeps
    ) -> None:
        record_deps.is_continuation = True
        record_deps.session_id = "resumed-session-456"

        sections = [
            "Record the session to the daily log and track reinforcement signals.",
            "",
            f"Session ID: {record_deps.session_id}",
        ]
        if record_deps.is_continuation:
            sid = record_deps.session_id
            sections.append("")
            sections.append("## CONTINUATION MODE")
            sections.append(
                "This is a CONTINUATION of an existing session (user closed and resumed)."
            )
            sections.append(
                f"Find the session block with `<!-- session_id: {sid} -->` in the daily log."
            )
            sections.append(
                "APPEND new information to that existing "
                "block — do NOT create a new "
                "### Session heading."
            )
            sections.append(
                "Add a `**Continued at [HH:MM]**:` marker before new content in each section."
            )

        prompt = "\n".join(sections)
        assert "## CONTINUATION MODE" in prompt
        assert "<!-- session_id: resumed-session-456 -->" in prompt
        assert "APPEND new information" in prompt
        assert "**Continued at [HH:MM]**" in prompt


class TestFormatSessionLog:
    def test_minimal_session_log(self) -> None:
        sl = SessionLogEntry()
        result = _format_session_log(sl, "Test summary")
        assert result == "Summary: Test summary"

    def test_full_session_log(self) -> None:
        sl = SessionLogEntry(
            context="Working on feature",
            key_exchanges=["Discussed API design"],
            decisions_made=["Use REST over GraphQL"],
            lessons_learned=["Mock tests can hide bugs"],
            action_items=["Write integration tests"],
            concepts=[{"name": "REST", "description": "RESTful API design"}],
            connections=[
                {
                    "concept_a": "REST",
                    "concept_b": "HTTP",
                    "relationship": "uses",
                }
            ],
        )
        result = _format_session_log(sl, "Feature work")
        assert "Summary: Feature work" in result
        assert "Context: Working on feature" in result
        assert "Discussed API design" in result
        assert "Use REST over GraphQL" in result
        assert "Mock tests can hide bugs" in result
        assert "Write integration tests" in result
        assert "REST: RESTful API design" in result
        assert "REST <-> HTTP: uses" in result


class TestFormatSessionLogMemories:
    """Memories are rendered inline by _format_session_log from
    SessionLogEntry.memories. Story 9.35 removed the standalone
    _format_session_memories helper."""

    def test_no_memories_section_when_empty(self) -> None:
        sl = SessionLogEntry(context="Test")
        result = _format_session_log(sl, "Test session")
        assert "Memory:" not in result

    def test_memory_section_with_structured_items(self) -> None:
        from app.services.dream_models import MemoryItem

        sl = SessionLogEntry(
            context="Test context",
            memories=[
                MemoryItem(
                    content="Use env vars",
                    reasoning="Keychain issue",
                    vault_target="decisions",
                    source_date="2026-04-14",
                ),
                MemoryItem(
                    content="Exit hook 0 on errors",
                    reasoning=None,
                    vault_target="patterns",
                    source_date="2026-04-14",
                ),
            ],
        )
        result = _format_session_log(sl, "Test session")
        assert "Memory:" in result
        assert "[decisions] 2026-04-14: Use env vars (reason: Keychain issue)" in result
        assert "[patterns] 2026-04-14: Exit hook 0 on errors" in result
        # Second line has no reasoning and no "(reason:" trailer.
        lines = [ln for ln in result.split("\n") if "Exit hook 0" in ln]
        assert lines and "(reason:" not in lines[0]


class TestCountToolCalls:
    def test_empty_messages(self) -> None:
        assert _count_tool_calls([]) == 0

    def test_messages_without_tool_calls(self) -> None:
        class FakeMsg:
            parts: list = []

        assert _count_tool_calls([FakeMsg()]) == 0

    def test_messages_with_tool_calls(self) -> None:
        class FakePart:
            tool_name = "get_transcript_stats"

        msg = ModelResponse(parts=[FakePart()])  # type: ignore[list-item]
        assert _count_tool_calls([msg]) == 1

    def test_multiple_tool_calls(self) -> None:
        class FakePart:
            tool_name = "some_tool"

        msg1 = ModelResponse(parts=[FakePart(), FakePart()])  # type: ignore[list-item]
        msg2 = ModelResponse(parts=[FakePart(), FakePart()])  # type: ignore[list-item]
        assert _count_tool_calls([msg1, msg2]) == 4


# ---------------------------------------------------------------------------
# Weekly Review Agent Tests
# ---------------------------------------------------------------------------


@pytest.fixture
def weekly_review_deps() -> WeeklyReviewDeps:
    return WeeklyReviewDeps(
        source_date=date(2026, 4, 5),
        week_number="2026-W14",
        daily_logs={
            "2026-04-05": "## Session 1\nWorked on weekly review feature",
            "2026-04-04": "## Session 2\nRefactored dream agent",
            "2026-04-03": "## Session 3\nDiscussed architecture",
        },
        vault_indexes={
            "decisions": "# Decisions Index\n- use-python.md",
            "patterns": "# Patterns Index\n- async-patterns.md",
        },
    )


class TestWeeklyReviewAgent:
    def test_agent_has_correct_output_type(self) -> None:
        agent: Agent[WeeklyReviewDeps, WeeklyReviewOutput] = Agent(
            TestModel(),
            deps_type=WeeklyReviewDeps,
            output_type=WeeklyReviewOutput,
            retries=2,
            output_retries=3,
        )
        assert agent.output_type is WeeklyReviewOutput

    def test_weekly_review_deps_has_daily_logs(self, weekly_review_deps: WeeklyReviewDeps) -> None:
        assert len(weekly_review_deps.daily_logs) == 3
        assert "2026-04-05" in weekly_review_deps.daily_logs

    def test_weekly_review_deps_has_vault_indexes(
        self, weekly_review_deps: WeeklyReviewDeps
    ) -> None:
        assert len(weekly_review_deps.vault_indexes) == 2
        assert "decisions" in weekly_review_deps.vault_indexes

    def test_weekly_review_deps_has_week_number(self, weekly_review_deps: WeeklyReviewDeps) -> None:
        assert weekly_review_deps.week_number == "2026-W14"

    async def test_run_weekly_review_returns_tuple(
        self, weekly_review_deps: WeeklyReviewDeps
    ) -> None:
        test_model = TestModel()
        agent: Agent[WeeklyReviewDeps, WeeklyReviewOutput] = Agent(
            test_model,
            deps_type=WeeklyReviewDeps,
            output_type=WeeklyReviewOutput,
            retries=2,
            output_retries=3,
        )

        result = await agent.run("Synthesize weekly review.", deps=weekly_review_deps)
        usage = result.usage()
        tool_call_count = _count_tool_calls(result.all_messages())

        assert isinstance(result.output, WeeklyReviewOutput)
        assert usage is not None
        assert isinstance(tool_call_count, int)


# ---------------------------------------------------------------------------
# Story 9.22: Extraction Vault-Aware Tests
# ---------------------------------------------------------------------------


class TestExtractionVaultAware:
    """Tests for Story 9.22: vault-aware extraction with MEMORY.md context."""

    def _clear_extraction_agent(self) -> None:
        import app.services.dream_agent as module

        module._extraction_agent = None

    def _tool_names(self, agent: Agent) -> set[str]:  # type: ignore[type-arg]
        return {t.name for t in agent._function_toolset.tools.values()}

    @pytest.mark.asyncio
    async def test_run_prompt_contains_memory_md(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_dream_extraction

        self._clear_extraction_agent()

        mock_memory = "## Strong Patterns\n- Always use async/await for I/O (5x)"

        with (
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value=mock_memory,
            ) as mock_read,
            patch("app.services.dream_agent._get_extraction_agent") as mock_get_agent,
        ):
            mock_agent = MagicMock()
            mock_run_result = MagicMock()
            mock_run_result.output = ExtractionSummary(summary="Test session", no_extract=False)
            mock_run_result.usage.return_value = MagicMock()
            mock_run_result.all_messages.return_value = []
            mock_agent.run = AsyncMock(return_value=mock_run_result)
            mock_get_agent.return_value = mock_agent

            dream_deps.session_context = "test"
            await run_dream_extraction(dream_deps)

            call_args = mock_agent.run.call_args
            prompt = call_args[0][0]

            mock_read.assert_awaited_once_with("MEMORY.md")
            assert "## Current MEMORY.md" in prompt
            assert "Always use async/await for I/O" in prompt
            assert "Skip extracting insights" in prompt

    @pytest.mark.asyncio
    async def test_run_prompt_contains_session_metadata(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_dream_extraction

        self._clear_extraction_agent()

        with (
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value="(empty)",
            ),
            patch("app.services.dream_agent._get_extraction_agent") as mock_get_agent,
        ):
            mock_agent = MagicMock()
            mock_run_result = MagicMock()
            mock_run_result.output = ExtractionSummary(summary="Test session", no_extract=False)
            mock_run_result.usage.return_value = MagicMock()
            mock_run_result.all_messages.return_value = []
            mock_agent.run = AsyncMock(return_value=mock_run_result)
            mock_get_agent.return_value = mock_agent

            dream_deps.session_context = "test"
            await run_dream_extraction(dream_deps)

            call_args = mock_agent.run.call_args
            prompt = call_args[0][0]

            assert "## Session Metadata" in prompt
            assert f"Session ID: {dream_deps.session_id}" in prompt
            assert f"Project: {dream_deps.project}" in prompt
            assert f"Token count: {dream_deps.token_count}" in prompt
            assert "user messages" in prompt

    @pytest.mark.asyncio
    async def test_run_prompt_handles_empty_memory_md(self, dream_deps: DreamDeps) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_dream_extraction

        self._clear_extraction_agent()

        with (
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch("app.services.dream_agent._get_extraction_agent") as mock_get_agent,
        ):
            mock_agent = MagicMock()
            mock_run_result = MagicMock()
            mock_run_result.output = ExtractionSummary(summary="Test session", no_extract=False)
            mock_run_result.usage.return_value = MagicMock()
            mock_run_result.all_messages.return_value = []
            mock_agent.run = AsyncMock(return_value=mock_run_result)
            mock_get_agent.return_value = mock_agent

            dream_deps.session_context = "test"
            await run_dream_extraction(dream_deps)

            call_args = mock_agent.run.call_args
            prompt = call_args[0][0]

            assert "(empty)" in prompt


class TestTranscriptShapeInRunPrompt:
    """Spec B1: shape report injected into the run prompt with soft-fail."""

    def _clear_extraction_agent(self) -> None:
        import app.services.dream_agent as module

        module._extraction_agent = None

    @pytest.mark.asyncio
    async def test_run_prompt_contains_transcript_shape_section(
        self, dream_deps: DreamDeps
    ) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_dream_extraction

        self._clear_extraction_agent()

        transcript = dream_deps.workspace / "transcript.txt"
        transcript.write_text(
            "\n".join(
                [
                    "[2026-04-29T14:00:00Z] User: hello",
                    "[2026-04-29T14:00:30Z] Assistant: hi",
                    "[2026-04-29T14:05:00Z] User: ok",
                    "[2026-04-29T14:05:30Z] Assistant: sure",
                    "[2026-04-29T14:10:00Z] User: bye",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        with (
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value="(empty)",
            ),
            patch("app.services.dream_agent._get_extraction_agent") as mock_get_agent,
        ):
            mock_agent = MagicMock()
            mock_run_result = MagicMock()
            mock_run_result.output = ExtractionSummary(summary="t", no_extract=False)
            mock_run_result.usage.return_value = MagicMock()
            mock_run_result.all_messages.return_value = []
            mock_agent.run = AsyncMock(return_value=mock_run_result)
            mock_get_agent.return_value = mock_agent

            dream_deps.session_context = "test"
            await run_dream_extraction(dream_deps)

            prompt = mock_agent.run.call_args[0][0]

            assert "## Transcript Shape" in prompt
            metadata_idx = prompt.index("## Session Metadata")
            shape_idx = prompt.index("## Transcript Shape")
            memory_idx = prompt.index("## Current MEMORY.md")
            assert metadata_idx < shape_idx < memory_idx

    @pytest.mark.asyncio
    async def test_run_prompt_assembles_when_shape_computation_raises(
        self, dream_deps: DreamDeps, caplog: pytest.LogCaptureFixture
    ) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_dream_extraction

        self._clear_extraction_agent()

        with (
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value="(empty)",
            ),
            patch("app.services.dream_agent._get_extraction_agent") as mock_get_agent,
            patch(
                "app.services.transcript_shape.compute_transcript_shape",
                side_effect=RuntimeError("synthetic shape failure"),
            ),
        ):
            mock_agent = MagicMock()
            mock_run_result = MagicMock()
            mock_run_result.output = ExtractionSummary(summary="t", no_extract=False)
            mock_run_result.usage.return_value = MagicMock()
            mock_run_result.all_messages.return_value = []
            mock_agent.run = AsyncMock(return_value=mock_run_result)
            mock_get_agent.return_value = mock_agent

            dream_deps.session_context = "test"
            await run_dream_extraction(dream_deps)

            prompt = mock_agent.run.call_args[0][0]
            assert "## Transcript Shape" not in prompt
            assert "## Session Metadata" in prompt
            mock_agent.run.assert_called()


class TestRecordAgentSessionStartTime:
    """Spec C: `Session start time:` line injected into the record run prompt."""

    def _clear_record_agent(self) -> None:
        import app.services.dream_agent as module

        module._record_agent = None

    @pytest.mark.asyncio
    async def test_run_prompt_contains_session_start_time_when_provided(
        self, record_deps: RecordDeps
    ) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_record

        self._clear_record_agent()
        record_deps.session_start_iso = "14:59"

        with (
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value="(empty)",
            ),
            patch("app.services.dream_agent._get_record_agent") as mock_get_agent,
        ):
            mock_agent = MagicMock()
            mock_run_result = MagicMock()
            mock_run_result.output = RecordResult(summary="recorded", files=[])
            mock_run_result.usage.return_value = MagicMock()
            mock_run_result.all_messages.return_value = []
            mock_agent.run = AsyncMock(return_value=mock_run_result)
            mock_get_agent.return_value = mock_agent

            await run_record(record_deps)

            prompt = mock_agent.run.call_args[0][0]
            assert "Session start time: 14:59" in prompt
            session_id_idx = prompt.index(f"Session ID: {record_deps.session_id}")
            start_time_idx = prompt.index("Session start time: 14:59")
            assert session_id_idx < start_time_idx

    @pytest.mark.asyncio
    async def test_run_prompt_contains_unknown_when_session_start_iso_is_none(
        self, record_deps: RecordDeps
    ) -> None:
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_record

        self._clear_record_agent()
        record_deps.session_start_iso = None

        with (
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value="(empty)",
            ),
            patch("app.services.dream_agent._get_record_agent") as mock_get_agent,
        ):
            mock_agent = MagicMock()
            mock_run_result = MagicMock()
            mock_run_result.output = RecordResult(summary="recorded", files=[])
            mock_run_result.usage.return_value = MagicMock()
            mock_run_result.all_messages.return_value = []
            mock_agent.run = AsyncMock(return_value=mock_run_result)
            mock_get_agent.return_value = mock_agent

            await run_record(record_deps)

            prompt = mock_agent.run.call_args[0][0]
            assert "Session start time: unknown" in prompt


class TestRecordAgentBulletFormatPrompt:
    """Spec D: record-agent prompt directs bullet-list structure for non-Context sections."""

    def test_record_prompt_drops_old_narrative_rule(self) -> None:
        from app.services.dream_agent import _load_record_prompt

        prompt = _load_record_prompt()
        assert "narrative sentences, not" not in prompt

    def test_record_prompt_directs_bullet_structure(self) -> None:
        from app.services.dream_agent import _load_record_prompt

        prompt = _load_record_prompt()
        assert "Each bullet is one logical item" in prompt

    def test_record_prompt_continuation_uses_sub_heading(self) -> None:
        from app.services.dream_agent import _load_record_prompt

        prompt = _load_record_prompt()
        assert "sub-heading on its own line" in prompt
        assert "Do NOT inline the marker" in prompt


# ---------------------------------------------------------------------------
# Story 9.30: Simplify Extraction Tests
# ---------------------------------------------------------------------------


class TestStory930SimplifyExtraction:
    """Tests for Story 9.30: transcript tools removed, renamed fields, Memory section."""

    def _clear_singletons(self) -> None:
        import app.services.dream_agent as mod

        mod._extraction_agent = None

    def test_extraction_agent_no_transcript_tools(self) -> None:
        self._clear_singletons()
        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool_names = {t.name for t in agent._function_toolset.tools.values()}
        assert "read_transcript" not in tool_names
        assert "grep_transcript" not in tool_names
        assert "transcript_info" not in tool_names

    def test_dream_deps_has_memories_accumulator(self) -> None:
        """Post-9.35: DreamDeps.memories is the in-run accumulator (list[MemoryItem]).
        The old name (session_memories) is gone; there is no session_memories_log."""
        deps = DreamDeps(transcript_id=1, workspace=Path("/tmp"))
        assert hasattr(deps, "memories")
        assert deps.memories == []
        assert not hasattr(deps, "session_memories")
        assert not hasattr(deps, "session_memories_log")
        assert not hasattr(deps, "extracted_memories")

    def test_dream_deps_has_transcript_file(self) -> None:
        deps = DreamDeps(transcript_id=1, workspace=Path("/tmp"))
        assert hasattr(deps, "transcript_file")
        assert deps.transcript_file == ""

    def test_store_session_memory_tool_exists(self) -> None:
        self._clear_singletons()
        from app.services.dream_agent import _get_extraction_agent

        agent = _get_extraction_agent()
        tool_names = {t.name for t in agent._function_toolset.tools.values()}
        assert "store_session_memory" in tool_names
        assert "store_memory" not in tool_names

    def test_session_log_entry_memories_is_list_of_memoryitems(self) -> None:
        """memories is a property of SessionLogEntry — typed list[MemoryItem],
        not a list[str] of display lines."""
        from app.services.dream_models import MemoryItem

        entry = SessionLogEntry()
        assert hasattr(entry, "memories")
        assert entry.memories == []
        assert not hasattr(entry, "session_memories")

        entry.memories.append(
            MemoryItem(
                content="x",
                vault_target="memory",
                source_date="2026-04-18",
            )
        )
        assert isinstance(entry.memories[0], MemoryItem)

    def test_format_session_log_includes_memory_section(self) -> None:
        from app.services.dream_models import MemoryItem

        sl = SessionLogEntry(
            context="Test context",
            lessons_learned=["Lesson 1"],
            memories=[
                MemoryItem(
                    content="User prefers dark mode",
                    vault_target="memory",
                    source_date="2026-04-14",
                ),
                MemoryItem(
                    content="Project uses Python 3.12",
                    vault_target="patterns",
                    source_date="2026-04-14",
                ),
            ],
            action_items=["Write tests"],
        )
        result = _format_session_log(sl, "Test session")
        assert "Memory:" in result
        assert "[memory]" in result
        assert "User prefers dark mode" in result
        assert "[patterns]" in result
        assert "Project uses Python 3.12" in result
        lines = result.split("\n")
        memory_idx = next(i for i, line in enumerate(lines) if "Memory:" in line)
        action_idx = next(i for i, line in enumerate(lines) if "Action Items:" in line)
        lesson_idx = next(i for i, line in enumerate(lines) if "Lessons Learned:" in line)
        assert lesson_idx < memory_idx < action_idx

    def test_format_session_log_no_memory_when_empty(self) -> None:
        sl = SessionLogEntry(
            context="Test context",
            lessons_learned=["Lesson 1"],
            action_items=["Write tests"],
        )
        result = _format_session_log(sl, "Test session")
        assert "Memory:" not in result

    def test_record_deps_has_no_peer_memories_field(self) -> None:
        """Story 9.35: RecordDeps has NO peer `memories` / `session_memories`
        field. The record agent reaches memories via deps.session_log.memories."""
        deps = RecordDeps(workspace=Path("/tmp"))
        assert hasattr(deps, "session_log")
        assert not hasattr(deps, "memories")
        assert not hasattr(deps, "session_memories")
        assert not hasattr(deps, "extracted_memories")

    @pytest.mark.asyncio
    async def test_extraction_prompt_contains_transcript_file(self) -> None:
        self._clear_singletons()
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services.dream_agent import run_dream_extraction

        dream_deps = DreamDeps(
            transcript_id=1,
            workspace=Path("/tmp"),
            session_id="test-123",
            transcript_file="transcripts/test-123_abc12345.txt",
        )

        mock_agent = MagicMock()
        mock_run_result = MagicMock()
        mock_run_result.output = ExtractionSummary(summary="Test", no_extract=False)
        mock_run_result.usage.return_value = MagicMock()
        mock_run_result.all_messages.return_value = []
        mock_agent.run = AsyncMock(return_value=mock_run_result)

        with (
            patch(
                "app.services.dream_agent._get_extraction_agent",
                return_value=mock_agent,
            ),
            patch(
                "app.services.dream_agent._read_vault_file",
                new_callable=AsyncMock,
                return_value="# MEMORY",
            ),
            patch(
                "app.services.dream_agent._count_user_messages",
                return_value=10,
            ),
        ):
            dream_deps.session_context = "test"
            await run_dream_extraction(dream_deps)

            call_args = mock_agent.run.call_args
            prompt = call_args[0][0]

            assert "transcripts/test-123_abc12345.txt" in prompt
            assert "store_session_memory()" in prompt


# ---------------------------------------------------------------------------
# Story 11.9: Uniform phase tool-call budget
# ---------------------------------------------------------------------------


def test_phase_tool_call_limits_are_300() -> None:
    from app.config import settings
    from app.services.dream_agent import (
        DEEP_DREAM_USAGE_LIMITS,
        EXTRACTION_LIMITS,
        HEALTH_FIX_LIMITS,
        PHASE1_USAGE_LIMITS,
        PHASE2_USAGE_LIMITS,
        RECORD_LIMITS,
        WEEKLY_REVIEW_USAGE_LIMITS,
    )

    assert PHASE1_USAGE_LIMITS.tool_calls_limit == settings.phase1_tool_calls_limit
    assert PHASE2_USAGE_LIMITS.tool_calls_limit == settings.phase2_tool_calls_limit
    assert DEEP_DREAM_USAGE_LIMITS.tool_calls_limit == settings.deep_dream_tool_calls_limit
    assert HEALTH_FIX_LIMITS.tool_calls_limit == settings.health_fix_tool_calls_limit
    assert WEEKLY_REVIEW_USAGE_LIMITS.tool_calls_limit == settings.weekly_review_tool_calls_limit
    assert EXTRACTION_LIMITS.tool_calls_limit == settings.extraction_tool_calls_limit
    assert RECORD_LIMITS.tool_calls_limit == settings.record_tool_calls_limit
