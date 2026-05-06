from unittest.mock import MagicMock, patch

from temporalio.worker import Worker


def _make_mock_client() -> MagicMock:
    return MagicMock()


def test_build_temporal_worker_returns_none_for_empty_registries() -> None:
    from app.temporal_worker import build_temporal_worker

    client = _make_mock_client()
    result = build_temporal_worker(client)

    assert result is None


def test_build_temporal_worker_returns_worker_when_workflows_provided() -> None:
    from app.temporal_worker import build_temporal_worker

    client = _make_mock_client()

    class FakeWorkflow:
        pass

    with patch("app.temporal_worker.Worker") as mock_worker_class:
        mock_worker_instance = MagicMock(spec=Worker)
        mock_worker_class.return_value = mock_worker_instance

        result = build_temporal_worker(client, workflows=[FakeWorkflow])

    assert result is mock_worker_instance
    mock_worker_class.assert_called_once_with(
        client,
        task_queue="jarvis-dream",
        workflows=[FakeWorkflow],
        activities=[],
    )


def test_build_temporal_worker_uses_configured_task_queue() -> None:
    from app.temporal_worker import build_temporal_worker

    client = _make_mock_client()

    class FakeWorkflow:
        pass

    with patch("app.temporal_worker.Worker") as mock_worker_class:
        mock_worker_class.return_value = MagicMock(spec=Worker)
        build_temporal_worker(client, workflows=[FakeWorkflow])

    _, kwargs = mock_worker_class.call_args
    assert kwargs["task_queue"] == "jarvis-dream"


def test_build_temporal_worker_accepts_workflow_registry() -> None:
    from app.temporal_worker import build_temporal_worker

    client = _make_mock_client()

    class FakeWorkflow:
        pass

    with patch("app.temporal_worker.Worker") as mock_worker_class:
        mock_worker_class.return_value = MagicMock(spec=Worker)
        build_temporal_worker(client, workflows=[FakeWorkflow])

    _, kwargs = mock_worker_class.call_args
    assert FakeWorkflow in kwargs["workflows"]
