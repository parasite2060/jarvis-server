from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from temporalio import activity

from app.activities.deep._models import DeepDreamPayload, GatherInputsResult
from app.models.db import async_session_factory
from app.models.tables import Dream
from app.services.deep_dream import gather_consolidation_inputs
from app.services.memory_files import read_vault_file, write_vault_file


@activity.defn(name="deep.gather_inputs")
async def gather_inputs(payload: DeepDreamPayload) -> GatherInputsResult:
    from datetime import date

    source_date = date.fromisoformat(payload.target_date)

    # Create Dream row
    dream = Dream(
        type="deep",
        trigger=payload.trigger,
        status="processing",
        transcript_id=None,
        started_at=datetime.now(UTC),
    )
    async with async_session_factory() as session:
        session.add(dream)
        await session.commit()
        await session.refresh(dream)
        dream_id: int = dream.id

    # Gather inputs (returns None if nothing to consolidate)
    inputs: dict[str, Any] | None = await gather_consolidation_inputs(source_date)

    if inputs is None:
        # Return empty result to signal skip — workflow handles skipped status
        return GatherInputsResult(
            dream_id=dream_id,
            memu_memories=[],
            memory_md="",
            daily_log="",
            soul_md="",
            source_date_iso=source_date.isoformat(),
        )

    # Backup files before any mutations
    memory_md_content = await read_vault_file("MEMORY.md")
    if memory_md_content:
        await write_vault_file(
            f".backups/MEMORY.md.{source_date.isoformat()}.bak", memory_md_content
        )
    daily_log_content = await read_vault_file(f"dailys/{source_date.isoformat()}.md")
    if daily_log_content:
        await write_vault_file(
            f".backups/dailys-{source_date.isoformat()}.bak", daily_log_content
        )

    return GatherInputsResult(
        dream_id=dream_id,
        memu_memories=inputs["memu_memories"],
        memory_md=inputs["memory_md"],
        daily_log=inputs["daily_log"],
        soul_md=inputs["soul_md"],
        source_date_iso=source_date.isoformat(),
    )
