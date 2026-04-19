from datetime import UTC, date, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import GitOpsError
from app.services.git_ops import GitOpsService


@pytest.fixture(autouse=True)
def _stub_fetch_dream_phases() -> Any:
    with patch(
        "app.services.git_ops._fetch_dream_phases",
        new_callable=AsyncMock,
        return_value=[],
    ) as mock:
        yield mock


def _make_process(stdout: str = "", stderr: str = "", returncode: int = 0) -> AsyncMock:
    proc = AsyncMock()
    proc.communicate.return_value = (stdout.encode(), stderr.encode())
    proc.returncode = returncode
    return proc


# ── read_dream_config tests ──


@pytest.mark.asyncio
async def test_read_dream_config_parses_yaml(tmp_path: object) -> None:
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmpdir:
        config_path = Path(tmpdir) / "config.yml"
        config_path.write_text("auto_merge: false\nmax_memory_lines: 150\n")

        with patch("app.services.git_ops.settings") as mock_settings:
            mock_settings.ai_memory_repo_path = tmpdir
            service = GitOpsService()
            result = await service.read_dream_config()

    assert result["auto_merge"] is False
    assert result["max_memory_lines"] == 150


@pytest.mark.asyncio
async def test_read_dream_config_returns_defaults_when_missing() -> None:
    with patch("app.services.git_ops.settings") as mock_settings:
        mock_settings.ai_memory_repo_path = "/nonexistent/path"
        service = GitOpsService()
        result = await service.read_dream_config()

    assert result["auto_merge"] is True
    assert result["max_memory_lines"] == 200


# ── run_git tests ──


@pytest.mark.asyncio
async def test_run_git_executes_command_and_returns_output() -> None:
    proc = _make_process(stdout="abc123", stderr="", returncode=0)

    with (
        patch(
            "app.services.git_ops.asyncio.create_subprocess_exec", return_value=proc
        ) as mock_exec,
        patch("app.services.git_ops.settings") as mock_settings,
    ):
        mock_settings.ai_memory_repo_path = "/repo"
        service = GitOpsService()
        stdout, stderr, rc = await service.run_git(["status"])

    assert stdout == "abc123"
    assert rc == 0
    mock_exec.assert_called_once()
    call_args = mock_exec.call_args
    assert call_args[0][0] == "git"
    assert call_args[0][1] == "status"
    assert call_args[1]["cwd"] == "/repo"


@pytest.mark.asyncio
async def test_run_git_raises_on_nonzero_return_code() -> None:
    proc = _make_process(stdout="", stderr="fatal: not a repo", returncode=128)

    with (
        patch("app.services.git_ops.asyncio.create_subprocess_exec", return_value=proc),
        patch("app.services.git_ops.settings") as mock_settings,
    ):
        mock_settings.ai_memory_repo_path = "/repo"
        service = GitOpsService()
        with pytest.raises(GitOpsError, match="failed"):
            await service.run_git(["status"])


# ── run_gh tests ──


@pytest.mark.asyncio
async def test_run_gh_executes_gh_command() -> None:
    proc = _make_process(stdout="https://github.com/owner/repo/pull/1", returncode=0)

    with (
        patch(
            "app.services.git_ops.asyncio.create_subprocess_exec", return_value=proc
        ) as mock_exec,
        patch("app.services.git_ops.settings") as mock_settings,
    ):
        mock_settings.ai_memory_repo_path = "/repo"
        service = GitOpsService()
        stdout, stderr, rc = await service.run_gh(["pr", "create", "--title", "test"])

    assert stdout == "https://github.com/owner/repo/pull/1"
    assert rc == 0
    call_args = mock_exec.call_args
    assert call_args[0][0] == "gh"
    assert call_args[0][1] == "pr"


@pytest.mark.asyncio
async def test_run_gh_raises_on_failure() -> None:
    proc = _make_process(stderr="gh: not authenticated", returncode=1)

    with (
        patch("app.services.git_ops.asyncio.create_subprocess_exec", return_value=proc),
        patch("app.services.git_ops.settings") as mock_settings,
    ):
        mock_settings.ai_memory_repo_path = "/repo"
        service = GitOpsService()
        with pytest.raises(GitOpsError, match="failed"):
            await service.run_gh(["pr", "create"])


# ── create_light_dream_pr tests ──


