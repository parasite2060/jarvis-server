import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.api.deps import verify_api_key
from app.core.exceptions import MemuError, MemuUnavailableError
from app.core.logging import get_logger
from app.models.memory_proxy_schemas import (
    MemoryAddData,
    MemoryAddRequest,
    MemoryAddResponse,
    MemorySearchData,
    MemorySearchRequest,
    MemorySearchResponse,
    MemorySearchResultItem,
)
from app.services.context_assembly import assemble_context
from app.services.context_cache import get_cached_context, set_cached_context
from app.services.memory_files import read_vault_file
from app.services.memu_client import memu_memorize, memu_retrieve

log = get_logger("jarvis.api.memory")


class ContextData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    context: str
    cached: bool
    assembled_at: str


class ContextResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: ContextData


class FileContentData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    content: str
    file_path: str


class FileContentResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: FileContentData


router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.get("/memory/context", response_model=ContextResponse)
async def get_context() -> ContextResponse:
    cached_content = await get_cached_context()

    if cached_content is not None:
        return ContextResponse(
            status="ok",
            data=ContextData(
                context=cached_content,
                cached=True,
                assembled_at=datetime.datetime.now(tz=datetime.UTC).isoformat(),
            ),
        )

    content = await assemble_context()
    await set_cached_context(content)

    return ContextResponse(
        status="ok",
        data=ContextData(
            context=content,
            cached=False,
            assembled_at=datetime.datetime.now(tz=datetime.UTC).isoformat(),
        ),
    )


@router.get("/memory/soul", response_model=FileContentResponse)
async def get_soul() -> FileContentResponse:
    content = await read_vault_file("SOUL.md")
    if content is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {"code": "FILE_NOT_FOUND", "message": "SOUL.md not found in vault"},
                "status": "error",
            },
        )

    return FileContentResponse(
        status="ok",
        data=FileContentData(content=content, file_path="SOUL.md"),
    )


@router.get("/memory/identity", response_model=FileContentResponse)
async def get_identity() -> FileContentResponse:
    content = await read_vault_file("IDENTITY.md")
    if content is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {"code": "FILE_NOT_FOUND", "message": "IDENTITY.md not found in vault"},
                "status": "error",
            },
        )

    return FileContentResponse(
        status="ok",
        data=FileContentData(content=content, file_path="IDENTITY.md"),
    )


def _handle_memu_error(exc: MemuError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {"code": "MEMU_ERROR", "message": exc.detail},
            "status": "error",
        },
    )


def _handle_memu_unavailable(exc: MemuUnavailableError) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "error": {"code": "MEMU_UNAVAILABLE", "message": exc.detail},
            "status": "error",
        },
    )


@router.post("/memory/search", response_model=MemorySearchResponse)
async def memory_search(body: MemorySearchRequest) -> MemorySearchResponse | JSONResponse:
    try:
        memu_response: dict[str, Any] = await memu_retrieve(body.query, body.method)
    except MemuError as exc:
        log.error("memory.search.error", query_length=len(body.query), status_code=exc.status_code)
        return _handle_memu_error(exc)
    except MemuUnavailableError as exc:
        log.error("memory.search.error", query_length=len(body.query), reason="unavailable")
        return _handle_memu_unavailable(exc)

    memories: list[dict[str, Any]] = memu_response.get("memories", [])
    results = [
        MemorySearchResultItem(
            content=m.get("content", ""),
            relevance=m.get("relevance", 0.0),
            source=m.get("source"),
            metadata=m.get("metadata"),
        )
        for m in memories
    ]

    log.info("memory.search.success", query_length=len(body.query), result_count=len(results))

    return MemorySearchResponse(
        status="ok",
        data=MemorySearchData(
            results=results,
            query=body.query,
            method=body.method,
        ),
    )


@router.post("/memory/add", response_model=MemoryAddResponse)
async def memory_add(body: MemoryAddRequest) -> MemoryAddResponse | JSONResponse:
    messages: list[dict[str, str]] = []
    if body.metadata and body.metadata.get("context"):
        messages.append({"role": "system", "content": body.metadata["context"]})
    messages.append({"role": "user", "content": body.content})

    try:
        memu_response: dict[str, Any] = await memu_memorize(messages)
    except MemuError as exc:
        log.error("memory.add.error", content_length=len(body.content), status_code=exc.status_code)
        return _handle_memu_error(exc)
    except MemuUnavailableError as exc:
        log.error("memory.add.error", content_length=len(body.content), reason="unavailable")
        return _handle_memu_unavailable(exc)

    memory_id = memu_response.get("task_id", "")

    log.info("memory.add.success", content_length=len(body.content), memory_id=memory_id)

    return MemoryAddResponse(
        status="ok",
        data=MemoryAddData(
            memory_id=memory_id,
            status="accepted",
        ),
    )
