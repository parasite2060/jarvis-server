from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db import async_session_factory

security = HTTPBearer()

Credentials = Annotated[HTTPAuthorizationCredentials, Depends(security)]


async def verify_api_key(credentials: Credentials) -> str:
    if credentials.credentials != settings.jarvis_api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {"code": "UNAUTHORIZED", "message": "Invalid or missing API key"},
                "status": "error",
            },
        )
    return credentials.credentials


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
