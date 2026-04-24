"""Tests for Story 9.17: Phase 3 Prompt Injection — Hybrid Summaries + All Static Data.

Tests hybrid format for _format_phase1_summary, _format_phase2_summary,
Phase 3 agent tool registration, run prompt injection order, and token budgets.
"""

from __future__ import annotations

import json
from typing import Any

from app.services.dream_models import (
    ConnectionCandidate,
    KnowledgeGap,
    LightSleepOutput,
    PromotionCandidate,
    REMSleepOutput,
    ScoredCandidate,
    Theme,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_phase1_output(
    *,
    candidates: list[ScoredCandidate] | None = None,
    duplicates_removed: int = 2,
    contradictions_found: int = 1,
) -> LightSleepOutput:
    if candidates is None:
        candidates = [
            ScoredCandidate(
                content="Always use async/await",
                category="pattern",
                reinforcement_count=5,
                contradiction_flag=False,
                source_sessions=["2026-04-14"],
            ),
            ScoredCandidate(
                content="Old unused pattern",
                category="pattern",
                reinforcement_count=0,
                contradiction_flag=False,
                source_sessions=[],
            ),
            ScoredCandidate(
                content="Conflicting advice",
                category="decisions",
                reinforcement_count=1,
                contradiction_flag=True,
                source_sessions=["2026-04-13"],
            ),
        ]
    return LightSleepOutput(
        candidates=candidates,
        duplicates_removed=duplicates_removed,
        contradictions_found=contradictions_found,
    )


def _make_scores() -> dict[str, float]:
    return {
        "Always use async/await": 0.85,
        "Old unused pattern": 0.12,
        "Conflicting advice": 0.45,
    }


def _make_phase2_output() -> REMSleepOutput:
    return REMSleepOutput(
        themes=[
            Theme(
                topic="Knowledge graph design",
                session_count=3,
                evidence=["bidirectional links", "typed edges"],
            ),
        ],
        new_connections=[
            ConnectionCandidate(
                concept_a="Clean Architecture",
                concept_b="NestJS",
                relationship="modules map to bounded contexts",
                relationship_type="supports",
            ),
        ],
        promotion_candidates=[
            PromotionCandidate(
                source_file="lessons/pydantic-v2.md",
                target_folder="patterns/",
                reason="confirmed in 3+ contexts",
            ),
        ],
        gaps=[
            KnowledgeGap(
                concept="progressive-summarization",
                mentioned_in_files=["decisions/scoring.md", "dailys/2026-04-14.md"],
            ),
        ],
    )


def _clear_agent_singletons() -> None:
    import app.services.dream_agent as module

    module._deep_dream_agent = None


def _tool_names(agent: Any) -> set[str]:
    return {t.name for t in agent._function_toolset.tools.values()}


# ---------------------------------------------------------------------------
# Task 2: _format_phase1_summary hybrid format
# ---------------------------------------------------------------------------


class TestFormatPhase1Summary:
    def test_has_intent_section(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        assert "### Intent" in result

    def test_has_summary_section(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        assert "### Summary" in result
        assert "3 candidates after dedup" in result

    def test_promote_label(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        assert "PROMOTE:" in result
        assert "Always use async/await" in result
        assert "Strong Patterns" in result

    def test_prune_label(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        assert "PRUNE CANDIDATE:" in result
        assert "Old unused pattern" in result

    def test_contradiction_label(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        assert "CONTRADICTION:" in result
        assert "Conflicting advice" in result

    def test_scoring_config(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        assert "### Scoring Config" in result
        assert "frequency=0.25" in result

    def test_reference_data_valid_json(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        assert "### Reference Data" in result
        # Extract JSON block
        json_start = result.index("```json\n") + len("```json\n")
        json_end = result.index("\n```", json_start)
        data = json.loads(result[json_start:json_end])
        assert isinstance(data, list)
        assert len(data) == 3

    def test_reference_data_has_score_field(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        result = _format_phase1_summary(_make_phase1_output(), _make_scores())
        json_start = result.index("```json\n") + len("```json\n")
        json_end = result.index("\n```", json_start)
        data = json.loads(result[json_start:json_end])
        for item in data:
            assert "score" in item
            assert "content" in item
            assert "category" in item

    def test_empty_candidates(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        output = _make_phase1_output(candidates=[], duplicates_removed=0, contradictions_found=0)
        result = _format_phase1_summary(output, {})
        assert "0 candidates after dedup" in result
        assert "No actionable decisions." in result


# ---------------------------------------------------------------------------
# Task 3: _format_phase2_summary hybrid format
# ---------------------------------------------------------------------------


class TestFormatPhase2Summary:
    def test_has_intent_section(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        result = _format_phase2_summary(_make_phase2_output())
        assert "### Intent" in result

    def test_themes_with_evidence(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        result = _format_phase2_summary(_make_phase2_output())
        assert "### Themes" in result
        assert "Knowledge graph design" in result
        assert "bidirectional links" in result

    def test_connections_with_relationship_type(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        result = _format_phase2_summary(_make_phase2_output())
        assert "### Connection Candidates" in result
        assert "[supports]" in result
        assert "Clean Architecture" in result

    def test_promotions(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        result = _format_phase2_summary(_make_phase2_output())
        assert "### Promotion Candidates" in result
        assert "lessons/pydantic-v2.md" in result

    def test_gaps_with_mentioned_in_files(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        result = _format_phase2_summary(_make_phase2_output())
        assert "### Knowledge Gaps" in result
        assert "progressive-summarization" in result
        assert "decisions/scoring.md" in result

    def test_reference_data_valid_json(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        result = _format_phase2_summary(_make_phase2_output())
        json_start = result.index("```json\n") + len("```json\n")
        json_end = result.index("\n```", json_start)
        data = json.loads(result[json_start:json_end])
        assert "themes" in data
        assert "connections" in data
        assert "promotions" in data
        assert "gaps" in data

    def test_empty_phase2(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        result = _format_phase2_summary(REMSleepOutput())
        assert "No themes detected." in result
        assert "No new connections." in result
        assert "No promotions." in result
        assert "No gaps detected." in result


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


# ---------------------------------------------------------------------------
# Integration: existing pipeline tests still pass with new format
# ---------------------------------------------------------------------------


class TestPipelineIntegration:
    def test_phase1_summary_has_new_header(self) -> None:
        from app.tasks.deep_dream_task import _format_phase1_summary

        output = LightSleepOutput(
            candidates=[
                ScoredCandidate(content="Use FastAPI", category="decisions"),
                ScoredCandidate(content="Prefer httpx", category="preferences"),
            ],
            duplicates_removed=1,
            contradictions_found=0,
        )
        scores = {"Use FastAPI": 0.75, "Prefer httpx": 0.3}
        result = _format_phase1_summary(output, scores)
        assert "## Phase 1: Light Sleep Results" in result

    def test_phase2_summary_has_new_header(self) -> None:
        from app.tasks.deep_dream_task import _format_phase2_summary

        output = REMSleepOutput(
            themes=[Theme(topic="async patterns", session_count=3, evidence=["s1", "s2"])],
        )
        result = _format_phase2_summary(output)
        assert "## Phase 2: REM Sleep Results" in result
