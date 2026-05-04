import hashlib
from datetime import UTC, datetime
from typing import Any, NamedTuple

from pydantic_ai.usage import RunUsage

from app.models.db import async_session_factory
from app.models.tables import DreamPhase

_TOOL_RETURN_TRUNCATE_AT = 200
_TOOL_RETURN_KEEP = 80
_ARG_VALUE_KEEP = 60
_NO_HISTORY_MARKER = "_(no conversation recorded)_"


def _serialize_messages(messages: list[Any]) -> list[dict]:
    result = []
    for msg in messages:
        try:
            if hasattr(msg, "model_dump"):
                result.append(msg.model_dump(mode="json"))
            elif hasattr(msg, "__dict__"):
                result.append(str(msg))
            else:
                result.append(str(msg))
        except Exception:
            result.append({"error": "serialization_failed", "type": type(msg).__name__})
    return result


def _approximate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _summarize_args(args: Any) -> str:
    if args is None:
        return ""
    if isinstance(args, str):
        return _truncate_value(args)
    if not isinstance(args, dict):
        return _truncate_value(repr(args))

    pieces: list[str] = []
    for key, value in args.items():
        pieces.append(f"{key}={_truncate_value(_stringify(value))}")
    return ", ".join(pieces)


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    return repr(value)


def _truncate_value(value: str, keep: int = _ARG_VALUE_KEEP) -> str:
    if len(value) <= keep:
        return value
    return f"{value[:keep]}…"


def _truncate_tool_return(content: str) -> str:
    if len(content) <= _TOOL_RETURN_TRUNCATE_AT:
        return content
    return f"{content[:_TOOL_RETURN_KEEP]}… [{len(content)} chars total]"


def _system_header(text: str) -> str:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
    tokens = _approximate_tokens(text)
    return f"system [hash:{digest} {tokens} tokens]"


class RenderResult(NamedTuple):
    lines: list[str]
    user_prompt_emitted: bool
    turn_index: int


def format_conversation(history: list[dict[str, Any]] | None) -> str:
    if not history:
        return _NO_HISTORY_MARKER

    lines: list[str] = []
    seen_system_hashes: set[str] = set()
    user_prompt_emitted = False
    turn_index = 0

    for entry in history:
        try:
            result = _render_entry(
                entry,
                seen_system_hashes=seen_system_hashes,
                user_prompt_emitted=user_prompt_emitted,
                turn_index=turn_index,
            )
        except Exception as exc:
            lines.append(f"[unrenderable: {type(exc).__name__}]")
            continue

        lines.extend(result.lines)
        user_prompt_emitted = result.user_prompt_emitted
        turn_index = result.turn_index

    if not lines:
        return _NO_HISTORY_MARKER
    return "\n".join(lines)


def _render_entry(
    entry: Any,
    seen_system_hashes: set[str],
    user_prompt_emitted: bool,
    turn_index: int,
) -> RenderResult:
    if not isinstance(entry, dict):
        return RenderResult(
            [f"[unrenderable: {type(entry).__name__}]"],
            user_prompt_emitted,
            turn_index,
        )

    if "error" in entry and entry.get("error") == "serialization_failed":
        return RenderResult(
            ["[unrenderable: serialization_failed]"],
            user_prompt_emitted,
            turn_index,
        )

    kind = entry.get("kind")
    if kind not in ("request", "response"):
        return RenderResult(
            ["[unrenderable: missing_kind]"],
            user_prompt_emitted,
            turn_index,
        )

    parts = entry.get("parts") or []
    if not isinstance(parts, list):
        return RenderResult(
            ["[unrenderable: bad_parts]"],
            user_prompt_emitted,
            turn_index,
        )

    out: list[str] = []

    if kind == "request":
        instructions = entry.get("instructions")
        if isinstance(instructions, str) and instructions:
            header = _system_header(instructions)
            digest = header.split("hash:", 1)[1].split(" ", 1)[0]
            if digest not in seen_system_hashes:
                seen_system_hashes.add(digest)
                out.append(header)

        for part in parts:
            if not isinstance(part, dict):
                out.append(f"[unrenderable: {type(part).__name__}]")
                continue
            part_kind = part.get("part_kind")
            content = part.get("content")
            if part_kind == "system-prompt" and isinstance(content, str):
                header = _system_header(content)
                digest = header.split("hash:", 1)[1].split(" ", 1)[0]
                if digest not in seen_system_hashes:
                    seen_system_hashes.add(digest)
                    out.append(header)
            elif part_kind == "user-prompt":
                if not user_prompt_emitted:
                    text = content if isinstance(content, str) else str(content)
                    out.append(f"user prompt:\n{text}")
                    user_prompt_emitted = True
            elif part_kind == "tool-return":
                tool_name = part.get("tool_name", "?")
                raw = content if isinstance(content, str) else _stringify(content)
                out.append(f"        tool       {tool_name} → {_truncate_tool_return(raw)}")
            else:
                out.append(f"[unrenderable: {part_kind or 'unknown_part'}]")

    elif kind == "response":
        turn_index += 1
        for part in parts:
            if not isinstance(part, dict):
                out.append(f"[unrenderable: {type(part).__name__}]")
                continue
            part_kind = part.get("part_kind")
            if part_kind == "tool-call":
                tool_name = part.get("tool_name", "?")
                args_summary = _summarize_args(part.get("args"))
                out.append(
                    f"turn {turn_index}  assistant  → {tool_name}({args_summary})"
                )
            elif part_kind == "text":
                content = part.get("content")
                if isinstance(content, str) and content.strip():
                    out.append(f"turn {turn_index}  assistant  {_truncate_tool_return(content)}")
            elif part_kind == "thinking":
                continue
            else:
                out.append(f"[unrenderable: {part_kind or 'unknown_part'}]")

    return RenderResult(out, user_prompt_emitted, turn_index)


async def store_phase_telemetry(
    dream_id: int,
    phase: str,
    status: str,
    run_prompt: str | None = None,
    output_json: dict | None = None,
    messages: list[Any] | None = None,
    usage: RunUsage | None = None,
    tool_calls: int = 0,
    duration_ms: int | None = None,
    started_at: datetime | None = None,
    error_message: str | None = None,
) -> int:
    now = datetime.now(UTC)
    phase_row = DreamPhase(
        dream_id=dream_id,
        phase=phase,
        status=status,
        run_prompt=run_prompt,
        output_json=output_json,
        conversation_history=_serialize_messages(messages) if messages else None,
        input_tokens=getattr(usage, "input_tokens", None) if usage else None,
        output_tokens=getattr(usage, "output_tokens", None) if usage else None,
        total_tokens=getattr(usage, "total_tokens", None) if usage else None,
        tool_calls=tool_calls,
        duration_ms=duration_ms,
        started_at=started_at or now,
        completed_at=now if status in ("completed", "failed", "skipped") else None,
        error_message=error_message,
    )
    async with async_session_factory() as session:
        session.add(phase_row)
        await session.commit()
        await session.refresh(phase_row)
        return phase_row.id
