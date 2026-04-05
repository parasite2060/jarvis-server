from importlib.metadata import version as pkg_version

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

router = APIRouter()

try:
    _VERSION = pkg_version("jarvis-server")
except Exception:
    _VERSION = "0.0.0-dev"


class HealthData(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
    )

    version: str


class HealthResponse(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
    )

    status: str
    data: HealthData


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", data=HealthData(version=_VERSION))
