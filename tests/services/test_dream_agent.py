from datetime import date, datetime
from pathlib import Path

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.test import TestModel

from app.services.dream_agent import (
    DeepDreamDeps,
    DreamDeps,
    _count_tool_calls,
    consolidation_to_dict,
)
from app.services.dream_models import (
    ConsolidationOutput,
    ConsolidationStats,
    ExtractionSummary,
    SessionLogEntry,
    VaultFileEntry,
    VaultUpdates,
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

    def test_session_log_assembly_includes_new_fields(
        self, dream_deps: DreamDeps
    ) -> None:
        dream_deps.session_context = "Discussed architecture patterns"
        dream_deps.session_key_exchanges = ["User asked about DDD vs Clean Arch"]
        dream_deps.session_decisions = ["Use Clean Architecture"]
        dream_deps.session_lessons = ["Layered boundaries reduce coupling"]
        dream_deps.session_action_items = ["Document the architecture"]
        dream_deps.session_concepts = [
            {"name": "DDD", "description": "Domain-Driven Design"}
        ]
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
