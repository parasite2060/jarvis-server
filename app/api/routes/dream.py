from datetime import date
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, verify_api_key
from app.core.logging import get_logger
from app.models.tables import DreamPhase
from app.services.dream_telemetry import format_conversation

log = get_logger("jarvis.api.dream")

router = APIRouter(dependencies=[Depends(verify_api_key)])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]


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


@router.get("/dreams/{dream_id}/phases/{phase}/trace")
async def get_phase_trace(
    dream_id: int,
    phase: str,
    db: DbSession,
) -> dict[str, object]:
    stmt = select(DreamPhase).where(
        DreamPhase.dream_id == dream_id,
        DreamPhase.phase == phase,
    )
    result = await db.execute(stmt)
    phase_row = result.scalar_one_or_none()

    if phase_row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "NOT_FOUND",
                    "message": f"No phase '{phase}' found for dream {dream_id}",
                },
                "status": "error",
            },
        )

    rendered = format_conversation(phase_row.conversation_history)
    return {
        "data": {
            "dream_id": dream_id,
            "phase": phase,
            "trace": rendered,
        },
        "status": "ok",
    }
