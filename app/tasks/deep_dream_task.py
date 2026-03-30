from typing import Any

from app.core.logging import get_logger

log = get_logger("jarvis.tasks.deep_dream")


async def deep_dream_task(ctx: dict[str, Any]) -> None:
    log.info("jarvis.deep_dream.started")
    log.info("jarvis.deep_dream.completed")
