from __future__ import annotations

from datetime import date

from temporalio import activity

from app.activities.light._models import CommitAndPRInput, CommitAndPRResult
from app.services.git_ops import git_ops_service


@activity.defn(name="light.commit_and_pr")
async def commit_and_pr(inp: CommitAndPRInput) -> CommitAndPRResult:

    branch_name = f"dream/light-{inp.session_id}"
    source_date = date.fromisoformat(inp.source_date_iso)

    file_paths = [f.path for f in inp.files_modified if f.path]

    if not file_paths:
        return CommitAndPRResult(
            git_branch=branch_name,
            git_pr_url="",
            git_pr_status="no_files",
        )

    config = await git_ops_service.read_dream_config()
    auto_merge = bool(config.get("auto_merge", True))

    await git_ops_service.ensure_main_fresh()

    # Idempotent branch creation: git checkout -B resets if already exists
    await git_ops_service.run_git(["fetch", "origin"])
    await git_ops_service.run_git(["checkout", "-B", branch_name, "origin/main"])

    await git_ops_service.run_git(["add"] + file_paths)

    # Check if there are staged changes (no-op if already committed on retry)
    try:
        await git_ops_service.run_git(["diff", "--cached", "--quiet"])
        # No staged changes — branch may already be committed, push in case of partial success
        try:
            await git_ops_service.run_git(["push", "origin", branch_name, "--force-with-lease"])
        except Exception:
            pass
    except Exception:
        # There are staged changes — commit and push
        commit_msg = f"dream(light): extract session {source_date.isoformat()}"
        await git_ops_service.run_git(["commit", "-m", commit_msg])
        await git_ops_service.run_git(["push", "origin", branch_name])

    # Check if PR already exists for this branch (idempotency)
    try:
        pr_stdout, _, _ = await git_ops_service.run_gh(
            ["pr", "view", branch_name, "--json", "url", "--jq", ".url"]
        )
        pr_url = pr_stdout.strip()
        if pr_url:
            return CommitAndPRResult(
                git_branch=branch_name,
                git_pr_url=pr_url,
                git_pr_status="existing",
            )
    except Exception:
        pass

    # Create new PR
    pr_title = f"dream(light): extract session {source_date.isoformat()}"
    summary_excerpt = (inp.extraction_summary or "")[:200]
    pr_body = (
        f"## Dream Light Extract\n\n"
        f"**Dream ID:** {inp.dream_id}\n"
        f"**Session:** {inp.session_id}\n"
        f"**Date:** {source_date.isoformat()}\n\n"
        f"### Summary\n{summary_excerpt}\n\n"
        f"### Changed Files\n"
        + "\n".join(f"- `{p}`" for p in file_paths)
        + f"\n\n**Files modified:** {len(file_paths)}"
    )
    pr_stdout, _, _ = await git_ops_service.run_gh(
        [
            "pr",
            "create",
            "--title",
            pr_title,
            "--body",
            pr_body,
            "--base",
            "main",
        ]
    )
    pr_url = pr_stdout.strip()
    pr_status = "created"

    if auto_merge:
        try:
            await git_ops_service.run_gh(["pr", "merge", "--squash", "--delete-branch", pr_url])
            pr_status = "merged"
        except Exception:
            pass

    return CommitAndPRResult(
        git_branch=branch_name,
        git_pr_url=pr_url,
        git_pr_status=pr_status,
    )
