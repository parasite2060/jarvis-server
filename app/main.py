import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.routes.config import router as config_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.dream import router as dream_router
from app.api.routes.files import router as files_router
from app.api.routes.health import router as health_router
from app.api.routes.memory import router as memory_router
from app.config import settings
from app.core.logging import get_logger

log = get_logger("jarvis.app")


async def _run_migrations() -> None:
    from alembic.config import Config

    from alembic import command

    def _migrate() -> None:
        alembic_cfg = Config("alembic/alembic.ini")
        alembic_cfg.set_main_option("script_location", "alembic")
        command.upgrade(alembic_cfg, "head")

    await asyncio.to_thread(_migrate)
    log.info("jarvis.migrations.completed")


async def _start_arq_pool(app: FastAPI) -> None:
    from arq import create_pool
    from arq.connections import RedisSettings

    redis_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    app.state.redis_pool = redis_pool
    log.info("arq.worker.connected", redis_url=str(settings.redis_url).split("@")[-1])


async def _start_dream_scheduler(app: FastAPI) -> None:
    from app.services.dream_scheduler import DreamScheduler
    from app.services.git_ops import git_ops_service

    scheduler = DreamScheduler(app.state.redis_pool)
    app.state.dream_scheduler = scheduler
    app.state.scheduler_task = asyncio.create_task(scheduler.run())
    git_ops_service.set_config_change_callback(scheduler.notify_config_changed)
    log.info("dream_scheduler.started")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    log.info("jarvis.startup.begin")

    await _run_migrations()
    await _start_arq_pool(app)
    await _start_dream_scheduler(app)

    log.info("jarvis.startup.complete")
    yield

    log.info("jarvis.shutdown.begin")

    if hasattr(app.state, "scheduler_task"):
        app.state.scheduler_task.cancel()
        try:
            await app.state.scheduler_task
        except asyncio.CancelledError:
            pass

    from app.services.azure_openai import close_client as close_openai_client
    from app.services.memu_client import close_client

    await close_openai_client()
    await close_client()

    if hasattr(app.state, "redis_pool"):
        await app.state.redis_pool.aclose()

    log.info("jarvis.shutdown.complete")


def create_app() -> FastAPI:
    application = FastAPI(
        title="Jarvis Server",
        version="0.1.0",
        lifespan=lifespan,
    )

    application.include_router(health_router)
    application.include_router(memory_router)
    application.include_router(files_router)
    application.include_router(conversations_router)
    application.include_router(dream_router)
    application.include_router(config_router)

    @application.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        log.error("jarvis.request.unhandled_error", error=str(exc), path=str(request.url))
        return JSONResponse(
            status_code=500,
            content={
                "error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"},
                "status": "error",
            },
        )

    return application


app = create_app()
