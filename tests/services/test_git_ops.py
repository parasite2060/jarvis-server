from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.core.exceptions import GitOpsError


def _make_process(stdout: str = "", stderr: str = "", returncode: int = 0) -> AsyncMock:
    proc = AsyncMock()
    proc.communicate.return_value = (stdout.encode(), stderr.encode())
    proc.returncode = returncode
    return proc


@pytest.mark.asyncio
async def test_read_dream_config_parses_yaml(tmp_path: object) -> None:
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmpdir:
        config_path = Path(tmpdir) / "config.yml"
        config_path.write_text("auto_merge: false\nmax_memory_lines: 150\n")

        with patch("app.services.git_ops.settings") as mock_settings:
            mock_settings.ai_memory_repo_path = tmpdir
            from app.services.git_ops import read_dream_config

            result = await read_dream_config()

    assert result["auto_merge"] is False
    assert result["max_memory_lines"] == 150


@pytest.mark.asyncio
async def test_read_dream_config_returns_defaults_when_missing() -> None:
    with patch("app.services.git_ops.settings") as mock_settings:
        mock_settings.ai_memory_repo_path = "/nonexistent/path"
        from app.services.git_ops import read_dream_config

        result = await read_dream_config()

    assert result["auto_merge"] is True
    assert result["max_memory_lines"] == 200


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
        from app.services.git_ops import run_git

        stdout, stderr, rc = await run_git(["status"])

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
        from app.services.git_ops import run_git

        with pytest.raises(GitOpsError, match="failed"):
            await run_git(["status"])


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
        from app.services.git_ops import run_gh

        stdout, stderr, rc = await run_gh(["pr", "create", "--title", "test"])

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
        from app.services.git_ops import run_gh

        with pytest.raises(GitOpsError, match="failed"):
            await run_gh(["pr", "create"])


@pytest.mark.asyncio
async def test_create_dream_pr_full_sequence() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch("app.services.git_ops.read_dream_config", side_effect=mock_read_config),
    ):
        from app.services.git_ops import create_dream_pr

        result = await create_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="143000"
        )

    assert result["git_branch"] == "dream/light-2026-03-31-143000"
    assert result["git_pr_url"] == "https://github.com/owner/repo/pull/42"
    assert result["git_pr_status"] == "auto_merge_enabled"


@pytest.mark.asyncio
async def test_create_dream_pr_auto_merge_false() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch("app.services.git_ops.read_dream_config", side_effect=mock_read_config),
    ):
        from app.services.git_ops import create_dream_pr

        result = await create_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="143000"
        )

    assert result["git_pr_status"] == "created"
    # Should NOT have called gh pr merge
    merge_calls = [c for c in gh_calls if c[0] == "pr" and c[1] == "merge"]
    assert len(merge_calls) == 0


@pytest.mark.asyncio
async def test_create_dream_pr_no_staged_changes() -> None:
    async def mock_run_git(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        # diff --cached --quiet returns 0 = no changes
        return ("", "", 0)

    async def mock_read_config() -> dict[str, object]:
        return {"auto_merge": True, "max_memory_lines": 200}

    gh_calls: list[list[str]] = []

    async def mock_run_gh(args: list[str], cwd: str | None = None) -> tuple[str, str, int]:
        gh_calls.append(args)
        return ("", "", 0)

    files = [{"path": "MEMORY.md", "action": "append"}]

    with (
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch("app.services.git_ops.read_dream_config", side_effect=mock_read_config),
    ):
        from app.services.git_ops import create_dream_pr

        result = await create_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="120000"
        )

    assert result["git_pr_status"] == "no_changes"
    assert result["git_pr_url"] == ""
    assert len(gh_calls) == 0


@pytest.mark.asyncio
async def test_cleanup_branch_switches_to_main() -> None:
    with (
        patch("app.services.git_ops.run_git", new_callable=AsyncMock) as mock_git,
        patch("app.services.git_ops.settings") as mock_settings,
    ):
        mock_settings.ai_memory_repo_path = "/repo"
        mock_git.return_value = ("", "", 0)
        from app.services.git_ops import cleanup_branch

        await cleanup_branch("dream/light-2026-03-31-143000")

    mock_git.assert_called_once_with(["checkout", "main"])


