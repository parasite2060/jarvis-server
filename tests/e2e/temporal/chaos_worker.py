"""Chaos test worker — standalone subprocess worker with test-specific activity stubs.

Env vars:
  CHAOS_ADDRESS      — Temporal server address
  CHAOS_NAMESPACE    — Temporal namespace
  CHAOS_TASK_QUEUE   — task queue name
  CHAOS_MODE         — "phase_resume" | "commit_and_pr" | "align_memu"
  CHAOS_COUNTER_FILE — path to counter file for align_memu chaos test
"""

from __future__ import annotations

import asyncio
import os
import sys


def _address() -> str:
    return os.environ.get("CHAOS_ADDRESS", "localhost:7233")


def _namespace() -> str:
    return os.environ.get("CHAOS_NAMESPACE", "default")


def _task_queue() -> str:
    return os.environ.get("CHAOS_TASK_QUEUE", "chaos-queue")


def _mode() -> str:
    return os.environ.get("CHAOS_MODE", "phase_resume")


async def _run_phase_resume() -> None:
    """Worker for test_resume_from_phase_3: stubs phase1/phase2/phase3."""
    from temporalio import activity
    from temporalio.client import Client
    from temporalio.worker import Worker

    from app.activities.deep._models import (
        AlignMemuInput,
        CommitAndPRResult,
        ConsolidationResult,
        DeepCommitAndPRInput,
        DeepDreamPayload,
        GatherInputsResult,
        HealthCheckInput,
        HealthFixInput,
        HealthFixResult,
        HealthReportResult,
        InvalidateCacheInput,
        LightSleepResult,
        Phase1Input,
        Phase2Input,
        Phase3Input,
        REMSleepResult,
        ScoredCandidatesResult,
        ScoringInput,
        WriteFilesInput,
        WriteFilesResult,
    )
    from app.workflows.coordinator import DreamCoordinatorWorkflow
    from app.workflows.deep_dream_workflow import DeepDreamWorkflow

    @activity.defn(name="deep.gather_inputs")
    async def stub_gather_inputs(payload: DeepDreamPayload) -> GatherInputsResult:
        dream_id_str = os.environ.get("CHAOS_DREAM_ID", "100")
        return GatherInputsResult(
            dream_id=int(dream_id_str),
            memu_memories=[{"id": "m1", "content": "chaos test memory", "category": "core"}],
            memory_md="# Memory\n\nChaos test.\n",
            daily_log="2026-05-07: Chaos test.\n",
            soul_md="# Soul\n",
            source_date_iso=payload.target_date,
        )

    @activity.defn(name="deep.phase1_light_sleep")
    async def stub_phase1(inp: Phase1Input) -> LightSleepResult:
        marker = os.environ.get("CHAOS_PHASE1_MARKER", "")
        if marker:
            with open(marker, "a") as f:  # noqa: PTH123
                f.write("phase1_completed\n")
        return LightSleepResult(
            candidates_json=[{"content": "c1", "category": "core", "reinforcement_count": 1}],
            duplicates_removed=0,
            contradictions_found=0,
        )

    @activity.defn(name="deep.score_candidates")
    async def stub_score(inp: ScoringInput) -> ScoredCandidatesResult:
        return ScoredCandidatesResult(
            scored=[
                {
                    "content": "c1",
                    "score": 0.9,
                    "category": "core",
                    "reinforcement_count": 1,
                }
            ]
        )

    @activity.defn(name="deep.phase2_rem_sleep")
    async def stub_phase2(inp: Phase2Input) -> REMSleepResult:
        marker = os.environ.get("CHAOS_PHASE2_MARKER", "")
        if marker:
            with open(marker, "a") as f:  # noqa: PTH123
                f.write("phase2_completed\n")
        return REMSleepResult(output_json={"themes": [], "new_connections": [], "gaps": []})

    @activity.defn(name="deep.phase3_deep_sleep")
    async def stub_phase3(inp: Phase3Input) -> ConsolidationResult:
        return ConsolidationResult(
            consolidation_json={
                "memory_md": "# Memory\n\nUpdated.\n",
                "stats": {},
                "categories": {},
            },
            messages_json=[],
            usage_input_tokens=50,
            usage_output_tokens=25,
            usage_total_tokens=75,
            usage_tool_calls=1,
        )

    @activity.defn(name="deep.health_check")
    async def stub_health_check(inp: HealthCheckInput) -> HealthReportResult:
        return HealthReportResult(report_json={"issues": []}, total_issues=0)

    @activity.defn(name="deep.health_fix")
    async def stub_health_fix(inp: HealthFixInput) -> HealthFixResult:
        return HealthFixResult(
            status="clean", report_json={"issues": []}, total_issues_remaining=0
        )

    @activity.defn(name="deep.write_files")
    async def stub_write_files(inp: WriteFilesInput) -> WriteFilesResult:
        return WriteFilesResult(files_modified=[{"path": "MEMORY.md", "action": "rewrite"}])

    @activity.defn(name="deep.commit_and_pr")
    async def stub_commit_and_pr(inp: DeepCommitAndPRInput) -> CommitAndPRResult:
        return CommitAndPRResult(
            git_branch=f"dream/deep-{inp.target_date_iso}",
            git_pr_url=f"https://example.com/pr/deep-{inp.target_date_iso}",
            git_pr_status="created",
        )

    @activity.defn(name="deep.align_memu")
    async def stub_align_memu(inp: AlignMemuInput) -> None:
        pass

    @activity.defn(name="deep.invalidate_cache")
    async def stub_invalidate_cache(inp: InvalidateCacheInput) -> None:
        pass

    client = await Client.connect(target_host=_address(), namespace=_namespace())
    worker = Worker(
        client,
        task_queue=_task_queue(),
        workflows=[DreamCoordinatorWorkflow, DeepDreamWorkflow],
        activities=[
            stub_gather_inputs,
            stub_phase1,
            stub_score,
            stub_phase2,
            stub_phase3,
            stub_health_check,
            stub_health_fix,
            stub_write_files,
            stub_commit_and_pr,
            stub_align_memu,
            stub_invalidate_cache,
        ],
    )
    await worker.run()


