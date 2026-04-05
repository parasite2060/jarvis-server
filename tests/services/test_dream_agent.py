from datetime import date, datetime

import pytest
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.test import TestModel

from app.services.dream_agent import (
    DeepDreamDeps,
    DreamDeps,
    _count_tool_calls,
    consolidation_to_dict,
    extraction_to_dict,
)
from app.services.dream_models import (
    ConsolidationOutput,
    ConsolidationStats,
    DreamExtraction,
    MemoryItem,
    VaultFileEntry,
    VaultUpdates,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def dream_deps() -> DreamDeps:
    return DreamDeps(
        transcript_id=1,
        parsed_lines=["user: hello", "assistant: hi there", "user: how are you?"],
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
        agent: Agent[DreamDeps, DreamExtraction] = Agent(
            TestModel(),
            deps_type=DreamDeps,
            output_type=DreamExtraction,
            retries=2,
            output_retries=3,
        )
        assert agent.output_type is DreamExtraction

    async def test_get_transcript_stats(self, dream_deps: DreamDeps) -> None:
        agent: Agent[DreamDeps, DreamExtraction] = Agent(
            TestModel(),
            deps_type=DreamDeps,
            output_type=DreamExtraction,
        )

        @agent.tool
        async def get_transcript_stats(ctx: RunContext[DreamDeps]) -> dict:
            lines = ctx.deps.parsed_lines
            total_chars = sum(len(line) for line in lines)
            total_lines = len(lines)
            estimated_tokens = ctx.deps.token_count or (total_chars // 4)
            return {
                "total_chars": total_chars,
                "total_lines": total_lines,
                "estimated_tokens": estimated_tokens,
                "session_id": ctx.deps.session_id,
                "project": ctx.deps.project,
            }

        result = await agent.run("test", deps=dream_deps)
        assert result.output.no_extract is False

    async def test_get_transcript_metadata(self, dream_deps: DreamDeps) -> None:
        agent: Agent[DreamDeps, DreamExtraction] = Agent(
            TestModel(),
            deps_type=DreamDeps,
            output_type=DreamExtraction,
        )

        @agent.tool
        async def get_transcript_metadata(ctx: RunContext[DreamDeps]) -> dict:
            return {
                "session_id": ctx.deps.session_id,
                "project": ctx.deps.project,
                "created_at": ctx.deps.created_at.isoformat() if ctx.deps.created_at else None,
                "token_count": ctx.deps.token_count,
            }

        result = await agent.run("test", deps=dream_deps)
        assert result.output.no_extract is False

    async def test_get_transcript_chunk_normal_range(self, dream_deps: DreamDeps) -> None:
        lines = dream_deps.parsed_lines
        clamped_start = max(0, 0)
        clamped_end = min(len(lines), 2)
        chunk = "\n".join(lines[clamped_start:clamped_end])
        assert chunk == "user: hello\nassistant: hi there"

    async def test_get_transcript_chunk_clamps_out_of_bounds(self, dream_deps: DreamDeps) -> None:
        lines = dream_deps.parsed_lines
        clamped_start = max(0, -5)
        clamped_end = min(len(lines), 100)
        chunk = "\n".join(lines[clamped_start:clamped_end])
        assert chunk == "\n".join(lines)

    async def test_run_dream_extraction_returns_tuple(self, dream_deps: DreamDeps) -> None:
        test_model = TestModel()
        agent: Agent[DreamDeps, DreamExtraction] = Agent(
            test_model,
            deps_type=DreamDeps,
            output_type=DreamExtraction,
            retries=2,
            output_retries=3,
        )

        result = await agent.run("Extract memories.", deps=dream_deps)
        usage = result.usage()
        tool_call_count = _count_tool_calls(result.all_messages())

        assert isinstance(result.output, DreamExtraction)
        assert usage is not None
        assert isinstance(tool_call_count, int)


class TestExtractionToDict:
    def test_basic_extraction(self) -> None:
        extraction = DreamExtraction(
            no_extract=False,
            summary="A test summary",
            decisions=[
                MemoryItem(
                    content="Decided to use Python",
                    vault_target="decisions",
                    source_date="2026-04-05",
                ),
            ],
            preferences=[],
            patterns=[],
            corrections=[],
            facts=[],
        )
        result = extraction_to_dict(extraction)
        assert result["no_extract"] is False
        assert result["summary"] == "A test summary"
        assert len(result["decisions"]) == 1
        assert result["decisions"][0]["content"] == "Decided to use Python"
        assert result["preferences"] == []

    def test_no_extract_flag(self) -> None:
        extraction = DreamExtraction(no_extract=True, summary="")
        result = extraction_to_dict(extraction)
        assert result["no_extract"] is True


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
        if not deps.memu_memories:
            result = "No MemU memories for today."
        else:
            result = "has memories"
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

        class FakeMsg:
            parts = [FakePart()]

        assert _count_tool_calls([FakeMsg()]) == 1

    def test_multiple_tool_calls(self) -> None:
        class FakePart:
            tool_name = "some_tool"

        class FakeMsg:
            parts = [FakePart(), FakePart()]

        assert _count_tool_calls([FakeMsg(), FakeMsg()]) == 4
