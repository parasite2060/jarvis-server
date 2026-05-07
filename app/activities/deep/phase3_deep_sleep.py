from __future__ import annotations

from datetime import date

from temporalio import activity

from app.activities.deep._models import ConsolidationResult, Phase3Input
from app.services.dream_agent import (
    DeepDreamDeps,
    consolidation_to_dict,
    run_deep_dream_consolidation,
)
from app.services.dream_telemetry import store_phase_telemetry
from app.services.memory_files import read_vault_file


@activity.defn(name="deep.phase3_deep_sleep")
async def phase3_deep_sleep(inp: Phase3Input) -> ConsolidationResult:
    source_date = date.fromisoformat(inp.source_date_iso)

    vault_guide = await read_vault_file("_guide.md") or ""

    deps = DeepDreamDeps(
        source_date=source_date,
        memu_memories=inp.memu_memories,
        memory_md=inp.memory_md,
        daily_log=inp.daily_log,
        soul_md=inp.soul_md,
        phase1_summary=inp.phase1_summary,
        phase2_summary=inp.phase2_summary,
    )

    phase3_sections = [
        "Consolidate memories. Produce updated MEMORY.md, daily summary, and vault updates.",
        "",
        inp.phase1_summary,
        "",
        inp.phase2_summary,
        "",
        f"## Current MEMORY.md\n{inp.memory_md or '(empty)'}",
        "",
        f"## Today's Daily Log\n{inp.daily_log or '(empty)'}",
    ]
    if vault_guide:
        phase3_sections.append("")
        phase3_sections.append("## Vault Guide (file templates & structure)")
        phase3_sections.append(vault_guide)
    run_prompt = "\n".join(phase3_sections)

    output, usage, tool_call_count, messages = await run_deep_dream_consolidation(deps)

    consolidation_json = consolidation_to_dict(output)

    await store_phase_telemetry(
        dream_id=inp.dream_id,
        phase="phase3_deep_sleep",
        status="completed",
        run_prompt=run_prompt,
        output_json=consolidation_json,
        messages=messages,
        usage=usage,
        tool_calls=tool_call_count,
        duration_ms=0,
        started_at=None,
    )

    # Serialize messages for passing to health_fix
    messages_json: list[dict[str, object]] = []
    for msg in messages:
        try:
            if hasattr(msg, "model_dump"):
                messages_json.append(msg.model_dump())
            elif hasattr(msg, "__dict__"):
                messages_json.append({"_type": type(msg).__name__, **msg.__dict__})
        except Exception:
            pass

    return ConsolidationResult(
        consolidation_json=consolidation_json,
        messages_json=messages_json,
        usage_input_tokens=usage.request_tokens,
        usage_output_tokens=usage.response_tokens,
        usage_total_tokens=usage.total_tokens,
        usage_tool_calls=tool_call_count,
    )