async def _run_commit_and_pr_chaos() -> None:
    """Worker for test_commit_and_pr_idempotent_after_crash."""
    import subprocess  # noqa: PLC0415

    from temporalio import activity
    from temporalio.client import Client
    from temporalio.worker import Worker

    from app.activities.light._models import (
        CommitAndPRInput,
        CommitAndPRResult,
        ExtractionAgentOutput,
        ExtractionInput,
        FileModified,
        InvalidateCacheInput,
        LightDreamPayload,
        LoadTranscriptResult,
        PersistSessionLogInput,
        RecordAgentOutput,
        RecordInput,
        UpdatePositionInput,
    )
    from app.workflows.coordinator import DreamCoordinatorWorkflow
    from app.workflows.light_dream_workflow import LightDreamWorkflow

    bare_repo = os.environ.get("CHAOS_BARE_REPO", "")
    crash_marker = os.environ.get("CHAOS_CRASH_MARKER", "")
    crash_flag_file = os.environ.get("CHAOS_CRASH_FLAG", "")

    sample_session_log = {
        "context": "",
        "key_exchanges": [],
        "decisions_made": [],
        "lessons_learned": [],
        "failed_lessons": [],
        "action_items": [],
        "concepts": [],
        "connections": [],
        "memories": [
            {
                "content": "chaos",
                "reasoning": None,
                "vault_target": "memory",
                "source_date": "2026-05-07",
            }
        ],
    }

    @activity.defn(name="light.load_transcript")
    async def stub_load(payload: LightDreamPayload) -> LoadTranscriptResult:
        return LoadTranscriptResult(
            dream_id=1,
            transcript_id=payload.transcript_id,
            session_id=payload.session_id,
            parsed_text="chaos test",
            project=None,
            token_count=100,
            is_continuation=False,
            segment_end_line=10,
            created_at_iso="2026-05-07T10:00:00+00:00",
        )

    @activity.defn(name="light.run_extraction")
    async def stub_extract(inp: ExtractionInput) -> ExtractionAgentOutput:
        return ExtractionAgentOutput(
            summary="chaos summary",
            no_extract=False,
            session_log_json=sample_session_log,
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
            tool_calls=2,
        )

    @activity.defn(name="light.persist_session_log")
    async def stub_persist(inp: PersistSessionLogInput) -> None:
        pass

    @activity.defn(name="light.run_record")
    async def stub_record(inp: RecordInput) -> RecordAgentOutput:
        return RecordAgentOutput(
            files_modified=[FileModified(path="dailys/2026-05-07.md", action="update")],
            summary="chaos log",
            source_date_iso="2026-05-07",
        )

    @activity.defn(name="light.update_transcript_position")
    async def stub_update(inp: UpdatePositionInput) -> None:
        pass

    @activity.defn(name="light.commit_and_pr")
    async def chaos_commit_and_pr(inp: CommitAndPRInput) -> CommitAndPRResult:
        import tempfile  # noqa: PLC0415

        branch = f"dream/light-{inp.session_id}"
        if not bare_repo:
            return CommitAndPRResult(
                git_branch=branch,
                git_pr_url=f"fake-pr/{branch}",
                git_pr_status="created",
            )

        work_dir = os.environ.get("CHAOS_WORK_DIR", "")
        if not work_dir or not os.path.exists(work_dir):
            work_dir = tempfile.mkdtemp(prefix="chaos-work-")

        def run(*args: str) -> None:
            subprocess.run(list(args), cwd=work_dir, capture_output=True)

        if not os.path.exists(os.path.join(work_dir, ".git")):
            run("git", "init", work_dir)
            run("git", "config", "user.email", "test@chaos.test")
            run("git", "config", "user.name", "Chaos Test")
            run("git", "remote", "add", "origin", bare_repo)
            init_file = os.path.join(work_dir, "README.md")
            with open(init_file, "w") as f:  # noqa: PTH123
                f.write("# Chaos Test Repo\n")
            run("git", "add", ".")
            run("git", "commit", "-m", "init")
            run("git", "push", "origin", "HEAD:main")

        run("git", "fetch", "origin")
        run("git", "checkout", "-B", branch, "origin/main")

        test_file = os.path.join(work_dir, "dailys", "2026-05-07.md")
        os.makedirs(os.path.dirname(test_file), exist_ok=True)
        with open(test_file, "w") as f:  # noqa: PTH123
            f.write("Chaos test daily log.\n")
        run("git", "add", ".")
        run("git", "commit", "-m", f"dream(light): chaos test {inp.session_id}")
        run("git", "push", "origin", branch)

        pr_marker = os.environ.get("CHAOS_PR_MARKER_FILE", "")
        if pr_marker and os.path.exists(pr_marker):
            with open(pr_marker) as f:  # noqa: PTH123
                existing_pr = f.read().strip()
            if existing_pr:
                return CommitAndPRResult(
                    git_branch=branch,
                    git_pr_url=existing_pr,
                    git_pr_status="existing",
                )

        should_crash = crash_flag_file and not os.path.exists(crash_flag_file)
        fake_pr_url = f"fake-pr/{branch}"

        if pr_marker:
            with open(pr_marker, "w") as f:  # noqa: PTH123
                f.write(fake_pr_url)

        if crash_marker:
            with open(crash_marker, "w") as f:  # noqa: PTH123
                f.write("crashed\n")

        if should_crash:
            if crash_flag_file:
                with open(crash_flag_file, "w") as f:  # noqa: PTH123
                    f.write("crashed\n")
            os._exit(1)

        return CommitAndPRResult(
            git_branch=branch,
            git_pr_url=fake_pr_url,
            git_pr_status="created",
        )

    @activity.defn(name="light.invalidate_cache")
    async def stub_cache(inp: InvalidateCacheInput) -> None:
        pass

    client = await Client.connect(target_host=_address(), namespace=_namespace())
    worker = Worker(
        client,
        task_queue=_task_queue(),
        workflows=[DreamCoordinatorWorkflow, LightDreamWorkflow],
        activities=[
            stub_load,
            stub_extract,
            stub_persist,
            stub_record,
            stub_update,
            chaos_commit_and_pr,
            stub_cache,
        ],
    )
    await worker.run()


