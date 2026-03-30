from typing import Any

from app.core.logging import get_logger

log = get_logger("jarvis.tasks.light_dream")


async def light_dream_task(ctx: dict[str, Any], transcript_id: int) -> None:
    log.info(
        "jarvis.light_dream.started",
        transcript_id=transcript_id,
    )
    log.info(
        "jarvis.light_dream.completed",
        transcript_id=transcript_id,
    )
