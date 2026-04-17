"""Tests for Story 9.28: Record Agent Prompt — Daily Log Detail Level.

Validates that the record_agent.md prompt contains the required
'Writing Style: Technical Detail' guidance section, backtick/code-block
instructions, and a realistic example with inline code references.
"""

from __future__ import annotations

from pathlib import Path

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "record_agent.md"


def _load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# AC 1-4: Technical Detail guidance section exists
# ---------------------------------------------------------------------------


class TestTechnicalDetailSection:
    def test_section_heading_exists(self) -> None:
        prompt = _load_prompt()
        assert "## Writing Style: Technical Detail" in prompt

    def test_code_references_guidance(self) -> None:
        prompt = _load_prompt()
        assert "Use backticks for function names" in prompt
        assert "`createServerClient`" in prompt

    def test_code_blocks_guidance(self) -> None:
        prompt = _load_prompt()
        assert "Include code blocks when the session discussed" in prompt
        assert "```typescript" in prompt or "```sql" in prompt or "```bash" in prompt

    def test_decisions_x_over_y_because_z(self) -> None:
        prompt = _load_prompt()
        assert "X over Y because Z" in prompt

    def test_lessons_gotcha_guidance(self) -> None:
        prompt = _load_prompt()
        assert "exact gotcha" in prompt or "what code/behavior was unexpected" in prompt

    def test_key_exchanges_specificity(self) -> None:
        prompt = _load_prompt()
        assert 'not "discussed architecture options"' in prompt or (
            "Discussed Next.js App Router vs Pages Router" in prompt
        )

    def test_anti_generic_guidance(self) -> None:
        prompt = _load_prompt()
        assert "Do NOT write generic summaries" in prompt
        assert "`create-next-app`" in prompt


# ---------------------------------------------------------------------------
# AC 5: Realistic example with inline code references
# ---------------------------------------------------------------------------


class TestRealisticExample:
    def test_example_section_exists(self) -> None:
        prompt = _load_prompt()
        assert "### Example: Detailed Session Block" in prompt

    def test_example_has_inline_code(self) -> None:
        prompt = _load_prompt()
        # The example must contain actual backtick-wrapped code references
        assert "`createServerClient`" in prompt
        assert "`createBrowserClient`" in prompt

    def test_example_has_code_block(self) -> None:
        prompt = _load_prompt()
        # The example must include a code block (folder structure)
        assert "src/" in prompt
        assert "components/" in prompt

    def test_example_has_decision_with_rationale(self) -> None:
        prompt = _load_prompt()
        # "X over Y" pattern in decisions
        assert "App Router over Pages Router" in prompt or (
            "Next.js App Router over Pages Router" in prompt
        )

    def test_example_has_specific_lesson(self) -> None:
        prompt = _load_prompt()
        assert "`@supabase/ssr`" in prompt
        assert "cookie adapter" in prompt or "cookies()" in prompt

    def test_example_has_file_path_references(self) -> None:
        prompt = _load_prompt()
        assert "`app/auth/callback/route.ts`" in prompt


# ---------------------------------------------------------------------------
# Story 9.34: Reasoning in Daily Log Entries
# ---------------------------------------------------------------------------


class TestReasoningGuidance:
    def test_reasoning_section_exists(self) -> None:
        prompt = _load_prompt()
        assert "## Reasoning in Daily Log Entries" in prompt

    def test_decisions_revisit_if(self) -> None:
        prompt = _load_prompt()
        assert "Revisit if" in prompt

    def test_lessons_why_this_matters(self) -> None:
        prompt = _load_prompt()
        assert "Why this matters" in prompt

    def test_lessons_watch_for(self) -> None:
        prompt = _load_prompt()
        assert "Watch for" in prompt

    def test_memory_matters_because(self) -> None:
        prompt = _load_prompt()
        assert "Matters because" in prompt

    def test_example_has_revisit_if(self) -> None:
        prompt = _load_prompt()
        assert "**Revisit if**:" in prompt

    def test_example_has_why_this_matters(self) -> None:
        prompt = _load_prompt()
        assert "**Why this matters**:" in prompt

    def test_example_has_watch_for(self) -> None:
        prompt = _load_prompt()
        assert "**Watch for**:" in prompt

    def test_example_has_matters_because(self) -> None:
        prompt = _load_prompt()
        assert "**Matters because**:" in prompt


class TestSecretHandlingRule:
    def test_contains_secret_handling_rule(self) -> None:
        prompt = _load_prompt()
        assert "## Secret-Handling Rule (MANDATORY)" in prompt
        assert "Never copy, quote, summarise, paraphrase, or store" in prompt
