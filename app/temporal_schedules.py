import asyncio
from pathlib import Path

import yaml
from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleOverlapPolicy,
    SchedulePolicy,
    ScheduleSpec,
    ScheduleUpdate,
)
from temporalio.service import RPCError, RPCStatusCode

from app.config import settings
from app.core.logging import get_logger
from app.models.config_schemas import DEFAULT_DEEP_DREAM_CRON, DEFAULT_WEEKLY_REVIEW_CRON

log = get_logger("jarvis.temporal_schedules")

_DEEP_DREAM_SCHEDULE_ID = "deep-dream-nightly"
_WEEKLY_REVIEW_SCHEDULE_ID = "weekly-review"


async def _read_cron() -> str:
    config_path = Path(settings.ai_memory_repo_path) / "config.yml"
    try:
        content = await asyncio.to_thread(config_path.read_text, encoding="utf-8")
        parsed = yaml.safe_load(content) or {}
        return str(parsed.get("deep_dream_cron", DEFAULT_DEEP_DREAM_CRON))
    except Exception:
        return DEFAULT_DEEP_DREAM_CRON


async def _read_weekly_cron() -> str:
    config_path = Path(settings.ai_memory_repo_path) / "config.yml"
    try:
        content = await asyncio.to_thread(config_path.read_text, encoding="utf-8")
        parsed = yaml.safe_load(content) or {}
        return str(parsed.get("weekly_review_cron", DEFAULT_WEEKLY_REVIEW_CRON))
    except Exception:
        return DEFAULT_WEEKLY_REVIEW_CRON


def _make_schedule(cron: str, kind: str, schedule_id: str) -> Schedule:
    return Schedule(
        action=ScheduleActionStartWorkflow(
            "ScheduleSignalRelay",
            kind,
            id=f"{schedule_id}-relay",
            task_queue=settings.temporal_task_queue,
        ),
        spec=ScheduleSpec(cron_expressions=[cron]),
        policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP),
    )


async def _upsert_schedule(client: Client, schedule_id: str, cron: str, kind: str) -> None:
    schedule = _make_schedule(cron, kind, schedule_id)
    try:
        handle = client.get_schedule_handle(schedule_id)
        await handle.describe()

        def _updater(inp: object) -> ScheduleUpdate:
            return ScheduleUpdate(schedule=schedule)

        await handle.update(_updater)
        log.info("temporal.schedules.updated", schedule_id=schedule_id, cron=cron)
    except RPCError as exc:
        if exc.status != RPCStatusCode.NOT_FOUND:
            raise
        await client.create_schedule(schedule_id, schedule)
        log.info("temporal.schedules.created", schedule_id=schedule_id, cron=cron)


async def register_schedules(client: Client) -> None:
    """Idempotently register (or update) both cron schedules on every server startup."""
    deep_cron = await _read_cron()
    weekly_cron = await _read_weekly_cron()

    await _upsert_schedule(client, _DEEP_DREAM_SCHEDULE_ID, deep_cron, "deep")
    await _upsert_schedule(client, _WEEKLY_REVIEW_SCHEDULE_ID, weekly_cron, "weekly")

    log.info(
        "temporal.schedules.registered",
        schedule_ids=[_DEEP_DREAM_SCHEDULE_ID, _WEEKLY_REVIEW_SCHEDULE_ID],
    )
