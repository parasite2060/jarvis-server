from arq.connections import RedisSettings
from arq.cron import cron

from app.config import settings
from app.core.logging import get_logger
from app.tasks.deep_dream_task import deep_dream_task
from app.tasks.light_dream_task import light_dream_task

log = get_logger("jarvis.tasks.worker")


async def startup(ctx: dict) -> None:  # type: ignore[type-arg]
    log.info("arq.worker.started")


async def shutdown(ctx: dict) -> None:  # type: ignore[type-arg]
    log.info("arq.worker.stopped")


class WorkerSettings:
    functions = [light_dream_task, deep_dream_task]
    cron_jobs = [cron(deep_dream_task, hour=20, minute=0)]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    on_startup = startup
    on_shutdown = shutdown
