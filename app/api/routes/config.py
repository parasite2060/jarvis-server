import asyncio
import re
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import verify_api_key
from app.config import settings
from app.core.logging import get_logger
from app.models.config_schemas import (
    DEFAULT_AUTO_MERGE,
    DEFAULT_DEEP_DREAM_CRON,
    DEFAULT_MAX_MEMORY_LINES,
    ConfigData,
    ConfigResponse,
    ConfigUpdateRequest,
)

log = get_logger("jarvis.api.config")

router = APIRouter(dependencies=[Depends(verify_api_key)])

CRON_PATTERN = re.compile(
    r"^(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)\s+(\*|[0-9,\-/]+)$"
)


def _config_path() -> Path:
    return Path(settings.ai_memory_repo_path) / "config.yml"


def _defaults() -> dict[str, bool | str | int]:
    return {
        "auto_merge": DEFAULT_AUTO_MERGE,
        "deep_dream_cron": DEFAULT_DEEP_DREAM_CRON,
        "max_memory_lines": DEFAULT_MAX_MEMORY_LINES,
    }


async def _read_config() -> dict[str, bool | str | int]:
    path = _config_path()
    try:
        content = await asyncio.to_thread(path.read_text, encoding="utf-8")
        parsed: dict[str, bool | str | int] = yaml.safe_load(content) or {}
    except Exception:
        parsed = {}

    defaults = _defaults()
    return {key: parsed.get(key, defaults[key]) for key in defaults}


def _to_config_data(raw: dict[str, bool | str | int]) -> ConfigData:
    return ConfigData(
        auto_merge=bool(raw["auto_merge"]),
        deep_dream_cron=str(raw["deep_dream_cron"]),
        max_memory_lines=int(raw["max_memory_lines"]),
    )


@router.get("/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    raw = await _read_config()
    log.info("config.get.completed")
    return ConfigResponse(status="ok", data=_to_config_data(raw))


@router.patch("/config", response_model=ConfigResponse)
async def update_config(body: ConfigUpdateRequest) -> ConfigResponse:
    updates = body.model_dump(exclude_none=True, by_alias=False)

    if not updates:
        raise HTTPException(
            status_code=422,
            detail={
                "error": {"code": "VALIDATION_ERROR", "message": "No fields provided to update"},
                "status": "error",
            },
        )

    if "deep_dream_cron" in updates and not CRON_PATTERN.match(updates["deep_dream_cron"]):
        raise HTTPException(
            status_code=422,
            detail={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid cron expression: must be 5 space-separated fields",
                },
                "status": "error",
            },
        )

    current = await _read_config()
    merged: dict[str, bool | str | int] = {**current, **updates}

    path = _config_path()
    tmp_path = path.with_suffix(".yml.tmp")

    yaml_content = yaml.dump(dict(merged), default_flow_style=False, allow_unicode=True)
    await asyncio.to_thread(tmp_path.write_text, yaml_content, encoding="utf-8")

    # Validate written content
    verify_content = await asyncio.to_thread(tmp_path.read_text, encoding="utf-8")
    verify_parsed = yaml.safe_load(verify_content)
    if not isinstance(verify_parsed, dict):
        await asyncio.to_thread(tmp_path.unlink, missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "CONFIG_WRITE_ERROR",
                    "message": "Config validation failed after write",
                },
                "status": "error",
            },
        )

    await asyncio.to_thread(tmp_path.replace, path)

    changed_fields = list(updates.keys())
    log.info("config.update.completed", changed_fields=changed_fields)

    return ConfigResponse(status="ok", data=_to_config_data(merged))
