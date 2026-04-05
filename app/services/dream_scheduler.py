import asyncio
from datetime import UTC, datetime
from pathlib import Path

import yaml
from arq.connections import ArqRedis

from app.config import settings
from app.core.logging import get_logger
from app.models.config_schemas import DEFAULT_DEEP_DREAM_CRON
from app.services.cron_parser import next_run_from_cron

log = get_logger("jarvis.services.dream_scheduler")


class DreamScheduler:
    def __init__(self, redis_pool: ArqRedis) -> None:
        self._pool = redis_pool
        self._wake_event = asyncio.Event()
        self._current_cron: str | None = None
        self._current_job_id: str | None = None

    async def run(self) -> None:
        while True:
            self._wake_event.clear()

            cron_expr = await self._read_cron()
            now = datetime.now(UTC)
            next_run = next_run_from_cron(cron_expr, now)
            sleep_seconds = max((next_run - now).total_seconds(), 1)

            if cron_expr != self._current_cron:
                log.info(
                    "dream_scheduler.schedule_changed",
                    old_cron=self._current_cron,
                    new_cron=cron_expr,
                    next_run=next_run.isoformat(),
                )
                await self._abort_current_job()
                self._current_cron = cron_expr

            job_id = f"deep_dream_cron:{int(next_run.timestamp())}"
            try:
                result = await self._pool.enqueue_job(
                    "deep_dream_task",
                    trigger="auto",
                    _job_id=job_id,
                    _defer_until=next_run,
                )
                if result is not None:
                    self._current_job_id = job_id
                    log.info(
                        "dream_scheduler.job_enqueued",
                        job_id=job_id,
                        next_run=next_run.isoformat(),
                        sleep_seconds=int(sleep_seconds),
                    )
                else:
                    log.info("dream_scheduler.job_already_exists", job_id=job_id)
            except Exception as exc:
                log.warning("dream_scheduler.enqueue_failed", error=str(exc))

            try:
                await asyncio.wait_for(self._wake_event.wait(), timeout=sleep_seconds)
                log.info("dream_scheduler.woke_early", reason="config_changed")
            except asyncio.TimeoutError:
                pass

    def notify_config_changed(self) -> None:
        self._wake_event.set()

    async def _abort_current_job(self) -> None:
        if not self._current_job_id:
            return
        try:
            await self._pool.abort_job(self._current_job_id)
            log.info("dream_scheduler.job_aborted", job_id=self._current_job_id)
        except Exception as exc:
            log.warning(
                "dream_scheduler.abort_failed",
                job_id=self._current_job_id,
                error=str(exc),
            )
        self._current_job_id = None

    async def _read_cron(self) -> str:
        config_path = Path(settings.ai_memory_repo_path) / "config.yml"
        try:
            content = await asyncio.to_thread(config_path.read_text, encoding="utf-8")
            parsed = yaml.safe_load(content) or {}
            return str(parsed.get("deep_dream_cron", DEFAULT_DEEP_DREAM_CRON))
        except Exception:
            return DEFAULT_DEEP_DREAM_CRON
