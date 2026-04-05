import os
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("DB_PASSWORD", "test-password")
os.environ.setdefault("JARVIS_API_KEY", "test-api-key")


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    from app.main import create_app

    application = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
    ) as ac:
        yield ac
