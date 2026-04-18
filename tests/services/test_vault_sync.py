import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.main import VAULT_SYNC_INTERVAL_SECONDS, _vault_sync_loop


@pytest.fixture
def mock_git_ops_service() -> MagicMock:
    service = MagicMock()
    service.pull_latest_main = AsyncMock()
    return service


@pytest.fixture
def mock_scan_vault_files() -> AsyncMock:
    mock = AsyncMock(return_value=[MagicMock(), MagicMock(), MagicMock()])
    return mock


@pytest.fixture
def mock_sync_file_manifest_to_db() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def mock_invalidate_context_cache() -> AsyncMock:
    return AsyncMock()


def _patch_all(
    git_ops: MagicMock,
    scan: AsyncMock,
    sync_db: AsyncMock,
    invalidate: AsyncMock,
    sleep_mock: AsyncMock | None = None,
) -> list[object]:
    patches = [
        patch("app.services.git_ops.git_ops_service", git_ops),
        patch("app.main.scan_vault_files", scan),
        patch("app.main.sync_file_manifest_to_db", sync_db),
        patch("app.main.invalidate_context_cache", invalidate),
    ]
    if sleep_mock is not None:
        patches.append(patch("asyncio.sleep", sleep_mock))
    return patches


async def test_vault_sync_loop_sleeps_first_then_calls_all_four_in_order(
    mock_git_ops_service: MagicMock,
    mock_scan_vault_files: AsyncMock,
    mock_sync_file_manifest_to_db: AsyncMock,
    mock_invalidate_context_cache: AsyncMock,
) -> None:
    call_order: list[str] = []

    async def tracked_sleep(seconds: float) -> None:
        call_order.append("sleep")
        raise asyncio.CancelledError

    mock_git_ops_service.pull_latest_main = AsyncMock(side_effect=lambda: call_order.append("pull"))
    mock_scan_vault_files.side_effect = lambda: call_order.append("scan") or [MagicMock()]
    mock_sync_file_manifest_to_db.side_effect = lambda files: call_order.append("sync_db")
    mock_invalidate_context_cache.side_effect = lambda: call_order.append("invalidate")

    patches = _patch_all(
        mock_git_ops_service,
        mock_scan_vault_files,
        mock_sync_file_manifest_to_db,
        mock_invalidate_context_cache,
        AsyncMock(side_effect=tracked_sleep),
    )
    for p in patches:
        p.start()
    try:
        with pytest.raises(asyncio.CancelledError):
            await _vault_sync_loop()
    finally:
        for p in patches:
            p.stop()

    assert call_order == ["sleep"]


async def test_vault_sync_loop_calls_all_four_functions_in_order(
    mock_git_ops_service: MagicMock,
    mock_scan_vault_files: AsyncMock,
    mock_sync_file_manifest_to_db: AsyncMock,
    mock_invalidate_context_cache: AsyncMock,
) -> None:
    call_order: list[str] = []
    iteration = 0

    async def sleep_side_effect(seconds: float) -> None:
        nonlocal iteration
        iteration += 1
        if iteration > 1:
            raise asyncio.CancelledError

    mock_git_ops_service.pull_latest_main = AsyncMock(side_effect=lambda: call_order.append("pull"))
    mock_scan_vault_files.side_effect = lambda: (
        call_order.append("scan")
        or [
            MagicMock(),
            MagicMock(),
        ]
    )
    mock_sync_file_manifest_to_db.side_effect = lambda files: call_order.append("sync_db")
    mock_invalidate_context_cache.side_effect = lambda: call_order.append("invalidate")

    patches = _patch_all(
        mock_git_ops_service,
        mock_scan_vault_files,
        mock_sync_file_manifest_to_db,
        mock_invalidate_context_cache,
        AsyncMock(side_effect=sleep_side_effect),
    )
    for p in patches:
        p.start()
    try:
        with pytest.raises(asyncio.CancelledError):
            await _vault_sync_loop()
    finally:
        for p in patches:
            p.stop()

    assert call_order == ["pull", "scan", "sync_db", "invalidate"]


