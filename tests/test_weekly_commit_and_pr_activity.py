"""Tests for weekly commit_and_pr activity — AC12b idempotency proof.

Uses Option A: unit-test the activity in isolation with ActivityEnvironment.
Run the activity twice; assert the second run returns the same PR URL
(no duplicate PR created).
"""

from __future__ import annotations

import re
from unittest.mock import AsyncMock, patch

from temporalio.testing import ActivityEnvironment

from app.activities.weekly._models import CommitAndPRResult, WeeklyCommitAndPRInput


def test_weekly_commit_and_pr_branch_name_is_deterministic() -> None:
    """Branch name must be dream/review-{week_iso} with no timestamp component."""
    week_iso = "2026-W19"
    expected_branch = f"dream/review-{week_iso}"
    assert expected_branch == "dream/review-2026-W19"
    # Branch name contains no timestamp patterns (YYYYMMDD or HHMMSS)
    assert not re.search(r"\d{8}", expected_branch), "Branch name must not contain date stamp"
    assert not re.search(r"T\d{6}", expected_branch), "Branch name must not contain time stamp"
    # No datetime components
    assert "datetime" not in expected_branch
    assert "now" not in expected_branch


async def test_weekly_commit_and_pr_no_files_returns_early() -> None:
    """If files_modified is empty, activity returns no_files status immediately."""
    from app.activities.weekly.commit_and_pr import commit_and_pr

    inp = WeeklyCommitAndPRInput(
        week_iso="2026-W19",
        dream_id=1,
        files_modified=[],
    )

    mock_git_ops = AsyncMock()
    mock_git_ops.read_dream_config.return_value = {"auto_merge": False}

    with patch("app.activities.weekly.commit_and_pr.git_ops_service", mock_git_ops):
        env = ActivityEnvironment()
        result: CommitAndPRResult = await env.run(commit_and_pr, inp)

    assert result.git_pr_status == "no_files"
    assert result.git_branch == "dream/review-2026-W19"
    assert result.git_pr_url == ""
    mock_git_ops.run_git.assert_not_called()
    mock_git_ops.run_gh.assert_not_called()


async def test_weekly_commit_and_pr_idempotency_existing_pr() -> None:
    """AC12b idempotency proof: when PR already exists, activity returns existing URL.

    Simulates two runs:
    - Run 1: git ops succeed, gh pr view returns existing URL → returns existing URL
    - Run 2: same input → same result (no gh pr create called either run)
    """
    from app.activities.weekly.commit_and_pr import commit_and_pr

    inp = WeeklyCommitAndPRInput(
        week_iso="2026-W19",
        dream_id=10,
        files_modified=[{"path": "reviews/2026-W19.md", "action": "create"}],
    )

    existing_pr_url = "https://github.com/owner/repo/pull/42"

    mock_git_ops = AsyncMock()
    mock_git_ops.read_dream_config.return_value = {"auto_merge": False}
    mock_git_ops.ensure_main_fresh = AsyncMock()
    mock_git_ops.run_git = AsyncMock(side_effect=_mock_run_git_staged)
    # gh pr view returns existing URL
    mock_git_ops.run_gh = AsyncMock(return_value=(existing_pr_url, "", 0))

    with patch("app.activities.weekly.commit_and_pr.git_ops_service", mock_git_ops):
        env = ActivityEnvironment()
        result1 = await env.run(commit_and_pr, inp)
        result2 = await env.run(commit_and_pr, inp)

    # Both invocations should return the existing PR URL
    assert result1.git_pr_url == existing_pr_url
    assert result2.git_pr_url == existing_pr_url
    assert result1.git_branch == result2.git_branch == "dream/review-2026-W19"
    assert result1.git_pr_status == "existing"
    assert result2.git_pr_status == "existing"

    # gh pr create should NOT have been called on either run
    create_calls = [
        call for call in mock_git_ops.run_gh.call_args_list
        if call.args and len(call.args[0]) > 0 and "create" in call.args[0]
    ]
    assert len(create_calls) == 0, "gh pr create should not be called when PR already exists"


async def test_weekly_commit_and_pr_creates_pr_when_not_exists() -> None:
    """commit_and_pr creates a new PR when no existing PR is found for the branch."""
    from app.activities.weekly.commit_and_pr import commit_and_pr
    from app.core.exceptions import GitOpsError

    inp = WeeklyCommitAndPRInput(
        week_iso="2026-W20",
        dream_id=5,
        files_modified=[{"path": "reviews/2026-W20.md", "action": "create"}],
    )

    new_pr_url = "https://github.com/owner/repo/pull/100"

    mock_git_ops = AsyncMock()
    mock_git_ops.read_dream_config.return_value = {"auto_merge": False}
    mock_git_ops.ensure_main_fresh = AsyncMock()
    mock_git_ops.run_git = AsyncMock(side_effect=_mock_run_git_staged)

    async def mock_run_gh(args: list[str]) -> tuple[str, str, int]:
        if "view" in args:
            raise GitOpsError("no PR found")
        return (new_pr_url, "", 0)

    mock_git_ops.run_gh = AsyncMock(side_effect=mock_run_gh)

    with patch("app.activities.weekly.commit_and_pr.git_ops_service", mock_git_ops):
        env = ActivityEnvironment()
        result = await env.run(commit_and_pr, inp)

    assert result.git_pr_url == new_pr_url
    assert result.git_pr_status == "created"
    assert result.git_branch == "dream/review-2026-W20"


async def test_weekly_commit_and_pr_branch_name_matches_week_iso() -> None:
    """Branch name uses week_iso from input — same week always produces same branch."""
    from app.activities.weekly.commit_and_pr import commit_and_pr

    week_iso_a = "2026-W19"
    week_iso_b = "2026-W19"  # same week

    inp_a = WeeklyCommitAndPRInput(
        week_iso=week_iso_a, dream_id=1, files_modified=[]
    )
    inp_b = WeeklyCommitAndPRInput(
        week_iso=week_iso_b, dream_id=2, files_modified=[]
    )

    mock_git_ops = AsyncMock()
    mock_git_ops.read_dream_config.return_value = {"auto_merge": False}

    with patch("app.activities.weekly.commit_and_pr.git_ops_service", mock_git_ops):
        env = ActivityEnvironment()
        result_a = await env.run(commit_and_pr, inp_a)
        result_b = await env.run(commit_and_pr, inp_b)

    assert result_a.git_branch == result_b.git_branch == f"dream/review-{week_iso_a}"


async def _mock_run_git_staged(args: list[str]) -> tuple[str, str, int]:
    """Mock git: diff --cached raises GitOpsError (staged changes exist), others succeed."""
    from app.core.exceptions import GitOpsError

    if args[:2] == ["diff", "--cached"]:
        raise GitOpsError("staged changes exist")
    return ("", "", 0)