@pytest.mark.asyncio
async def test_cleanup_branch_logs_error_without_raising() -> None:
    with (
        patch("app.services.git_ops.run_git", new_callable=AsyncMock) as mock_git,
        patch("app.services.git_ops.settings") as mock_settings,
    ):
        mock_settings.ai_memory_repo_path = "/repo"
        mock_git.side_effect = GitOpsError("checkout failed")
        from app.services.git_ops import cleanup_branch

        # Should not raise
        await cleanup_branch("dream/light-2026-03-31-143000")


@pytest.mark.asyncio
async def test_create_dream_pr_filters_error_entries() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch("app.services.git_ops.read_dream_config", side_effect=mock_read_config),
    ):
        from app.services.git_ops import create_dream_pr

        await create_dream_pr(
            files, dream_id=1, source_date=date(2026, 3, 31), source_time="143000"
        )

    # Only MEMORY.md should be staged (dailys entry has error)
    assert git_add_args == ["MEMORY.md"]


# ── create_deep_dream_pr tests ──


@pytest.mark.asyncio
async def test_create_deep_dream_pr_correct_branch_name() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch("app.services.git_ops.read_dream_config", side_effect=mock_read_config),
    ):
        from app.services.git_ops import create_deep_dream_pr

        result = await create_deep_dream_pr(files, dream_id=5, source_date=date(2026, 3, 31))

    assert result["git_branch"] == "dream/deep-2026-03-31"
    assert result["git_pr_url"] == "https://github.com/owner/repo/pull/10"
    assert result["git_pr_status"] == "created"


@pytest.mark.asyncio
async def test_create_deep_dream_pr_commit_message_format() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch(
            "app.services.git_ops.read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        from app.services.git_ops import create_deep_dream_pr

        await create_deep_dream_pr(files, dream_id=5, source_date=date(2026, 3, 31))

    assert commit_messages == ["dream(deep): consolidate 2026-03-31"]


@pytest.mark.asyncio
async def test_create_deep_dream_pr_includes_stats_in_pr_body() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch(
            "app.services.git_ops.read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        from app.services.git_ops import create_deep_dream_pr

        await create_deep_dream_pr(files, dream_id=5, source_date=date(2026, 3, 31), stats=stats)

    assert len(pr_bodies) == 1
    body = pr_bodies[0]
    assert "Duplicates removed: 3" in body
    assert "Contradictions resolved: 1" in body
    assert "Patterns promoted: 2" in body


@pytest.mark.asyncio
async def test_create_deep_dream_pr_branch_already_exists_appends_suffix() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch(
            "app.services.git_ops.read_dream_config",
            AsyncMock(return_value={"auto_merge": False}),
        ),
    ):
        from app.services.git_ops import create_deep_dream_pr

        result = await create_deep_dream_pr(files, dream_id=5, source_date=date(2026, 3, 31))

    assert result["git_branch"] == "dream/deep-2026-03-31-2"
    assert branch_attempts[0] == "dream/deep-2026-03-31"
    assert branch_attempts[1] == "dream/deep-2026-03-31-2"


@pytest.mark.asyncio
async def test_create_deep_dream_pr_respects_auto_merge() -> None:
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
        patch("app.services.git_ops.run_git", side_effect=mock_run_git),
        patch("app.services.git_ops.run_gh", side_effect=mock_run_gh),
        patch(
            "app.services.git_ops.read_dream_config",
            AsyncMock(return_value={"auto_merge": True}),
        ),
    ):
        from app.services.git_ops import create_deep_dream_pr

        result = await create_deep_dream_pr(files, dream_id=5, source_date=date(2026, 3, 31))

    assert result["git_pr_status"] == "auto_merge_enabled"
    merge_calls = [c for c in gh_calls if c[0] == "pr" and c[1] == "merge"]
    assert len(merge_calls) == 1


@pytest.mark.asyncio
async def test_create_deep_dream_pr_empty_files_skips_git_ops() -> None:
    from app.services.git_ops import create_deep_dream_pr

    result = await create_deep_dream_pr([], dream_id=5, source_date=date(2026, 3, 31))

    assert result["git_branch"] == ""
    assert result["git_pr_url"] == ""
    assert result["git_pr_status"] == "no_files"