async def test_vault_sync_loop_continues_on_pull_failure(
    mock_git_ops_service: MagicMock,
    mock_scan_vault_files: AsyncMock,
    mock_sync_file_manifest_to_db: AsyncMock,
    mock_invalidate_context_cache: AsyncMock,
) -> None:
    iteration = 0

    async def sleep_side_effect(seconds: float) -> None:
        nonlocal iteration
        iteration += 1
        if iteration > 2:
            raise asyncio.CancelledError

    mock_git_ops_service.pull_latest_main = AsyncMock(side_effect=RuntimeError("network error"))

    patches = _patch_all(
        mock_git_ops_service,
        mock_scan_vault_files,
        mock_sync_file_manifest_to_db,
        mock_invalidate_context_cache,
        AsyncMock(side_effect=sleep_side_effect),
    )
    for p in patches:
        p.start()
    try:
        with pytest.raises(asyncio.CancelledError):
            await _vault_sync_loop()
    finally:
        for p in patches:
            p.stop()

    assert mock_git_ops_service.pull_latest_main.call_count == 2
    mock_scan_vault_files.assert_not_called()


async def test_vault_sync_loop_continues_on_scan_failure(
    mock_git_ops_service: MagicMock,
    mock_scan_vault_files: AsyncMock,
    mock_sync_file_manifest_to_db: AsyncMock,
    mock_invalidate_context_cache: AsyncMock,
) -> None:
    iteration = 0

    async def sleep_side_effect(seconds: float) -> None:
        nonlocal iteration
        iteration += 1
        if iteration > 1:
            raise asyncio.CancelledError

    mock_scan_vault_files.side_effect = RuntimeError("scan error")

    patches = _patch_all(
        mock_git_ops_service,
        mock_scan_vault_files,
        mock_sync_file_manifest_to_db,
        mock_invalidate_context_cache,
        AsyncMock(side_effect=sleep_side_effect),
    )
    for p in patches:
        p.start()
    try:
        with pytest.raises(asyncio.CancelledError):
            await _vault_sync_loop()
    finally:
        for p in patches:
            p.stop()

    mock_git_ops_service.pull_latest_main.assert_called_once()
    mock_sync_file_manifest_to_db.assert_not_called()


async def test_vault_sync_loop_cancelled_error_propagates(
    mock_git_ops_service: MagicMock,
    mock_scan_vault_files: AsyncMock,
    mock_sync_file_manifest_to_db: AsyncMock,
    mock_invalidate_context_cache: AsyncMock,
) -> None:
    async def sleep_cancel(seconds: float) -> None:
        raise asyncio.CancelledError

    patches = _patch_all(
        mock_git_ops_service,
        mock_scan_vault_files,
        mock_sync_file_manifest_to_db,
        mock_invalidate_context_cache,
        AsyncMock(side_effect=sleep_cancel),
    )
    for p in patches:
        p.start()
    try:
        with pytest.raises(asyncio.CancelledError):
            await _vault_sync_loop()
    finally:
        for p in patches:
            p.stop()

    mock_git_ops_service.pull_latest_main.assert_not_called()


async def test_vault_sync_loop_sleep_uses_configured_interval(
    mock_git_ops_service: MagicMock,
    mock_scan_vault_files: AsyncMock,
    mock_sync_file_manifest_to_db: AsyncMock,
    mock_invalidate_context_cache: AsyncMock,
) -> None:
    sleep_mock = AsyncMock(side_effect=asyncio.CancelledError)

    patches = _patch_all(
        mock_git_ops_service,
        mock_scan_vault_files,
        mock_sync_file_manifest_to_db,
        mock_invalidate_context_cache,
        sleep_mock,
    )
    for p in patches:
        p.start()
    try:
        with pytest.raises(asyncio.CancelledError):
            await _vault_sync_loop()
    finally:
        for p in patches:
            p.stop()

    sleep_mock.assert_called_once_with(VAULT_SYNC_INTERVAL_SECONDS)
