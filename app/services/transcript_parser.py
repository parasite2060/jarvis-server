from __future__ import annotations

import json
from typing import Any

from app.core.logging import get_logger

log = get_logger("jarvis.services.transcript_parser")


def _extract_text_content(content: str | list[dict[str, Any]]) -> str | None:
    if isinstance(content, str):
        return content if content.strip() else None

    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text", "")
                if text:
                    parts.append(text)
        return " ".join(parts) if parts else None

    return None


def parse_transcript(raw_jsonl: str) -> str:
    lines = raw_jsonl.split("\n")
    turns: list[str] = []

    for line_num, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue

        try:
            entry: dict[str, Any] = json.loads(stripped)
        except json.JSONDecodeError:
            log.warning("transcript_parser.malformed_line", line_number=line_num)
            continue

        entry_type = entry.get("type")
        if entry_type not in ("human", "assistant"):
            continue

        message = entry.get("message")
        if not isinstance(message, dict):
            continue

        content = message.get("content")
        if content is None:
            continue

        text = _extract_text_content(content)
        if not text:
            continue

        role = "User" if entry_type == "human" else "Assistant"
        turns.append(f"{role}: {text}")

    return "\n\n".join(turns)


def count_tokens_approximate(text: str) -> int:
    return int(len(text.split()) * 1.3)