@pytest.mark.asyncio
async def test_create_light_dream_pr_full_sequence() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)  # skip pull

    call_count = 0

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        nonlocal call_count
        call_count += 1
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            return ("https://github.com/owner/repo/pull/42", "", 0)
        return ("", "", 0)

    async def mock_read_config() -> dict[str, object]:
        return {"auto_merge": True, "max_memory_lines": 200}

    files = [
        {"path": "MEMORY.md", "action": "append"},
        {"path": "dailys/2026-03-31.md", "action": "create"},
    ]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(service, "read_dream_config", side_effect=mock_read_config),
    ):
        result = await service.create_light_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="143000"
        )

    assert result["git_branch"] == "dream/light-2026-03-31-143000"
    assert result["git_pr_url"] == "https://github.com/owner/repo/pull/42"
    assert result["git_pr_status"] == "merged"


@pytest.mark.asyncio
async def test_create_light_dream_pr_auto_merge_false() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    gh_calls: list[list[str]] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        gh_calls.append(args)
        if args[0] == "pr" and args[1] == "create":
            return ("https://github.com/owner/repo/pull/42", "", 0)
        return ("", "", 0)

    async def mock_read_config() -> dict[str, object]:
        return {"auto_merge": False, "max_memory_lines": 200}

    files = [{"path": "MEMORY.md", "action": "append"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(service, "read_dream_config", side_effect=mock_read_config),
    ):
        result = await service.create_light_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="143000"
        )

    assert result["git_pr_status"] == "created"
    merge_calls = [c for c in gh_calls if c[0] == "pr" and c[1] == "merge"]
    assert len(merge_calls) == 0


@pytest.mark.asyncio
async def test_create_light_dream_pr_no_staged_changes() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        return ("", "", 0)

    async def mock_read_config() -> dict[str, object]:
        return {"auto_merge": True, "max_memory_lines": 200}

    gh_calls: list[list[str]] = []

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        gh_calls.append(args)
        return ("", "", 0)

    files = [{"path": "MEMORY.md", "action": "append"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(service, "read_dream_config", side_effect=mock_read_config),
    ):
        result = await service.create_light_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="120000"
        )

    assert result["git_pr_status"] == "no_changes"
    assert result["git_pr_url"] == ""
    assert len(gh_calls) == 0


@pytest.mark.asyncio
async def test_create_light_dream_pr_filters_error_entries() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    git_add_args: list[str] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "add":
            git_add_args.extend(args[1:])
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            return ("https://github.com/owner/repo/pull/1", "", 0)
        return ("", "", 0)

    async def mock_read_config() -> dict[str, object]:
        return {"auto_merge": False, "max_memory_lines": 200}

    files = [
        {"path": "MEMORY.md", "action": "append"},
        {"path": "dailys/2026-03-31.md", "action": "create", "error": "write failed"},
    ]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(service, "read_dream_config", side_effect=mock_read_config),
    ):
        await service.create_light_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="143000"
        )

    assert git_add_args == ["MEMORY.md"]


# ── cleanup_branch tests ──


@pytest.mark.asyncio
async def test_cleanup_branch_switches_to_main() -> None:
    service = GitOpsService()
    mock_run_git = AsyncMock(return_value=("", "", 0))

    with patch.object(service, "run_git", mock_run_git):
        await service.cleanup_branch("dream/light-2026-03-31-143000")

    mock_run_git.assert_called_once_with(["checkout", "main"])


@pytest.mark.asyncio
async def test_cleanup_branch_logs_error_without_raising() -> None:
    service = GitOpsService()
    mock_run_git = AsyncMock(side_effect=GitOpsError("checkout failed"))

    with patch.object(service, "run_git", mock_run_git):
        await service.cleanup_branch("dream/light-2026-03-31-143000")


# ── create_deep_dream_pr tests ──


