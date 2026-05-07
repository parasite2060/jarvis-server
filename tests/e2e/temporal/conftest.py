"""E2E fixtures for Docker-backed Temporal tests.

Infrastructure choices:
- Plain subprocess + socket polling (no pytest-docker plugin) — lighter footprint.
- Docker run with --rm so container self-cleans on stop.
- Per-test namespace isolation prevents cross-test pollution.
- Worker subprocess for chaos tests via app/run_worker.py entrypoint.
"""

from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import AsyncGenerator, Generator
from pathlib import Path
from typing import Any

import pytest
from temporalio.api.workflowservice.v1 import RegisterNamespaceRequest
from temporalio.client import Client

# ---------------------------------------------------------------------------
# Session-scoped: Docker Temporal server
# ---------------------------------------------------------------------------

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_port(host: str, port: int, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return
        except OSError:
            time.sleep(0.5)
    raise RuntimeError(
        f"Temporal server at {host}:{port} did not become reachable within {timeout}s"
    )


@pytest.fixture(scope="session")
def temporal_server() -> Generator[str, None, None]:
    """Start Docker Temporal dev server; yield host:port; stop on session end."""
    try:
        subprocess.run(["docker", "info"], check=True, capture_output=True, timeout=10)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        pytest.skip(
            f"Docker not available — install Docker or skip the e2e_temporal marker. ({exc})"
        )

    port = _free_port()
    container_name = f"temporal-e2e-{port}"

    proc = subprocess.Popen(
        [
            "docker", "run",
            "--rm",
            "--name", container_name,
            "-p", f"{port}:7233",
            "-e", "DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/development-sql.yaml",
            "temporalio/auto-setup:1.27.0",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        _wait_for_port("127.0.0.1", port, timeout=90.0)
        yield f"127.0.0.1:{port}"
    finally:
        subprocess.run(["docker", "stop", container_name], capture_output=True, timeout=15)
        proc.wait(timeout=15)


# ---------------------------------------------------------------------------
# Function-scoped: unique namespace per test
# ---------------------------------------------------------------------------

@pytest.fixture
async def e2e_namespace(temporal_server: str) -> AsyncGenerator[str, None]:
    """Create a unique namespace; yield its name; delete on teardown."""
    from datetime import timedelta

    import google.protobuf.duration_pb2 as duration_pb2

    ns_name = f"e2e-{uuid.uuid4().hex[:8]}"

    client = await Client.connect(target_host=temporal_server, namespace="default")

    retention = duration_pb2.Duration()
    retention.FromTimedelta(timedelta(hours=1))

    await client.workflow_service.register_namespace(
        RegisterNamespaceRequest(namespace=ns_name, workflow_execution_retention_period=retention)
    )

    yield ns_name

    # Namespace cleanup — best-effort; auto-expires via retention anyway
    try:
        from temporalio.api.operatorservice.v1 import DeleteNamespaceRequest as OpDeleteNs
        await client.operator_service.delete_namespace(OpDeleteNs(namespace=ns_name))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Function-scoped: Temporal client connected to test namespace
# ---------------------------------------------------------------------------

@pytest.fixture
async def temporal_client(temporal_server: str, e2e_namespace: str) -> AsyncGenerator[Client, None]:
    """Connect a Temporal client to the per-test namespace."""
    client = await Client.connect(target_host=temporal_server, namespace=e2e_namespace)
    yield client


# ---------------------------------------------------------------------------
# Function-scoped: unique task queue name per test
# ---------------------------------------------------------------------------

@pytest.fixture
def e2e_task_queue() -> str:
    return f"jarvis-dream-e2e-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Function-scoped: temp vault directory + bare git repo
# ---------------------------------------------------------------------------

@pytest.fixture
def e2e_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "MEMORY.md").write_text("# Memory\n\nInitial content.\n")
    (vault / "dailys").mkdir()
    (vault / "reviews").mkdir()
    return vault


@pytest.fixture
def e2e_bare_repo(tmp_path: Path) -> Path:
    """Create a bare git repo that acts as the remote for PR creation tests."""
    bare = tmp_path / "fake-remote.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)
    return bare


# ---------------------------------------------------------------------------
# Worker subprocess fixture (for chaos tests)
# ---------------------------------------------------------------------------

class WorkerProcess:
    """Manages a jarvis worker subprocess."""

    def __init__(
        self, proc: subprocess.Popen[bytes], address: str, namespace: str, task_queue: str
    ) -> None:
        self._proc = proc
        self.address = address
        self.namespace = namespace
        self.task_queue = task_queue

    def kill(self) -> None:
        self._proc.kill()

    def is_alive(self) -> bool:
        return self._proc.poll() is None

    def wait(self, timeout: float = 10.0) -> None:
        self._proc.wait(timeout=timeout)


async def _wait_for_worker_pollers(
    client: Client, task_queue: str, timeout: float = 30.0
) -> None:
    """Poll until at least one worker registers pollers on the task queue."""
    import temporalio.api.taskqueue.v1 as tq
    import temporalio.api.workflowservice.v1 as ws

    req = ws.DescribeTaskQueueRequest(
        namespace=client.namespace,
        task_queue=tq.TaskQueue(name=task_queue),
        report_pollers=True,
    )
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            resp = await client.workflow_service.describe_task_queue(req)
            pollers = getattr(resp, "pollers", [])
            if pollers:
                return
        except Exception:
            pass
        await asyncio.sleep(0.5)
    raise RuntimeError(f"No pollers appeared on task queue '{task_queue}' within {timeout}s")


def _spawn_worker(
    address: str,
    namespace: str,
    task_queue: str,
    extra_env: dict[str, str] | None = None,
) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    env["DB_PASSWORD"] = env.get("DB_PASSWORD", "test-password")
    env["JARVIS_API_KEY"] = env.get("JARVIS_API_KEY", "test-api-key")
    if extra_env:
        env.update(extra_env)

    worker_module = str(
        Path(__file__).parent.parent.parent.parent / "app" / "run_worker.py"
    )
    return subprocess.Popen(
        [
            sys.executable,
            worker_module,
            "--address", address,
            "--namespace", namespace,
            "--task-queue", task_queue,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )


@pytest.fixture
async def worker_subprocess(
    temporal_server: str,
    e2e_namespace: str,
    e2e_task_queue: str,
    temporal_client: Client,
) -> AsyncGenerator[WorkerProcess, None]:
    """Spawn a real worker process; wait for pollers; yield; kill on teardown."""
    proc = _spawn_worker(temporal_server, e2e_namespace, e2e_task_queue)
    wp = WorkerProcess(proc, temporal_server, e2e_namespace, e2e_task_queue)

    try:
        await _wait_for_worker_pollers(temporal_client, e2e_task_queue)
        yield wp
    finally:
        if wp.is_alive():
            proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


# ---------------------------------------------------------------------------
# Helper: kill and restart worker (for chaos tests)
# ---------------------------------------------------------------------------

async def kill_and_restart_worker(
    wp: WorkerProcess,
    temporal_client: Client,
) -> WorkerProcess:
    """SIGKILL the worker and start a fresh one on the same address/namespace/queue."""
    wp.kill()
    try:
        wp.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass

    proc = _spawn_worker(wp.address, wp.namespace, wp.task_queue)
    new_wp = WorkerProcess(proc, wp.address, wp.namespace, wp.task_queue)
    await _wait_for_worker_pollers(temporal_client, wp.task_queue)
    return new_wp


# ---------------------------------------------------------------------------
# Helper: wait for workflow to complete
# ---------------------------------------------------------------------------

async def wait_for_workflow(
    client: Client,
    workflow_id: str,
    timeout: float = 120.0,
) -> Any:
    """Poll until a workflow completes and return its result."""
    handle = client.get_workflow_handle(workflow_id)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return await asyncio.wait_for(handle.result(), timeout=5.0)
        except TimeoutError:
            continue
        except Exception as exc:
            # Workflow may not exist yet or may have failed
            err_str = str(exc)
            if "workflow not found" in err_str.lower() or "not found" in err_str.lower():
                await asyncio.sleep(1.0)
                continue
            raise
    raise TimeoutError(f"Workflow '{workflow_id}' did not complete within {timeout}s")
