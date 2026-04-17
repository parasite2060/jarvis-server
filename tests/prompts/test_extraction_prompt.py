"""Tests for extraction prompt content — verifies reasoning guidance."""

from pathlib import Path

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "light_dream_extract.md"


def _read_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


class TestExtractionReasoningGuidance:
    """Verify extraction prompt includes reasoning guidance for each insight type."""

    def test_decisions_have_revisit_if_guidance(self) -> None:
        content = _read_prompt()
        assert "Revisit if" in content

    def test_decisions_have_bad_good_example(self) -> None:
        content = _read_prompt()
        assert "**Bad**:" in content
        assert "**Good**:" in content

    def test_lessons_have_why_this_matters_guidance(self) -> None:
        content = _read_prompt()
        assert "Why this matters" in content

    def test_lessons_have_watch_for_guidance(self) -> None:
        content = _read_prompt()
        assert "Watch for" in content

    def test_session_memory_has_matters_because_guidance(self) -> None:
        content = _read_prompt()
        assert "Matters because" in content

    def test_extraction_quality_section_exists(self) -> None:
        content = _read_prompt()
        assert "Extraction Quality" in content

    def test_what_happens_next_section_exists(self) -> None:
        content = _read_prompt()
        assert "What Happens Next" in content

    def test_store_session_memory_documented(self) -> None:
        content = _read_prompt()
        assert "store_session_memory" in content

    def test_file_info_first_instruction(self) -> None:
        content = _read_prompt()
        assert "file_info" in content


class TestSecretHandlingRule:
    def test_contains_secret_handling_rule(self) -> None:
        content = _read_prompt()
        assert "## Secret-Handling Rule (MANDATORY)" in content
        assert "Never copy, quote, summarise, paraphrase, or store" in content