async def _run_align_memu_chaos() -> None:
    """Worker for test_align_memu_idempotent_after_crash."""
    from temporalio import activity
    from temporalio.client import Client
    from temporalio.worker import Worker

    from app.activities.deep._models import (
        AlignMemuInput,
        CommitAndPRResult,
        ConsolidationResult,
        DeepCommitAndPRInput,
        DeepDreamPayload,
        GatherInputsResult,
        HealthCheckInput,
        HealthFixInput,
        HealthFixResult,
        HealthReportResult,
        InvalidateCacheInput,
        LightSleepResult,
        Phase1Input,
        Phase2Input,
        Phase3Input,
        REMSleepResult,
        ScoredCandidatesResult,
        ScoringInput,
        WriteFilesInput,
        WriteFilesResult,
    )
    from app.workflows.coordinator import DreamCoordinatorWorkflow
    from app.workflows.deep_dream_workflow import DeepDreamWorkflow

    counter_file = os.environ.get("CHAOS_COUNTER_FILE", "")
    crash_flag_file = os.environ.get("CHAOS_CRASH_FLAG", "")
    idempotency_log_file = os.environ.get("CHAOS_IDEMPOTENCY_LOG", "")

    @activity.defn(name="deep.gather_inputs")
    async def stub_gather(payload: DeepDreamPayload) -> GatherInputsResult:
        return GatherInputsResult(
            dream_id=100,
            memu_memories=[{"id": "m1", "content": "memu chaos", "category": "core"}],
            memory_md="# Memory\n",
            daily_log="2026-05-07: chaos.\n",
            soul_md="# Soul\n",
            source_date_iso=payload.target_date,
        )

    @activity.defn(name="deep.phase1_light_sleep")
    async def stub_phase1(inp: Phase1Input) -> LightSleepResult:
        return LightSleepResult(
            candidates_json=[{"content": "c1", "category": "core", "reinforcement_count": 1}],
            duplicates_removed=0,
            contradictions_found=0,
        )

    @activity.defn(name="deep.score_candidates")
    async def stub_score(inp: ScoringInput) -> ScoredCandidatesResult:
        return ScoredCandidatesResult(
            scored=[{"content": "c1", "score": 0.9, "category": "core", "reinforcement_count": 1}]
        )

    @activity.defn(name="deep.phase2_rem_sleep")
    async def stub_phase2(inp: Phase2Input) -> REMSleepResult:
        return REMSleepResult(output_json={"themes": [], "new_connections": [], "gaps": []})

    @activity.defn(name="deep.phase3_deep_sleep")
    async def stub_phase3(inp: Phase3Input) -> ConsolidationResult:
        return ConsolidationResult(
            consolidation_json={
                "memory_md": "# Memory\nUpdated.\n",
                "stats": {},
                "categories": {},
            },
            messages_json=[],
            usage_input_tokens=50,
            usage_output_tokens=25,
            usage_total_tokens=75,
            usage_tool_calls=1,
        )

    @activity.defn(name="deep.health_check")
    async def stub_health(inp: HealthCheckInput) -> HealthReportResult:
        return HealthReportResult(report_json={"issues": []}, total_issues=0)

    @activity.defn(name="deep.health_fix")
    async def stub_health_fix(inp: HealthFixInput) -> HealthFixResult:
        return HealthFixResult(
            status="clean", report_json={"issues": []}, total_issues_remaining=0
        )

    @activity.defn(name="deep.write_files")
    async def stub_write(inp: WriteFilesInput) -> WriteFilesResult:
        return WriteFilesResult(files_modified=[{"path": "MEMORY.md", "action": "rewrite"}])

    @activity.defn(name="deep.commit_and_pr")
    async def stub_commit(inp: DeepCommitAndPRInput) -> CommitAndPRResult:
        return CommitAndPRResult(
            git_branch=f"dream/deep-{inp.target_date_iso}",
            git_pr_url=f"fake-pr/deep-{inp.target_date_iso}",
            git_pr_status="created",
        )

    @activity.defn(name="deep.align_memu")
    async def chaos_align_memu(inp: AlignMemuInput) -> None:
        if idempotency_log_file and os.path.exists(idempotency_log_file):
            with open(idempotency_log_file) as f:  # noqa: PTH123
                processed_keys = f.read().split()
            if inp.idempotency_key in processed_keys:
                return

        if counter_file:
            current = 0
            if os.path.exists(counter_file):
                with open(counter_file) as f:  # noqa: PTH123
                    try:
                        current = int(f.read().strip())
                    except ValueError:
                        current = 0
            with open(counter_file, "w") as f:  # noqa: PTH123
                f.write(str(current + 1))

        should_crash = crash_flag_file and not os.path.exists(crash_flag_file)

        if should_crash:
            with open(crash_flag_file, "w") as f:  # noqa: PTH123
                f.write("crashed\n")
            os._exit(1)

        if idempotency_log_file:
            with open(idempotency_log_file, "a") as f:  # noqa: PTH123
                f.write(inp.idempotency_key + "\n")

    @activity.defn(name="deep.invalidate_cache")
    async def stub_cache(inp: InvalidateCacheInput) -> None:
        pass

    client = await Client.connect(target_host=_address(), namespace=_namespace())
    worker = Worker(
        client,
        task_queue=_task_queue(),
        workflows=[DreamCoordinatorWorkflow, DeepDreamWorkflow],
        activities=[
            stub_gather,
            stub_phase1,
            stub_score,
            stub_phase2,
            stub_phase3,
            stub_health,
            stub_health_fix,
            stub_write,
            stub_commit,
            chaos_align_memu,
            stub_cache,
        ],
    )
    await worker.run()


def main() -> None:
    mode = _mode()
    if mode == "phase_resume":
        asyncio.run(_run_phase_resume())
    elif mode == "commit_and_pr":
        asyncio.run(_run_commit_and_pr_chaos())
    elif mode == "align_memu":
        asyncio.run(_run_align_memu_chaos())
    else:
        print(f"Unknown CHAOS_MODE: {mode}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
