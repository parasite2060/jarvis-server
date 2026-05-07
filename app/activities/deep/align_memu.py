from __future__ import annotations

from datetime import date

from temporalio import activity

from app.activities.deep._models import AlignMemuInput
from app.services.deep_dream import align_memu_with_memory


@activity.defn(name="deep.align_memu")
async def align_memu(inp: AlignMemuInput) -> None:
    source_date = date.fromisoformat(inp.source_date_iso)
    await align_memu_with_memory(
        inp.memory_md,
        source_date,
        idempotency_key=inp.idempotency_key,
    )
