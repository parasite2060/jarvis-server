from __future__ import annotations

from temporalio import activity
from temporalio.exceptions import ApplicationError

from app.activities.light._models import LightDreamPayload, LoadTranscriptResult


@activity.defn(name="light.load_transcript")
async def load_transcript(payload: LightDreamPayload) -> LoadTranscriptResult:
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.models.db import async_session_factory
    from app.models.tables import Dream, Transcript

    transcript_id = payload.transcript_id

    async with async_session_factory() as session:
        result = await session.execute(select(Transcript).where(Transcript.id == transcript_id))
        transcript = result.scalar_one_or_none()

    if transcript is None:
        raise ApplicationError(
            f"Transcript {transcript_id} not found",
            non_retryable=True,
        )

    dream = Dream(
        type="light",
        trigger="auto",
        status="processing",
        transcript_id=transcript_id,
        started_at=datetime.now(UTC),
    )
    async with async_session_factory() as session:
        session.add(dream)
        await session.commit()
        await session.refresh(dream)
        dream_id: int = dream.id

    async with async_session_factory() as session:
        result2 = await session.execute(select(Transcript).where(Transcript.id == transcript_id))
        t = result2.scalar_one()
        t.light_dream_id = dream_id
        t.status = "processing"
        await session.commit()

    created_at_iso: str | None = None
    if transcript.created_at is not None:
        created_at_iso = transcript.created_at.isoformat()

    return LoadTranscriptResult(
        dream_id=dream_id,
        transcript_id=transcript_id,
        session_id=str(transcript.session_id),
        parsed_text=transcript.parsed_text or "",
        project=getattr(transcript, "project", None),
        token_count=getattr(transcript, "token_count", None),
        is_continuation=bool(getattr(transcript, "is_continuation", False)),
        segment_end_line=int(getattr(transcript, "segment_end_line", 0)),
        created_at_iso=created_at_iso,
    )
