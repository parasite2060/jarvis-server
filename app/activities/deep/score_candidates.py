from __future__ import annotations

from temporalio import activity

from app.activities.deep._models import ScoredCandidatesResult, ScoringInput
from app.services.deep_dream import calculate_candidate_score


@activity.defn(name="deep.score_candidates")
async def score_candidates(inp: ScoringInput) -> ScoredCandidatesResult:
    scored: list[dict] = []
    for candidate in inp.candidates_json:
        score = calculate_candidate_score(
            reinforcement_count=candidate.get("reinforcement_count", 0),
            days_since_reinforced=0,
            in_active_project=True,
            has_contradiction=candidate.get("contradiction_flag", False),
            context_count=len(candidate.get("source_sessions", [])),
        )
        scored.append({**candidate, "score": round(score, 4)})

    return ScoredCandidatesResult(scored=scored)
