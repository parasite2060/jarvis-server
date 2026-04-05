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
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")

            if block_type == "text":
                text = block.get("text", "")
                if text:
                    parts.append(text)

            elif block_type == "tool_use":
                tool_name = block.get("name", "unknown")
                tool_input = block.get("input", {})
                summary = _summarize_tool_input(tool_name, tool_input)
                parts.append(f"[Tool: {tool_name}] {summary}")

            elif block_type == "tool_result":
                content_inner = block.get("content", "")
                is_error = block.get("is_error", False)
                result_text = _extract_tool_result(content_inner)
                if result_text:
                    prefix = "[Tool Error]" if is_error else "[Tool Result]"
                    parts.append(f"{prefix} {result_text}")

        return "\n".join(parts) if parts else None

    return None


def _summarize_tool_input(tool_name: str, tool_input: dict[str, Any]) -> str:
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        desc = tool_input.get("description", "")
        return desc if desc else (cmd[:200] if cmd else "")

    if tool_name in ("Edit", "Write"):
        path = tool_input.get("file_path", "")
        return path

    if tool_name == "Read":
        path = tool_input.get("file_path", "")
        limit = tool_input.get("limit", "")
        offset = tool_input.get("offset", "")
        suffix = ""
        if offset:
            suffix += f" offset={offset}"
        if limit:
            suffix += f" limit={limit}"
        return f"{path}{suffix}"

    if tool_name in ("Glob", "Grep"):
        pattern = tool_input.get("pattern", "")
        path = tool_input.get("path", "")
        return f"{pattern} in {path}" if path else pattern

    if tool_name == "WebSearch":
        return tool_input.get("query", "")

    if tool_name == "WebFetch":
        return tool_input.get("url", "")

    if tool_name.startswith("mcp__"):
        return json.dumps(tool_input, ensure_ascii=False)[:200]

    return json.dumps(tool_input, ensure_ascii=False)[:150]


def _extract_tool_result(content: str | list[dict[str, Any]]) -> str:
    if isinstance(content, str):
        return content if content.strip() else ""

    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text", "")
                if text:
                    parts.append(text)
        return " ".join(parts) if parts else ""

    return ""


def parse_transcript(raw_jsonl: str) -> str:
    lines = raw_jsonl.split("\n")
    header_parts: list[str] = []
    turns: list[str] = []
    metadata_extracted = False

    for line_num, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue

        try:
            entry: dict[str, Any] = json.loads(stripped)
        except json.JSONDecodeError:
            log.warning("transcript_parser.malformed_line", line_number=line_num)
            continue

        entry_type = entry.get("type", "")

        # Extract session metadata from the first user entry that has sessionId
        if not metadata_extracted and entry_type == "user":
            session_id = entry.get("sessionId", "")
            cwd = entry.get("cwd", "")
            version = entry.get("version", "")
            git_branch = entry.get("gitBranch", "")
            timestamp = entry.get("timestamp", "")
            if session_id:
                header_parts.append(f"Session: {session_id}")
            if cwd:
                header_parts.append(f"Working Directory: {cwd}")
            if git_branch:
                header_parts.append(f"Branch: {git_branch}")
            if version:
                header_parts.append(f"Claude Code: {version}")
            if timestamp:
                header_parts.append(f"Started: {timestamp}")
            metadata_extracted = True

        # Skip non-conversation entries
        if entry_type not in ("user", "assistant"):
            continue

        message = entry.get("message")
        if not isinstance(message, dict):
            continue

        content = message.get("content")
        if content is None:
            continue

        role = "Assistant" if entry_type == "assistant" else "User"

        text = _extract_text_content(content)
        if not text:
            continue

        timestamp = entry.get("timestamp", "")
        prefix = f"[{timestamp}] {role}" if timestamp else role
        turns.append(f"{prefix}: {text}")

    header = "\n".join(header_parts)
    body = "\n\n".join(turns)
    return f"{header}\n\n---\n\n{body}" if header else body


def count_tokens_approximate(text: str) -> int:
    return int(len(text.split()) * 1.3)
