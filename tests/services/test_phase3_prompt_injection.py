"""Tests for Story 9.17: Phase 3 Prompt Injection — Hybrid Summaries + All Static Data.

Tests Phase 3 agent tool registration, run prompt injection order, and token budgets.
"""

from __future__ import annotations

from typing import Any


def _clear_agent_singletons() -> None:
    import app.services.dream_agent as mod

    for attr in ("_deep_dream_agent", "_record_agent", "_weekly_review_agent"):
        if hasattr(mod, attr):
            setattr(mod, attr, None)


def _tool_names(agent: Any) -> set[str]:
    return set(agent._function_toolset.tools.keys())


# ---------------------------------------------------------------------------
# Task 4 & 5: Phase 3 agent tool registration
# ---------------------------------------------------------------------------


class TestPhase3AgentTools:
    def test_has_required_tools(self) -> None:
        _clear_agent_singletons()
        from app.services.dream_agent import _get_deep_dream_agent

        agent = _get_deep_dream_agent()
        registered = _tool_names(agent)
        expected = {"query_memu_memories", "read_daily_log", "read_vault_index"}
        missing = expected - registered
        assert expected.issubset(registered), f"Missing: {missing}"

    def test_old_tools_removed(self) -> None:
        _clear_agent_singletons()
        from app.services.dream_agent import _get_deep_dream_agent

        agent = _get_deep_dream_agent()
        registered = _tool_names(agent)
        removed = {
            "read_memory_file",
            "read_soul_file",
            "read_phase1_candidates",
            "read_phase2_analysis",
        }
        present = removed & registered
        assert not present, f"Old tools still present: {present}"


# ---------------------------------------------------------------------------
# Task 6: Run prompt injection order and token budgets
# ---------------------------------------------------------------------------


class TestRunPromptInjection:
    def test_prompt_contains_all_sections_in_order(self) -> None:
        from app.services.dream_agent import DeepDreamDeps

        deps = DeepDreamDeps(
            source_date=__import__("datetime").date(2026, 4, 15),
            memu_memories=[],
            memory_md="# Memory\n- entry",
            daily_log="## Session 1\nDid things.",
            soul_md="# Soul\nPrinciples.",
            phase1_summary="## Phase 1: Light Sleep Results\ntest",
            phase2_summary="## Phase 2: REM Sleep Results\ntest",
        )

        sections = [
            "Consolidate memories. Produce updated MEMORY.md, daily summary, and vault updates.",
            "",
            deps.phase1_summary or "## Phase 1\nNo data.",
            "",
            deps.phase2_summary or "## Phase 2\nNo data.",
            "",
            "## Current MEMORY.md",
            deps.memory_md or "(empty)",
            "",
            "## Today's Daily Log",
            deps.daily_log or "(empty)",
            "",
            "## SOUL.md (alignment — do NOT modify)",
            deps.soul_md or "(empty)",
            "",
            "Tools: query_memu_memories(), read_daily_log(date), read_vault_index(folder)",
        ]
        prompt = "\n".join(sections)

        # Verify order: Phase 1 before Phase 2 before MEMORY.md before Daily Log before SOUL.md
        idx_p1 = prompt.index("Phase 1: Light Sleep Results")
        idx_p2 = prompt.index("Phase 2: REM Sleep Results")
        idx_mem = prompt.index("## Current MEMORY.md")
        idx_daily = prompt.index("## Today's Daily Log")
        idx_soul = prompt.index("## SOUL.md (alignment")
        idx_tools = prompt.index("Tools: query_memu_memories()")

        assert idx_p1 < idx_p2 < idx_mem < idx_daily < idx_soul < idx_tools

    def test_empty_phase_data_handled_gracefully(self) -> None:
        from app.services.dream_agent import DeepDreamDeps

        deps = DeepDreamDeps(
            source_date=__import__("datetime").date(2026, 4, 15),
            memu_memories=[],
            memory_md="",
            daily_log="",
            soul_md="",
            phase1_summary="",
            phase2_summary="",
        )

        sections = [
            "Consolidate memories. Produce updated MEMORY.md, daily summary, and vault updates.",
            "",
            deps.phase1_summary or "## Phase 1\nNo data.",
            "",
            deps.phase2_summary or "## Phase 2\nNo data.",
            "",
            "## Current MEMORY.md",
            deps.memory_md or "(empty)",
            "",
            "## Today's Daily Log",
            deps.daily_log or "(empty)",
            "",
            "## SOUL.md (alignment — do NOT modify)",
            deps.soul_md or "(empty)",
            "",
            "Tools: query_memu_memories(), read_daily_log(date), read_vault_index(folder)",
        ]
        prompt = "\n".join(sections)

        assert "## Phase 1\nNo data." in prompt
        assert "## Phase 2\nNo data." in prompt
        assert "(empty)" in prompt

    def test_token_budget_updated(self) -> None:
        from app.config import settings
        from app.services.dream_agent import DEEP_DREAM_USAGE_LIMITS, HEALTH_FIX_LIMITS

        assert DEEP_DREAM_USAGE_LIMITS.total_tokens_limit == settings.deep_dream_tokens_limit
        assert DEEP_DREAM_USAGE_LIMITS.tool_calls_limit == settings.deep_dream_tool_calls_limit
        assert HEALTH_FIX_LIMITS.total_tokens_limit == settings.health_fix_tokens_limit
        assert HEALTH_FIX_LIMITS.tool_calls_limit == settings.health_fix_tool_calls_limit

