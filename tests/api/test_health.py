import pytest
from httpx import AsyncClient
from importlib.metadata import version as pkg_version


@pytest.mark.asyncio
async def test_health_returns_200(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_returns_ok_status(client: AsyncClient) -> None:
    response = await client.get("/health")
    body = response.json()

    assert body["status"] == "ok"


@pytest.mark.asyncio
async def test_health_returns_version(client: AsyncClient) -> None:
    response = await client.get("/health")
    body = response.json()

    assert body["data"]["version"] == pkg_version("jarvis-server")
