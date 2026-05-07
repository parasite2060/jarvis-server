"""Worker-only entrypoint — no FastAPI, used by chaos tests to spawn a killable process."""

from __future__ import annotations

import argparse
import asyncio

from temporalio.client import Client
from temporalio.worker import Worker


async def _run(address: str, namespace: str, task_queue: str) -> None:
    from app.activities.deep.align_memu import align_memu
    from app.activities.deep.commit_and_pr import commit_and_pr as deep_commit_and_pr
    from app.activities.deep.gather_inputs import gather_inputs
    from app.activities.deep.health_check import health_check
    from app.activities.deep.health_fix import health_fix
    from app.activities.deep.invalidate_cache import invalidate_cache as deep_invalidate_cache
    from app.activities.deep.phase1_light_sleep import phase1_light_sleep
    from app.activities.deep.phase2_rem_sleep import phase2_rem_sleep
    from app.activities.deep.phase3_deep_sleep import phase3_deep_sleep
    from app.activities.deep.score_candidates import score_candidates
    from app.activities.deep.write_files import write_files
    from app.activities.light.commit_and_pr import commit_and_pr
    from app.activities.light.invalidate_cache import invalidate_cache
    from app.activities.light.load_transcript import load_transcript
    from app.activities.light.persist_session_log import persist_session_log
    from app.activities.light.run_extraction import run_extraction
    from app.activities.light.run_record import run_record
    from app.activities.light.update_transcript_position import update_transcript_position
    from app.activities.weekly.commit_and_pr import commit_and_pr as weekly_commit_and_pr
    from app.activities.weekly.gather_dailys import gather_dailys
    from app.activities.weekly.gather_indexes import gather_indexes
    from app.activities.weekly.run_weekly_review_agent import run_weekly_review_agent
    from app.activities.weekly.write_review_file import write_review_file
    from app.workflows.coordinator import DreamCoordinatorWorkflow
    from app.workflows.deep_dream_workflow import DeepDreamWorkflow
    from app.workflows.light_dream_workflow import LightDreamWorkflow
    from app.workflows.schedule_relay import ScheduleSignalRelayWorkflow
    from app.workflows.weekly_review_workflow import WeeklyReviewWorkflow

    client = await Client.connect(target_host=address, namespace=namespace)
    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=[
            DreamCoordinatorWorkflow,
            LightDreamWorkflow,
            DeepDreamWorkflow,
            WeeklyReviewWorkflow,
            ScheduleSignalRelayWorkflow,
        ],
        activities=[
            load_transcript,
            run_extraction,
            persist_session_log,
            run_record,
            update_transcript_position,
            commit_and_pr,
            invalidate_cache,
            gather_inputs,
            phase1_light_sleep,
            score_candidates,
            phase2_rem_sleep,
            phase3_deep_sleep,
            health_check,
            health_fix,
            write_files,
            deep_commit_and_pr,
            align_memu,
            deep_invalidate_cache,
            gather_dailys,
            gather_indexes,
            run_weekly_review_agent,
            write_review_file,
            weekly_commit_and_pr,
        ],
    )
    await worker.run()


def main() -> None:
    parser = argparse.ArgumentParser(description="Jarvis Temporal worker (no FastAPI)")
    parser.add_argument("--address", default="localhost:7233")
    parser.add_argument("--namespace", default="default")
    parser.add_argument("--task-queue", default="jarvis-dream")
    args = parser.parse_args()
    asyncio.run(_run(args.address, args.namespace, args.task_queue))


if __name__ == "__main__":
    main()