@pytest.mark.asyncio
async def test_create_deep_dream_pr_correct_branch_name() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    async def mock_read_config() -> dict[str, object]:
        return {"auto_merge": False, "max_memory_lines": 200}

    files = [{"path": "MEMORY.md", "action": "rewrite"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(service, "read_dream_config", side_effect=mock_read_config),
    ):
        result = await service.create_deep_dream_pr(
            files, dream_id=5, source_date=date(2026, 3, 31)
        )

    assert result["git_branch"] == "dream/deep-2026-03-31"
    assert result["git_pr_url"] == "https://github.com/owner/repo/pull/10"
    assert result["git_pr_status"] == "created"


@pytest.mark.asyncio
async def test_create_deep_dream_pr_commit_message_format() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    commit_messages: list[str] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "commit":
            commit_messages.append(args[2])
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    files = [{"path": "MEMORY.md", "action": "rewrite"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(
            service,
            "read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        await service.create_deep_dream_pr(files, dream_id=5, source_date=date(2026, 3, 31))

    assert commit_messages == ["dream(deep): consolidate 2026-03-31"]


@pytest.mark.asyncio
async def test_create_deep_dream_pr_includes_stats_in_pr_body() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    pr_bodies: list[str] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            body_idx = args.index("--body") + 1
            pr_bodies.append(args[body_idx])
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    files = [{"path": "MEMORY.md", "action": "rewrite"}]
    stats = {
        "duplicates_removed": 3,
        "contradictions_resolved": 1,
        "patterns_promoted": 2,
        "stale_pruned": 0,
    }

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(
            service,
            "read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        await service.create_deep_dream_pr(
            files, dream_id=5, source_date=date(2026, 3, 31), stats=stats
        )

    assert len(pr_bodies) == 1
    body = pr_bodies[0]
    assert "Duplicates removed: 3" in body
    assert "Contradictions resolved: 1" in body
    assert "Patterns promoted: 2" in body


@pytest.mark.asyncio
async def test_create_deep_dream_pr_branch_already_exists_appends_suffix() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    branch_attempts: list[str] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "checkout" and args[1] == "-b":
            branch_attempts.append(args[2])
            if args[2] == "dream/deep-2026-03-31":
                raise GitOpsError("branch already exists")
            return ("", "", 0)
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    files = [{"path": "MEMORY.md", "action": "rewrite"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(
            service,
            "read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        result = await service.create_deep_dream_pr(
            files, dream_id=5, source_date=date(2026, 3, 31)
        )

    assert result["git_branch"] == "dream/deep-2026-03-31-2"
    assert branch_attempts[0] == "dream/deep-2026-03-31"
    assert branch_attempts[1] == "dream/deep-2026-03-31-2"


@pytest.mark.asyncio
async def test_create_deep_dream_pr_respects_auto_merge() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    gh_calls: list[list[str]] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        gh_calls.append(args)
        if args[0] == "pr" and args[1] == "create":
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    files = [{"path": "MEMORY.md", "action": "rewrite"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(
            service,
            "read_dream_config",
            AsyncMock(return_value={"auto_merge": True}),
        ),
    ):
        result = await service.create_deep_dream_pr(
            files, dream_id=5, source_date=date(2026, 3, 31)
        )

    assert result["git_pr_status"] == "merged"
    merge_calls = [c for c in gh_calls if c[0] == "pr" and c[1] == "merge"]
    assert len(merge_calls) == 1


@pytest.mark.asyncio
async def test_create_deep_dream_pr_empty_files_skips_git_ops() -> None:
    service = GitOpsService()
    result = await service.create_deep_dream_pr([], dream_id=5, source_date=date(2026, 3, 31))

    assert result["git_branch"] == ""
    assert result["git_pr_url"] == ""
    assert result["git_pr_status"] == "no_files"


# ── pull_latest_main tests ──


@pytest.mark.asyncio
async def test_pull_latest_main_success() -> None:
    service = GitOpsService()
    git_calls: list[list[str]] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        git_calls.append(args)
        return ("", "", 0)

    with patch.object(service, "run_git", side_effect=mock_run_git):
        await service.pull_latest_main()

    assert git_calls == [["checkout", "main"], ["pull", "origin", "main"]]
    assert service._last_pull_at is not None


@pytest.mark.asyncio
async def test_pull_latest_main_failure_logs_warning() -> None:
    service = GitOpsService()

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        raise GitOpsError("network error")

    with patch.object(service, "run_git", side_effect=mock_run_git):
        await service.pull_latest_main()

    assert service._last_pull_at is None


@pytest.mark.asyncio
async def test_pull_latest_main_already_fresh_skips() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    mock_pull = AsyncMock()

    with patch.object(service, "pull_latest_main", mock_pull):
        await service.ensure_main_fresh(max_age_seconds=1800)

    mock_pull.assert_not_called()


# ── ensure_main_fresh tests ──


@pytest.mark.asyncio
async def test_ensure_main_fresh_stale_triggers_pull() -> None:
    service = GitOpsService()
    service._last_pull_at = datetime(2020, 1, 1, tzinfo=UTC)

    git_calls: list[list[str]] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        git_calls.append(args)
        return ("", "", 0)

    with patch.object(service, "run_git", side_effect=mock_run_git):
        await service.ensure_main_fresh(max_age_seconds=1800)

    assert ["checkout", "main"] in git_calls
    assert ["pull", "origin", "main"] in git_calls


@pytest.mark.asyncio
async def test_ensure_main_fresh_none_triggers_pull() -> None:
    service = GitOpsService()
    assert service._last_pull_at is None

    git_calls: list[list[str]] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        git_calls.append(args)
        return ("", "", 0)

    with patch.object(service, "run_git", side_effect=mock_run_git):
        await service.ensure_main_fresh()

    assert ["checkout", "main"] in git_calls


# ── cleanup_merged_branches tests ──


@pytest.mark.asyncio
async def test_cleanup_merged_branches_deletes_merged() -> None:
    service = GitOpsService()

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args == ["checkout", "main"]:
            return ("", "", 0)
        if args == ["branch", "--list", "dream/*"]:
            return ("  dream/light-2026-03-01\n  dream/deep-2026-03-02\n", "", 0)
        if args == ["branch", "--merged", "main"]:
            return ("  main\n  dream/light-2026-03-01\n", "", 0)
        if args[0] == "branch" and args[1] == "-d":
            return ("", "", 0)
        if args == ["remote", "prune", "origin"]:
            return ("", "", 0)
        return ("", "", 0)

    with patch.object(service, "run_git", side_effect=mock_run_git):
        result = await service.cleanup_merged_branches()

    assert result["deleted_local"] == 1
    assert result["pruned_remote"] is True


@pytest.mark.asyncio
async def test_cleanup_merged_branches_skips_unmerged() -> None:
    service = GitOpsService()

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args == ["checkout", "main"]:
            return ("", "", 0)
        if args == ["branch", "--list", "dream/*"]:
            return ("  dream/light-2026-03-01\n", "", 0)
        if args == ["branch", "--merged", "main"]:
            return ("  main\n", "", 0)
        if args == ["remote", "prune", "origin"]:
            return ("", "", 0)
        return ("", "", 0)

    with patch.object(service, "run_git", side_effect=mock_run_git):
        result = await service.cleanup_merged_branches()

    assert result["deleted_local"] == 0
    assert result["pruned_remote"] is True


@pytest.mark.asyncio
async def test_cleanup_merged_branches_handles_delete_error() -> None:
    service = GitOpsService()

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args == ["checkout", "main"]:
            return ("", "", 0)
        if args == ["branch", "--list", "dream/*"]:
            return ("  dream/light-2026-03-01\n", "", 0)
        if args == ["branch", "--merged", "main"]:
            return ("  dream/light-2026-03-01\n", "", 0)
        if args[0] == "branch" and args[1] == "-d":
            raise GitOpsError("delete failed")
        if args == ["remote", "prune", "origin"]:
            return ("", "", 0)
        return ("", "", 0)

    with patch.object(service, "run_git", side_effect=mock_run_git):
        result = await service.cleanup_merged_branches()

    assert result["deleted_local"] == 0
    assert result["pruned_remote"] is True


# ── get_pr_status tests ──


@pytest.mark.asyncio
async def test_get_pr_status_open() -> None:
    service = GitOpsService()

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        return ('{"state":"OPEN","mergedAt":null,"closedAt":null,"title":"test PR"}', "", 0)

    with patch.object(service, "run_gh", side_effect=mock_run_gh):
        result = await service.get_pr_status("https://github.com/owner/repo/pull/1")

    assert result["state"] == "OPEN"
    assert result["merged_at"] is None
    assert result["title"] == "test PR"


@pytest.mark.asyncio
async def test_get_pr_status_merged() -> None:
    service = GitOpsService()

    merged_json = (
        '{"state":"MERGED","mergedAt":"2026-03-31T10:00:00Z",'
        '"closedAt":"2026-03-31T10:00:00Z","title":"test PR"}'
    )

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        return (merged_json, "", 0)

    with patch.object(service, "run_gh", side_effect=mock_run_gh):
        result = await service.get_pr_status("https://github.com/owner/repo/pull/1")

    assert result["state"] == "MERGED"
    assert result["merged_at"] == "2026-03-31T10:00:00Z"


@pytest.mark.asyncio
async def test_get_pr_status_closed() -> None:
    service = GitOpsService()

    closed_json = (
        '{"state":"CLOSED","mergedAt":null,"closedAt":"2026-03-31T10:00:00Z","title":"test PR"}'
    )

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        return (closed_json, "", 0)

    with patch.object(service, "run_gh", side_effect=mock_run_gh):
        result = await service.get_pr_status("https://github.com/owner/repo/pull/1")

    assert result["state"] == "CLOSED"
    assert result["closed_at"] == "2026-03-31T10:00:00Z"


@pytest.mark.asyncio
async def test_get_pr_status_empty_url() -> None:
    service = GitOpsService()
    result = await service.get_pr_status("")

    assert result["state"] == "unknown"
    assert result["error"] == "empty_url"


@pytest.mark.asyncio
async def test_get_pr_status_gh_failure() -> None:
    service = GitOpsService()

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        raise GitOpsError("gh failed")

    with patch.object(service, "run_gh", side_effect=mock_run_gh):
        result = await service.get_pr_status("https://github.com/owner/repo/pull/999")

    assert result["state"] == "unknown"
    assert "error" in result


# ---------------------------------------------------------------------------
# Story 11.9: PR body phase-status table
# ---------------------------------------------------------------------------


def _make_phase_row(
    phase: str,
    status: str,
    duration_ms: int | None = 15_000,
    error_message: str | None = None,
    output_json: dict | None = None,
) -> MagicMock:
    row = MagicMock()
    row.phase = phase
    row.status = status
    row.duration_ms = duration_ms
    row.error_message = error_message
    row.output_json = output_json
    return row


@pytest.mark.asyncio
async def test_pr_body_phase_status_table(_stub_fetch_dream_phases: Any) -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    pr_bodies: list[str] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            body_idx = args.index("--body") + 1
            pr_bodies.append(args[body_idx])
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    phases = [
        _make_phase_row("phase1_light_sleep", "completed", duration_ms=27_000),
        _make_phase_row(
            "phase2_rem_sleep",
            "failed",
            duration_ms=15_000,
            error_message=(
                "The next tool call(s) would exceed the tool_calls_limit of 25 (tool_calls=28)"
            ),
        ),
        _make_phase_row("phase3_deep_sleep", "completed", duration_ms=80_000),
        _make_phase_row("health_fix", "completed", duration_ms=61_000),
    ]
    _stub_fetch_dream_phases.return_value = phases

    files = [{"path": "MEMORY.md", "action": "rewrite"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(
            service,
            "read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        await service.create_deep_dream_pr(files, dream_id=42, source_date=date(2026, 4, 19))

    assert len(pr_bodies) == 1
    body = pr_bodies[0]
    assert "## Phase status" in body
    assert "| Phase | Status | Duration | Notes |" in body
    assert "| phase1_light_sleep | completed | 27s |  |" in body
    assert "| phase2_rem_sleep | **FAILED** | 15s |" in body
    assert "tool_calls_limit of 25" in body
    assert "| phase3_deep_sleep | completed | 80s |  |" in body
    assert "| health_fix | completed | 61s |  |" in body


@pytest.mark.asyncio
async def test_pr_body_phase_status_truncates_long_error(
    _stub_fetch_dream_phases: Any,
) -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    pr_bodies: list[str] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            body_idx = args.index("--body") + 1
            pr_bodies.append(args[body_idx])
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    long_error = "x" * 200
    phases = [_make_phase_row("phase2_rem_sleep", "failed", error_message=long_error)]
    _stub_fetch_dream_phases.return_value = phases

    files = [{"path": "MEMORY.md", "action": "rewrite"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(
            service,
            "read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        await service.create_deep_dream_pr(files, dream_id=42, source_date=date(2026, 4, 19))

    body = pr_bodies[0]
    assert "…" in body
    assert "x" * 120 in body
    assert "x" * 121 not in body


@pytest.mark.asyncio
async def test_pr_body_phase_status_labels_health_fix_iteration(
    _stub_fetch_dream_phases: Any,
) -> None:
    service = GitOpsService()
    service._last_pull_at = datetime.now(UTC)

    pr_bodies: list[str] = []

    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[:2] == ["diff", "--cached"]:
            raise GitOpsError("changes exist")
        return ("", "", 0)

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        if args[0] == "pr" and args[1] == "create":
            body_idx = args.index("--body") + 1
            pr_bodies.append(args[body_idx])
            return ("https://github.com/owner/repo/pull/10", "", 0)
        return ("", "", 0)

    phases = [
        _make_phase_row("health_fix", "completed", output_json={"iteration": 1}),
        _make_phase_row("health_fix", "completed", output_json={"iteration": 2}),
    ]
    _stub_fetch_dream_phases.return_value = phases

    files = [{"path": "MEMORY.md", "action": "rewrite"}]

    with (
        patch.object(service, "run_git", side_effect=mock_run_git),
        patch.object(service, "run_gh", side_effect=mock_run_gh),
        patch.object(
            service,
            "read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        await service.create_deep_dream_pr(files, dream_id=42, source_date=date(2026, 4, 19))

    body = pr_bodies[0]
    assert "health_fix (iter 1)" in body
    assert "health_fix (iter 2)" in body
