"""Tests for Story 9.29: Weekly Review Prompt — Knowledge Lifecycle Focus.

Validates that the weekly_review_agent.md prompt contains the required
knowledge-lifecycle sections (Week Summary, Patterns Reinforced, New Knowledge,
Lifecycle Transitions) and that sections are ordered per the design doc.
"""

from __future__ import annotations

import re
from pathlib import Path

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "weekly_review_agent.md"


def _load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# AC 1: Week Summary section
# ---------------------------------------------------------------------------


class TestWeekSummarySection:
    def test_section_in_output_format(self) -> None:
        prompt = _load_prompt()
        assert "## Week Summary" in prompt

    def test_narrative_sentences_guidance(self) -> None:
        prompt = _load_prompt()
        assert "2-3 narrative sentences" in prompt or "2-3 sentences" in prompt


# ---------------------------------------------------------------------------
# AC 2: Patterns Reinforced section
# ---------------------------------------------------------------------------


class TestPatternsReinforcedSection:
    def test_section_in_output_format(self) -> None:
        prompt = _load_prompt()
        assert "## Patterns Reinforced" in prompt

    def test_reinforcement_count_guidance(self) -> None:
        prompt = _load_prompt()
        assert "reinforcement_count" in prompt

    def test_wiki_link_guidance(self) -> None:
        prompt = _load_prompt()
        assert "[[patterns/" in prompt

    def test_promotion_threshold_guidance(self) -> None:
        prompt = _load_prompt()
        assert "draft to active" in prompt or "draft -> active" in prompt


# ---------------------------------------------------------------------------
# AC 3: New Knowledge section
# ---------------------------------------------------------------------------


class TestNewKnowledgeSection:
    def test_section_in_output_format(self) -> None:
        prompt = _load_prompt()
        assert "## New Knowledge" in prompt

    def test_categorized_by_type(self) -> None:
        prompt = _load_prompt()
        assert "concept" in prompt.lower()
        assert "connection" in prompt.lower()
        assert "lesson" in prompt.lower()

    def test_format_guidance(self) -> None:
        prompt = _load_prompt()
        assert "**Type**" in prompt or "**Concept**" in prompt


# ---------------------------------------------------------------------------
# AC 4: Lifecycle Transitions section
# ---------------------------------------------------------------------------


class TestLifecycleTransitionsSection:
    def test_section_in_output_format(self) -> None:
        prompt = _load_prompt()
        assert "## Lifecycle Transitions" in prompt

    def test_transition_format(self) -> None:
        prompt = _load_prompt()
        assert "draft -> active" in prompt or "draft → active" in prompt

    def test_status_change_guidance(self) -> None:
        prompt = _load_prompt()
        has_guidance = (
            "old_status" in prompt
            or "changed lifecycle state" in prompt
        )
        assert has_guidance


# ---------------------------------------------------------------------------
# AC 5: Section order matches design doc
# ---------------------------------------------------------------------------


class TestSectionOrder:
    """Verify output format section order:
    Week Summary -> Patterns Reinforced -> New Knowledge ->
    Lifecycle Transitions -> Themes -> Open Action Items -> Stale Action Items
    """

    def test_output_format_section_order(self) -> None:
        prompt = _load_prompt()
        # Find positions within the output format template block
        sections = [
            "## Week Summary",
            "## Patterns Reinforced",
            "## New Knowledge",
            "## Lifecycle Transitions",
            "## Themes",
            "## Open Action Items",
            "## Stale Action Items",
        ]
        positions = []
        for section in sections:
            pos = prompt.find(section)
            assert pos != -1, f"Section '{section}' not found in prompt"
            positions.append(pos)

        for i in range(len(positions) - 1):
            assert positions[i] < positions[i + 1], (
                f"Section '{sections[i]}' (pos {positions[i]}) should appear "
                f"before '{sections[i + 1]}' (pos {positions[i + 1]})"
            )

    def test_all_seven_sections_in_template_block(self) -> None:
        prompt = _load_prompt()
        # Extract the output format code block
        template_match = re.search(
            r"Structure your review_content as:\s*```(.*?)```",
            prompt,
            re.DOTALL,
        )
        assert template_match is not None, "Output format template block not found"
        template = template_match.group(1)

        expected = [
            "## Week Summary",
            "## Patterns Reinforced",
            "## New Knowledge",
            "## Lifecycle Transitions",
            "## Themes",
            "## Open Action Items",
            "## Stale Action Items",
        ]
        for section in expected:
            assert section in template, f"'{section}' missing from output format template block"


# ---------------------------------------------------------------------------
# Example output validation
# ---------------------------------------------------------------------------


class TestExampleOutput:
    def test_example_section_exists(self) -> None:
        prompt = _load_prompt()
        assert "## Example Output" in prompt

    def test_example_has_week_summary(self) -> None:
        prompt = _load_prompt()
        assert "This week focused on" in prompt

    def test_example_has_patterns_with_counts(self) -> None:
        prompt = _load_prompt()
        assert "reinforced to 5x" in prompt

    def test_example_has_new_knowledge_categorized(self) -> None:
        prompt = _load_prompt()
        assert "**Concept**:" in prompt or "**Concept**: Row Level Security" in prompt

    def test_example_has_lifecycle_transitions(self) -> None:
        prompt = _load_prompt()
        assert "draft -> **active**" in prompt
