from __future__ import annotations

from temporalio import activity

from app.activities.light._models import PersistSessionLogInput


@activity.defn(name="light.persist_session_log")
async def persist_session_log(inp: PersistSessionLogInput) -> None:
    from sqlalchemy import select

    from app.models.db import async_session_factory
    from app.models.tables import Dream

    async with async_session_factory() as session:
        result = await session.execute(select(Dream).where(Dream.id == inp.dream_id))
        dream = result.scalar_one()
        dream.session_log = inp.session_log_json
        await session.commit()
