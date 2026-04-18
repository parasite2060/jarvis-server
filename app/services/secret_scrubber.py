from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path

_PATTERNS_JSON_PATH = Path(__file__).with_name("secret_patterns.json")

_FLAG_MAP: dict[str, int] = {
    "i": re.IGNORECASE,
    "m": re.MULTILINE,
    "s": re.DOTALL,
    "x": re.VERBOSE,
}

Replacement = str | Callable[[re.Match[str]], str]


def _redact_url_basic_auth(match: re.Match[str]) -> str:
    return f"{match.group(1)}://[REDACTED_USER]:[REDACTED_PW]@"


_FUNCTION_REGISTRY: dict[str, Callable[[re.Match[str]], str]] = {
    "url_basic_auth": _redact_url_basic_auth,
}


def _compile_flags(flags: str) -> int:
    compiled = 0
    for char in flags:
        if char == "g":
            continue
        if char not in _FLAG_MAP:
            raise ValueError(f"Unsupported regex flag '{char}' in secret_patterns.json")
        compiled |= _FLAG_MAP[char]
    return compiled


def _backref_js_to_python(replacement: str) -> str:
    return re.sub(r"\$(\d+)", r"\\\1", replacement)


def _build_pattern(entry: dict) -> tuple[str, re.Pattern[str], Replacement]:
    name = entry["name"]
    regex = entry["regex"]
    flags = _compile_flags(entry.get("flags", ""))
    replacement_type = entry["replacement_type"]

    compiled = re.compile(regex, flags)

    if replacement_type == "literal":
        return name, compiled, entry["replacement"]
    if replacement_type == "backref":
        return name, compiled, _backref_js_to_python(entry["replacement"])
    if replacement_type == "function":
        function_name = entry["function"]
        if function_name not in _FUNCTION_REGISTRY:
            raise ValueError(
                f"Unknown function '{function_name}' for pattern '{name}' "
                f"— add it to _FUNCTION_REGISTRY"
            )
        return name, compiled, _FUNCTION_REGISTRY[function_name]

    raise ValueError(f"Unknown replacement_type '{replacement_type}' for pattern '{name}'")


def _load_patterns() -> list[tuple[str, re.Pattern[str], Replacement]]:
    raw = json.loads(_PATTERNS_JSON_PATH.read_text(encoding="utf-8"))
    return [_build_pattern(entry) for entry in raw["patterns"]]


SECRET_PATTERNS: list[tuple[str, re.Pattern[str], Replacement]] = _load_patterns()


def scrub(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    scrubbed = text

    for name, pattern, replacement in SECRET_PATTERNS:
        scrubbed, count = pattern.subn(replacement, scrubbed)
        if count:
            counts[name] = count

    return scrubbed, counts
