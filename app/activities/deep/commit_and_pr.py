from __future__ import annotations

from datetime import date

from temporalio import activity

from app.activities.deep._models import CommitAndPRResult, DeepCommitAndPRInput
from app.services.git_ops import git_ops_service


@activity.defn(name="deep.commit_and_pr")
async def commit_and_pr(inp: DeepCommitAndPRInput) -> CommitAndPRResult:
    target_date = date.fromisoformat(inp.target_date_iso)
    # Deterministic branch name — never uses datetime.now() or run ID
    branch_name = f"dream/deep-{target_date.isoformat()}"

    file_paths = [
        fm.get("path", "") if isinstance(fm, dict) else str(fm)
        for fm in inp.files_modified
        if (fm.get("path") if isinstance(fm, dict) else fm)
    ]

    if not file_paths:
        return CommitAndPRResult(
            git_branch=branch_name,
            git_pr_url="",
            git_pr_status="no_files",
        )

    config = await git_ops_service.read_dream_config()
    auto_merge = bool(config.get("auto_merge", True))

    await git_ops_service.ensure_main_fresh()

    # Idempotent: git fetch && git checkout -B resets if already exists
    await git_ops_service.run_git(["fetch", "origin"])
    await git_ops_service.run_git(["checkout", "-B", branch_name, "origin/main"])

    await git_ops_service.run_git(["add"] + file_paths)

    try:
        await git_ops_service.run_git(["diff", "--cached", "--quiet"])
        # No staged changes — push anyway in case of partial success
        try:
            await git_ops_service.run_git(["push", "origin", branch_name, "--force-with-lease"])
        except Exception:
            pass
    except Exception:
        commit_msg = f"dream(deep): consolidate {target_date.isoformat()}"
        await git_ops_service.run_git(["commit", "-m", commit_msg])
        await git_ops_service.run_git(["push", "origin", branch_name])

    # Check if PR already exists (idempotency)
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
    stats = inp.stats
    pr_title = f"dream(deep): consolidate {target_date.isoformat()}"
    pr_body = (
        f"## Dream Deep Consolidation\n\n"
        f"**Dream ID:** {inp.dream_id}\n"
        f"**Date:** {target_date.isoformat()}\n\n"
        f"### Stats\n"
        f"- Memories processed: {stats.get('total_memories_processed', 0)}\n"
        f"- Duplicates removed: {stats.get('duplicates_removed', 0)}\n"
        f"- Contradictions resolved: {stats.get('contradictions_resolved', 0)}\n\n"
        f"### Changed Files\n"
        + "\n".join(f"- `{p}`" for p in file_paths)
    )

    pr_stdout, _, _ = await git_ops_service.run_gh(
        ["pr", "create", "--title", pr_title, "--body", pr_body, "--base", "main"]
    )
    pr_url = pr_stdout.strip()
    pr_status = "created"

    if auto_merge:
        try:
            await git_ops_service.run_gh(["pr", "merge", "--squash", "--delete-branch", pr_url])
            pr_status = "merged"
        except Exception:
            pass

    try:
        await git_ops_service.cleanup_branch(branch_name)
    except Exception:
        pass

    return CommitAndPRResult(
        git_branch=branch_name,
        git_pr_url=pr_url,
        git_pr_status=pr_status,
    )
