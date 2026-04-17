from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, verify_api_key
from app.core.logging import get_logger
from app.models.conversation_schemas import (
    ConversationData,
    ConversationRequest,
    ConversationResponse,
)
from app.models.tables import Transcript
from app.services.secret_scrubber import scrub
from app.services.transcript_parser import count_tokens_approximate, parse_transcript

log = get_logger("jarvis.api.conversations")

router = APIRouter(dependencies=[Depends(verify_api_key)])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]

DEDUP_WINDOW_SECONDS = 60


@router.get("/conversations/position")
async def get_transcript_position(
    session_id: str,
    db: DbSession,
) -> dict:
    stmt = (
        select(Transcript.last_processed_line)
        .where(Transcript.session_id == session_id, Transcript.last_processed_line > 0)
        .order_by(Transcript.last_processed_line.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    last_line = result.scalar_one_or_none() or 0
    return {"session_id": session_id, "last_line": last_line}


@router.post("/conversations", response_model=ConversationResponse)
async def ingest_conversation(
    body: ConversationRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> ConversationResponse:
    dedup_cutoff = datetime.now(UTC) - timedelta(seconds=DEDUP_WINDOW_SECONDS)
    stmt = select(Transcript).where(
        Transcript.session_id == body.session_id,
        Transcript.source == body.source,
        Transcript.created_at >= dedup_cutoff,
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing is not None:
        log.info(
            "conversations.duplicate",
            session_id=body.session_id,
            source=body.source,
            transcript_id=existing.id,
        )
        response.status_code = 200
        return ConversationResponse(
            status="ok",
            data=ConversationData(transcript_id=existing.id, duplicate=True),
        )

    chain_stmt = (
        select(func.count()).select_from(Transcript).where(Transcript.session_id == body.session_id)
    )
    chain_result = await db.execute(chain_stmt)
    chain_count = chain_result.scalar() or 0

    scrubbed_transcript, redaction_counts = scrub(body.transcript)
    if redaction_counts:
        log.info(
            "secret_scrubber.redactions",
            session_id=body.session_id,
            counts_by_type=redaction_counts,
        )

    parsed_text = parse_transcript(scrubbed_transcript)
    token_count = count_tokens_approximate(parsed_text)

    transcript = Transcript(
        session_id=body.session_id,
        raw_content=scrubbed_transcript,
        parsed_text=parsed_text,
        token_count=token_count,
        source=body.source,
        status="received",
        is_continuation=chain_count > 0,
        segment_start_line=body.segment_start_line,
        segment_end_line=body.segment_end_line,
    )
    db.add(transcript)
    await db.commit()
    await db.refresh(transcript)

    log.info(
        "conversations.received",
        session_id=body.session_id,
        source=body.source,
        transcript_id=transcript.id,
        token_count=token_count,
        transcript_length=len(scrubbed_transcript),
    )

    try:
        arq_pool = request.app.state.redis_pool
        await arq_pool.enqueue_job("light_dream_task", transcript_id=transcript.id)
        transcript.status = "queued"
        await db.commit()
        log.info(
            "conversations.queued",
            session_id=body.session_id,
            transcript_id=transcript.id,
        )
    except Exception:
        log.error(
            "conversations.enqueue_failed",
            session_id=body.session_id,
            transcript_id=transcript.id,
        )

    response.status_code = 202
    return ConversationResponse(
        status="ok",
        data=ConversationData(transcript_id=transcript.id),
    )
