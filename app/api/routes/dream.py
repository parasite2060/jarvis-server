from datetime import date
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Request, Response
from pydantic import BaseModel

from app.api.deps import verify_api_key
from app.core.logging import get_logger

log = get_logger("jarvis.api.dream")

router = APIRouter(dependencies=[Depends(verify_api_key)])


class DreamRequest(BaseModel):
    source_date: date | None = None


@router.post("/dream")
async def trigger_dream(
    request: Request,
    response: Response,
    body: Annotated[DreamRequest | None, Body()] = None,
) -> dict[str, object]:
    pool = request.app.state.redis_pool
    source_date = body.source_date if body is not None else None
    trigger = "manual-backfill" if source_date else "manual"
    source_date_iso = source_date.isoformat() if source_date else None

    await pool.enqueue_job(
        "deep_dream_task",
        trigger=trigger,
        source_date_iso=source_date_iso,
    )

    if source_date_iso:
        log.info("dream.manual_trigger.queued", trigger=trigger, source_date=source_date_iso)
    else:
        log.info("dream.manual_trigger.queued", trigger=trigger)

    response.status_code = 202
    return {"data": {"status": "queued"}, "status": "ok"}
