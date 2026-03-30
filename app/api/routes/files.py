import asyncio
import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.api.deps import verify_api_key
from app.config import settings
from app.services.file_manifest import build_manifest, sync_file_manifest_to_db
from app.services.memory_files import safe_resolve


class ManifestFileEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    path: str
    hash: str
    size: int
    updated_at: str


class ManifestData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    files: list[ManifestFileEntry]
    manifest_hash: str
    file_count: int
    generated_at: str


class ManifestResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: ManifestData


class FileServeData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    content: str
    file_path: str
    hash: str
    size: int


class FileServeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: FileServeData


router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.get("/memory/files/manifest", response_model=ManifestResponse)
async def get_manifest() -> ManifestResponse:
    manifest = await build_manifest()

    asyncio.create_task(sync_file_manifest_to_db(manifest.files))

    file_entries = [
        ManifestFileEntry(
            path=f.relative_path,
            hash=f.content_hash,
            size=f.file_size,
            updated_at=f.updated_at.isoformat(),
        )
        for f in manifest.files
    ]

    return ManifestResponse(
        status="ok",
        data=ManifestData(
            files=file_entries,
            manifest_hash=manifest.manifest_hash,
            file_count=len(file_entries),
            generated_at=manifest.generated_at.isoformat(),
        ),
    )


@router.get("/memory/files/{file_path:path}", response_model=FileServeResponse)
async def get_file(file_path: str) -> FileServeResponse:
    repo_root = Path(settings.ai_memory_repo_path)
    resolved = safe_resolve(repo_root, file_path)

    if resolved is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_PATH",
                    "message": "Path traversal is not allowed",
                },
                "status": "error",
            },
        )

    if not resolved.is_file():
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "FILE_NOT_FOUND",
                    "message": f"File not found: {file_path}",
                },
                "status": "error",
            },
        )

    content_bytes = await asyncio.to_thread(resolved.read_bytes)
    content = content_bytes.decode("utf-8")
    content_hash = hashlib.sha256(content_bytes).hexdigest()

    return FileServeResponse(
        status="ok",
        data=FileServeData(
            content=content,
            file_path=file_path,
            hash=content_hash,
            size=len(content_bytes),
        ),
    )
