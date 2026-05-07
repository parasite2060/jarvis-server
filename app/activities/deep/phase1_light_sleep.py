from __future__ import annotations

from datetime import date

from temporalio import activity

from app.activities.deep._models import LightSleepResult, Phase1Input
from app.services.dream_agent import DeepDreamDeps, run_phase1_light_sleep
from app.services.dream_telemetry import store_phase_telemetry


@activity.defn(name="deep.phase1_light_sleep")
async def phase1_light_sleep(inp: Phase1Input) -> LightSleepResult:
    source_date = date.fromisoformat(inp.source_date_iso)

    deps = DeepDreamDeps(
        source_date=source_date,
        memu_memories=inp.memu_memories,
        memory_md=inp.memory_md,
        daily_log=inp.daily_log,
        soul_md=inp.soul_md,
    )

    phase1_output, usage, tool_calls, messages = await run_phase1_light_sleep(deps)

    run_prompt = (
        "Inventory, deduplicate, and score today's memories.\n"
        "Use query_memu_memories() for MemU data.\n\n"
        f"## Current MEMORY.md\n{inp.memory_md or '(empty)'}\n\n"
        f"## Today's Daily Log\n{inp.daily_log or '(empty)'}"
    )

    await store_phase_telemetry(
        dream_id=inp.dream_id,
        phase="phase1_light_sleep",
        status="completed",
        run_prompt=run_prompt,
        output_json=phase1_output.model_dump(),
        messages=messages,
        usage=usage,
        tool_calls=tool_calls,
        duration_ms=0,
        started_at=None,
    )

    return LightSleepResult(
        candidates_json=[c.model_dump() for c in phase1_output.candidates],
        duplicates_removed=phase1_output.duplicates_removed,
        contradictions_found=phase1_output.contradictions_found,
    )
