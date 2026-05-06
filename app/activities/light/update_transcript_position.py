from __future__ import annotations

from temporalio import activity

from app.activities.light._models import UpdatePositionInput


@activity.defn(name="light.update_transcript_position")
async def update_transcript_position(inp: UpdatePositionInput) -> None:
    from sqlalchemy import select

    from app.models.db import async_session_factory
    from app.models.tables import Transcript

    async with async_session_factory() as session:
        result = await session.execute(
            select(Transcript).where(Transcript.id == inp.transcript_id)
        )
        transcript = result.scalar_one()
        transcript.status = "processed"
        if inp.segment_end_line > 0:
            transcript.last_processed_line = inp.segment_end_line
        await session.commit()
