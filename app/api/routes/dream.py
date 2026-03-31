from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import verify_api_key
from app.core.logging import get_logger

log = get_logger("jarvis.api.dream")

router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.post("/dream")
async def trigger_dream(request: Request, response: Response) -> dict[str, object]:
    pool = request.app.state.redis_pool
    await pool.enqueue_job("deep_dream_task", trigger="manual")

    log.info("dream.manual_trigger.queued")

    response.status_code = 202
    return {"data": {"status": "queued"}, "status": "ok"}
