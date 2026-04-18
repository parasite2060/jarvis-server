"""Parity tests for the JSON-driven secret scrubber (Story 11.7).

Asserts that the loaded `SECRET_PATTERNS` faithfully reflects every entry
in `secret_patterns.json` — count, regex source, and replacement type.
This is the server-side half of the cross-repo enforcement: combined with
`transcript_json_parity.test.js` in the plugin and the byte-equality of the
vendored JSON copy, it locks the canonical pattern list across both runtimes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.services.secret_scrubber import SECRET_PATTERNS

_PATTERNS_JSON_PATH = (
    Path(__file__).resolve().parents[2] / "app" / "services" / "secret_patterns.json"
)


def _load_json() -> dict:
    return json.loads(_PATTERNS_JSON_PATH.read_text(encoding="utf-8"))


class TestJsonStructure:
    def test_json_file_exists(self) -> None:
        assert _PATTERNS_JSON_PATH.exists()

    def test_json_has_version_and_patterns(self) -> None:
        data = _load_json()

        assert data["version"] == 1
        assert isinstance(data["patterns"], list)
        assert len(data["patterns"]) > 0

    def test_every_pattern_has_required_fields(self) -> None:
        data = _load_json()

        for entry in data["patterns"]:
            assert "name" in entry
            assert "regex" in entry
            assert "flags" in entry
            assert "replacement_type" in entry
            assert entry["replacement_type"] in {"literal", "backref", "function"}

            if entry["replacement_type"] in {"literal", "backref"}:
                assert "replacement" in entry
            if entry["replacement_type"] == "function":
                assert "function" in entry


class TestPatternCountParity:
    def test_loaded_pattern_count_matches_json(self) -> None:
        data = _load_json()

        assert len(SECRET_PATTERNS) == len(data["patterns"])


class TestPatternOrderAndNames:
    def test_pattern_names_match_json_order(self) -> None:
        data = _load_json()
        json_names = [entry["name"] for entry in data["patterns"]]
        loaded_names = [name for name, _, _ in SECRET_PATTERNS]

        assert loaded_names == json_names


class TestRegexSourceParity:
    def test_each_compiled_pattern_matches_json_regex(self) -> None:
        data = _load_json()

        for entry, (name, compiled, _) in zip(data["patterns"], SECRET_PATTERNS, strict=True):
            assert name == entry["name"]
            assert compiled.pattern == entry["regex"], (
                f"Pattern '{name}': compiled regex source does not match JSON"
            )


class TestReplacementParity:
    def test_literal_replacements_match_json(self) -> None:
        data = _load_json()

        for entry, (name, _, replacement) in zip(data["patterns"], SECRET_PATTERNS, strict=True):
            if entry["replacement_type"] == "literal":
                assert replacement == entry["replacement"], (
                    f"Pattern '{name}': literal replacement diverged from JSON"
                )

    def test_backref_replacements_translate_js_to_python(self) -> None:
        data = _load_json()

        for entry, (name, _, replacement) in zip(data["patterns"], SECRET_PATTERNS, strict=True):
            if entry["replacement_type"] == "backref":
                expected = re.sub(r"\$(\d+)", r"\\\1", entry["replacement"])
                assert replacement == expected, f"Pattern '{name}': backref translation incorrect"

    def test_function_replacements_resolve_to_callables(self) -> None:
        data = _load_json()

        for entry, (name, _, replacement) in zip(data["patterns"], SECRET_PATTERNS, strict=True):
            if entry["replacement_type"] == "function":
                assert callable(replacement), (
                    f"Pattern '{name}': function replacement is not callable"
                )


class TestPortabilityConstraints:
    def test_no_python_only_named_groups(self) -> None:
        data = _load_json()

        for entry in data["patterns"]:
            assert "(?P<" not in entry["regex"], (
                f"Pattern '{entry['name']}' uses Python-only named groups"
            )
            assert "(?P=" not in entry["regex"], (
                f"Pattern '{entry['name']}' uses Python-only backreference syntax"
            )

    def test_no_inline_flags(self) -> None:
        data = _load_json()

        for entry in data["patterns"]:
            assert not re.search(r"\(\?[ismx]+\)", entry["regex"]), (
                f"Pattern '{entry['name']}' uses inline flag syntax"
            )

    def test_no_lookbehind(self) -> None:
        data = _load_json()

        for entry in data["patterns"]:
            assert "(?<=" not in entry["regex"], (
                f"Pattern '{entry['name']}' uses positive lookbehind"
            )
            assert "(?<!" not in entry["regex"], (
                f"Pattern '{entry['name']}' uses negative lookbehind"
            )
