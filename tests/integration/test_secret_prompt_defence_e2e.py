# Synthetic fake secrets for regex tests. Not real credentials.
"""Story 10.1 AC11 — agent-prompt third-line defence (LLM-dependent).

Submits a transcript containing a made-up secret-like token that deliberately
does NOT match any regex in `SECRET_PATTERNS`. The Secret-Handling Rule block
in the agent prompts is expected to cause the LLM to treat the token as
non-information, so the token should not appear in any vault file produced
by the light dream.

Marked with `@pytest.mark.llm_dependent`. This is non-deterministic; run
manually and repeat 3x, requiring majority-pass. It is skipped in the default
`uv run pytest tests/` run via the marker opt-in.
"""

from __future__ import annotations

import pytest

from app.services.secret_scrubber import SECRET_PATTERNS

FAKE_NON_MATCHING_TOKEN = "fakepwd_supersecret_123456789"


def test_fake_token_does_not_match_any_regex() -> None:
    """Preflight: confirm the token does NOT match any scrubber pattern."""
    for name, pattern, _replacement in SECRET_PATTERNS:
        assert not pattern.search(FAKE_NON_MATCHING_TOKEN), (
            f"Pattern {name} should not match the non-regex fake token; the "
            f"LLM-layer defence test requires a token the regex layer misses."
        )


@pytest.mark.llm_dependent
def test_prompt_defence_suppresses_non_regex_secret() -> None:
    """Submit transcript with `fakepwd_supersecret_123456789`, run light dream
    end-to-end, assert the token does not appear in any vault file.

    Run 3x (majority-pass) because LLM output is non-deterministic. Skip in
    CI unless `-m llm_dependent` is explicitly passed.
    """
    pytest.skip(
        "LLM-dependent test — run manually via TC-11-11 with live LLM. See "
        "docs/tests/TC-11-secret-redaction.md."
    )
