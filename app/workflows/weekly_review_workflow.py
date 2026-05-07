# DETERMINISM RULES — Temporal replays this workflow code on recovery.
# Any non-deterministic call breaks replay. Forbidden in this module:
#   - datetime.now(), datetime.utcnow(), time.time()
#   - random.*, secrets.*
#   - uuid.uuid4(), uuid.uuid1()
#   - file I/O, network I/O, DB queries
#   - asyncio.create_task() (use workflow.start_activity / workflow.execute_child_workflow)
#   - sys.argv, environment variable reads
# Allowed deterministic primitives:
#   - workflow.now(), workflow.uuid4(), workflow.random()
#   - workflow.wait_condition(), workflow.execute_child_workflow()
#   - workflow.signal handlers, workflow.query handlers
#   - pure-Python data manipulation (collections.deque, dicts, etc.)

from __future__ import annotations

from datetime import date, timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

from app.activities.weekly._models import (
    AgentInput,
    AgentResult,
    GatherDailysResult,
    GatherIndexesInput,
    GatherIndexesResult,
    WeeklyCommitAndPRInput,
    WeeklyReviewPayload,
    WeeklyReviewResult,
    WriteReviewInput,
    WriteReviewResult,
)

with workflow.unsafe.imports_passed_through():
    from app.activities.weekly.commit_and_pr import commit_and_pr
    from app.activities.weekly.gather_dailys import gather_dailys
    from app.activities.weekly.gather_indexes import gather_indexes
    from app.activities.weekly.run_weekly_review_agent import run_weekly_review_agent
    from app.activities.weekly.write_review_file import write_review_file


def _week_number(week_start_iso: str) -> str:
    d = date.fromisoformat(week_start_iso)
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


@workflow.defn(name="WeeklyReview")
class WeeklyReviewWorkflow:
    @workflow.run
    async def run(self, payload: WeeklyReviewPayload) -> WeeklyReviewResult:
        # Activity 1: gather_dailys — collect last 7 days + create Dream row
        gather_dailys_result: GatherDailysResult = await workflow.execute_activity(
            gather_dailys,
            payload,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=10),
                maximum_attempts=3,
            ),
        )

        dream_id = gather_dailys_result.dream_id

        # Activity 2: gather_indexes — collect all _index.md files from vault folders
        gather_indexes_result: GatherIndexesResult = await workflow.execute_activity(
            gather_indexes,
            GatherIndexesInput(dream_id=dream_id, week_start=payload.week_start),
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=10),
                maximum_attempts=3,
            ),
        )

        # Activity 3: run_weekly_review_agent — invoke PydanticAI weekly-review agent
        # Also writes dream_phases row (Story 11.2 invariant)
        agent_result: AgentResult = await workflow.execute_activity(
            run_weekly_review_agent,
            AgentInput(
                dream_id=dream_id,
                week_start=payload.week_start,
                daily_logs=gather_dailys_result.daily_logs,
                vault_indexes=gather_indexes_result.vault_indexes,
                vault_guide=gather_indexes_result.vault_guide,
            ),
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(seconds=60),
                maximum_attempts=2,
            ),
        )

        pr_url: str | None = None

        if agent_result.review_content:
            # Activity 4: write_review_file — atomic write to reviews/YYYY-Www.md
            write_result: WriteReviewResult = await workflow.execute_activity(
                write_review_file,
                WriteReviewInput(
                    dream_id=dream_id,
                    week_start=payload.week_start,
                    review_content=agent_result.review_content,
                ),
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=1),
                    backoff_coefficient=2.0,
                    maximum_interval=timedelta(seconds=10),
                    maximum_attempts=3,
                ),
            )

            # Activity 5: commit_and_pr — deterministic branch dream/review-{week_iso}
            week_iso = _week_number(payload.week_start)
            commit_result = await workflow.execute_activity(
                commit_and_pr,
                WeeklyCommitAndPRInput(
                    dream_id=dream_id,
                    week_iso=week_iso,
                    files_modified=write_result.files_modified,
                ),
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=2),
                    backoff_coefficient=2.0,
                    maximum_interval=timedelta(seconds=30),
                    maximum_attempts=3,
                ),
            )
            pr_url = commit_result.git_pr_url or None

        return WeeklyReviewResult(dream_id=dream_id, pr_url=pr_url)
