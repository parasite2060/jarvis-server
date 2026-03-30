from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db_session, verify_api_key
from app.core.logging import get_logger
from app.models.conversation_schemas import (
    ConversationData,
    ConversationRequest,
    ConversationResponse,
)
from app.models.tables import Transcript
from app.services.transcript_parser import count_tokens_approximate, parse_transcript

log = get_logger("jarvis.api.conversations")

router = APIRouter(dependencies=[Depends(verify_api_key)])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("/conversations", response_model=ConversationResponse)
async def ingest_conversation(
    body: ConversationRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> ConversationResponse:
    stmt = select(Transcript).where(
        Transcript.session_id == body.session_id,
        Transcript.source == body.source,
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

    parsed_text = parse_transcript(body.transcript)
    token_count = count_tokens_approximate(parsed_text)

    transcript = Transcript(
        session_id=body.session_id,
        raw_content=body.transcript,
        parsed_text=parsed_text,
        token_count=token_count,
        source=body.source,
        status="received",
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
        transcript_length=len(body.transcript),
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
