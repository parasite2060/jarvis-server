import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.api.deps import verify_api_key
from app.services.context_assembly import assemble_context
from app.services.context_cache import get_cached_context, set_cached_context
from app.services.memory_files import read_vault_file


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
