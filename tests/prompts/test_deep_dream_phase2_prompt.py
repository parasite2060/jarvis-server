"""Secret-handling rule presence test for deep_dream_phase2_rem_sleep prompt."""

from __future__ import annotations

from pathlib import Path

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "deep_dream_phase2_rem_sleep.md"


def _load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


class TestSecretHandlingRule:
    def test_contains_secret_handling_rule(self) -> None:
        prompt = _load_prompt()
        assert "## Secret-Handling Rule (MANDATORY)" in prompt
        assert "Never copy, quote, summarise, paraphrase, or store" in prompt
