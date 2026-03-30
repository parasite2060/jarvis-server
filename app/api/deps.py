from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

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
