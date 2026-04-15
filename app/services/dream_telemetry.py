from datetime import UTC, datetime
from typing import Any

from pydantic_ai.usage import RunUsage

from app.models.db import async_session_factory
from app.models.tables import DreamPhase


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
