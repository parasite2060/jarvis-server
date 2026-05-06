import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.activities.light.commit_and_pr import commit_and_pr
from app.activities.light.invalidate_cache import invalidate_cache
from app.activities.light.load_transcript import load_transcript
from app.activities.light.persist_session_log import persist_session_log
from app.activities.light.run_extraction import run_extraction
from app.activities.light.run_record import run_record
from app.activities.light.update_transcript_position import update_transcript_position
from app.api.routes.config import router as config_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.dream import router as dream_router
from app.api.routes.files import router as files_router
from app.api.routes.health import router as health_router
from app.api.routes.memory import router as memory_router
from app.config import settings
from app.core.logging import get_logger
from app.services.context_cache import invalidate_context_cache
from app.services.file_manifest import scan_vault_files, sync_file_manifest_to_db
from app.temporal_client import (
    close_temporal_client,
    ensure_coordinator_running,
    get_temporal_client,
)
from app.temporal_worker import build_temporal_worker
from app.workflows.coordinator import DreamCoordinatorWorkflow
from app.workflows.light_dream_workflow import LightDreamWorkflow

log = get_logger("jarvis.app")

VAULT_SYNC_INTERVAL_SECONDS = 1800


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


async def _vault_sync_loop() -> None:
    from app.services.git_ops import git_ops_service

    while True:
        await asyncio.sleep(VAULT_SYNC_INTERVAL_SECONDS)
        try:
            await git_ops_service.pull_latest_main()
            files = await scan_vault_files()
            await sync_file_manifest_to_db(files)
            await invalidate_context_cache()
            log.info("vault_sync.completed", file_count=len(files))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("vault_sync.failed", error=str(exc))


async def _start_dream_scheduler(app: FastAPI) -> None:
    from app.services.dream_scheduler import DreamScheduler
    from app.services.git_ops import git_ops_service

    scheduler = DreamScheduler(app.state.redis_pool)
    app.state.dream_scheduler = scheduler
    app.state.scheduler_task = asyncio.create_task(scheduler.run())
    git_ops_service.set_config_change_callback(scheduler.notify_config_changed)
    log.info("dream_scheduler.started")


async def _start_temporal_worker(app: FastAPI) -> None:
    client = await get_temporal_client()
    app.state.temporal_client = client
    worker = build_temporal_worker(
        client,
        workflows=[DreamCoordinatorWorkflow, LightDreamWorkflow],
        activities=[
            load_transcript,
            run_extraction,
            persist_session_log,
            run_record,
            update_transcript_position,
            commit_and_pr,
            invalidate_cache,
        ],
    )
    app.state.temporal_worker = worker
    if worker is not None:
        app.state.temporal_worker_task = asyncio.create_task(worker.run())
    log.info(
        "temporal.worker.started",
        address=settings.temporal_address,
        namespace=settings.temporal_namespace,
        task_queue=settings.temporal_task_queue,
    )
    await ensure_coordinator_running(client)
    log.info("temporal.coordinator.started", workflow_id="coord-singleton")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    log.info("jarvis.startup.begin")

    await _run_migrations()
    await _start_arq_pool(app)
    await _start_dream_scheduler(app)
    await _start_temporal_worker(app)

    app.state.vault_sync_task = asyncio.create_task(_vault_sync_loop())
    log.info("vault_sync.started", interval_seconds=VAULT_SYNC_INTERVAL_SECONDS)

    log.info("jarvis.startup.complete")
    yield

    log.info("jarvis.shutdown.begin")

    if hasattr(app.state, "vault_sync_task"):
        app.state.vault_sync_task.cancel()
        try:
            await app.state.vault_sync_task
        except asyncio.CancelledError:
            pass

    if hasattr(app.state, "temporal_worker_task"):
        app.state.temporal_worker_task.cancel()
        try:
            await app.state.temporal_worker_task
        except asyncio.CancelledError:
            pass

    await close_temporal_client()
    log.info("temporal.worker.stopped")

    if hasattr(app.state, "scheduler_task"):
        app.state.scheduler_task.cancel()
        try:
            await app.state.scheduler_task
        except asyncio.CancelledError:
            pass

    from app.services.memu_client import close_client

    await close_client()

    if hasattr(app.state, "redis_pool"):
        await app.state.redis_pool.aclose()

    log.info("jarvis.shutdown.complete")


def _get_version() -> str:
    from importlib.metadata import version

    try:
        return version("jarvis-server")
    except Exception:
        return "0.0.0-dev"


def create_app() -> FastAPI:
    application = FastAPI(
        title="Jarvis Server",
        version=_get_version(),
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
