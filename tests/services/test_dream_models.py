from app.services.dream_models import (
    ALLOWED_VAULT_TARGETS,
    ConnectionCandidate,
    HealthReport,
    KnowledgeGap,
    LightSleepOutput,
    PromotionCandidate,
    REMSleepOutput,
    ScoredCandidate,
    SessionLogEntry,
    Theme,
    VaultFileEntry,
    VaultUpdates,
    WeeklyReviewOutput,
)


class TestAllowedVaultTargets:
    def test_includes_original_targets(self) -> None:
        original = {"memory", "decisions", "patterns", "projects", "templates"}
        assert original.issubset(set(ALLOWED_VAULT_TARGETS))

    def test_includes_new_targets(self) -> None:
        new = {"concepts", "connections", "lessons", "references", "reviews"}
        assert new.issubset(set(ALLOWED_VAULT_TARGETS))

    def test_total_count(self) -> None:
        assert len(ALLOWED_VAULT_TARGETS) == 10


class TestSessionLogEntry:
    def test_default_values(self) -> None:
        entry = SessionLogEntry()
        assert entry.context == ""
        assert entry.key_exchanges == []
        assert entry.decisions_made == []
        assert entry.lessons_learned == []
        assert entry.action_items == []
        assert entry.concepts == []
        assert entry.connections == []

    def test_new_fields_accept_data(self) -> None:
        entry = SessionLogEntry(
            context="Test session",
            key_exchanges=["User asked about X — answer was Y"],
            concepts=[{"name": "DDD", "description": "Domain-Driven Design"}],
            connections=[
                {
                    "concept_a": "DDD",
                    "concept_b": "Clean Architecture",
                    "relationship": "complementary patterns",
                }
            ],
        )
        assert len(entry.key_exchanges) == 1
        assert entry.concepts[0]["name"] == "DDD"
        assert entry.connections[0]["concept_a"] == "DDD"


class TestScoredCandidate:
    def test_default_values(self) -> None:
        candidate = ScoredCandidate(content="Use Python 3.12", category="facts")
        assert candidate.content == "Use Python 3.12"
        assert candidate.category == "facts"
        assert candidate.reinforcement_count == 0
        assert candidate.contradiction_flag is False
        assert candidate.source_sessions == []

    def test_with_all_fields(self) -> None:
        candidate = ScoredCandidate(
            content="Prefer async patterns",
            category="patterns",
            reinforcement_count=3,
            contradiction_flag=True,
            source_sessions=["session-1", "session-2"],
        )
        assert candidate.reinforcement_count == 3
        assert candidate.contradiction_flag is True
        assert len(candidate.source_sessions) == 2


class TestLightSleepOutput:
    def test_default_values(self) -> None:
        output = LightSleepOutput()
        assert output.candidates == []
        assert output.duplicates_removed == 0
        assert output.contradictions_found == 0

    def test_with_candidates(self) -> None:
        candidates = [
            ScoredCandidate(content="Use Python", category="decisions"),
            ScoredCandidate(
                content="Prefer dark mode",
                category="preferences",
                contradiction_flag=True,
            ),
        ]
        output = LightSleepOutput(
            candidates=candidates,
            duplicates_removed=3,
            contradictions_found=1,
        )
        assert len(output.candidates) == 2
        assert output.duplicates_removed == 3
        assert output.contradictions_found == 1
        assert output.candidates[1].contradiction_flag is True

    def test_empty_candidates_indicates_skip(self) -> None:
        output = LightSleepOutput()
        assert len(output.candidates) == 0


class TestVaultUpdates:
    def test_default_empty_lists(self) -> None:
        vu = VaultUpdates()
        assert vu.decisions == []
        assert vu.projects == []
        assert vu.patterns == []
        assert vu.templates == []
        assert vu.concepts == []
        assert vu.connections == []
        assert vu.lessons == []

    def test_new_fields_accept_entries(self) -> None:
        entry = VaultFileEntry(
            filename="test.md",
            title="Test",
            summary="A test entry",
            content="# Test\n\nContent",
            action="create",
        )
        vu = VaultUpdates(concepts=[entry], connections=[entry], lessons=[entry])
        assert len(vu.concepts) == 1
        assert len(vu.connections) == 1
        assert len(vu.lessons) == 1


class TestTheme:
    def test_default_values(self) -> None:
        theme = Theme(topic="async patterns")
        assert theme.topic == "async patterns"
        assert theme.session_count == 0
        assert theme.evidence == []

    def test_with_all_fields(self) -> None:
        theme = Theme(
            topic="error handling",
            session_count=3,
            evidence=["session-1: used Result type", "session-2: no try-catch"],
        )
        assert theme.session_count == 3
        assert len(theme.evidence) == 2


class TestConnectionCandidate:
    def test_required_fields(self) -> None:
        conn = ConnectionCandidate(
            concept_a="DDD",
            concept_b="Clean Architecture",
            relationship="complementary patterns",
        )
        assert conn.concept_a == "DDD"
        assert conn.concept_b == "Clean Architecture"
        assert conn.relationship == "complementary patterns"
        assert conn.evidence_sessions == []

    def test_with_evidence_sessions(self) -> None:
        conn = ConnectionCandidate(
            concept_a="FastAPI",
            concept_b="Pydantic",
            relationship="validation layer",
            evidence_sessions=["2026-04-01", "2026-04-03"],
        )
        assert len(conn.evidence_sessions) == 2


class TestPromotionCandidate:
    def test_required_fields(self) -> None:
        promo = PromotionCandidate(
            source_file="lessons/error-handling.md",
            target_folder="patterns",
            reason="Appeared in 4 different contexts",
        )
        assert promo.source_file == "lessons/error-handling.md"
        assert promo.target_folder == "patterns"
        assert promo.reason == "Appeared in 4 different contexts"


class TestKnowledgeGap:
    def test_default_values(self) -> None:
        gap = KnowledgeGap(concept="event sourcing")
        assert gap.concept == "event sourcing"
        assert gap.mentioned_in_files == []

    def test_with_mentions(self) -> None:
        gap = KnowledgeGap(
            concept="CQRS",
            mentioned_in_files=["dailys/2026-04-01.md", "dailys/2026-04-03.md"],
        )
        assert len(gap.mentioned_in_files) == 2


class TestREMSleepOutput:
    def test_default_values(self) -> None:
        output = REMSleepOutput()
        assert output.themes == []
        assert output.new_connections == []
        assert output.promotion_candidates == []
        assert output.gaps == []

    def test_with_all_fields(self) -> None:
        output = REMSleepOutput(
            themes=[Theme(topic="async", session_count=2)],
            new_connections=[
                ConnectionCandidate(
                    concept_a="A", concept_b="B", relationship="related"
                )
            ],
            promotion_candidates=[
                PromotionCandidate(
                    source_file="lessons/x.md",
                    target_folder="patterns",
                    reason="3+ contexts",
                )
            ],
            gaps=[KnowledgeGap(concept="missing-concept")],
        )
        assert len(output.themes) == 1
        assert len(output.new_connections) == 1
        assert len(output.promotion_candidates) == 1
        assert len(output.gaps) == 1

    def test_empty_output_is_valid(self) -> None:
        output = REMSleepOutput()
        assert len(output.themes) == 0
        assert len(output.new_connections) == 0


class TestHealthReport:
    def test_default_values(self) -> None:
        report = HealthReport()
        assert report.orphan_notes == []
        assert report.stale_notes == []
        assert report.missing_frontmatter == []
        assert report.unresolved_contradictions == []
        assert report.memory_overflow is False
        assert report.knowledge_gaps == []
        assert report.total_issues == 0

    def test_with_all_fields(self) -> None:
        report = HealthReport(
            orphan_notes=["concepts/orphan.md"],
            stale_notes=["patterns/old.md"],
            missing_frontmatter=["decisions/no-fm.md"],
            unresolved_contradictions=["decisions/conflict.md"],
            memory_overflow=True,
            knowledge_gaps=["event sourcing"],
            total_issues=5,
        )
        assert len(report.orphan_notes) == 1
        assert len(report.stale_notes) == 1
        assert report.memory_overflow is True
        assert report.total_issues == 5

    def test_model_dump_serializes(self) -> None:
        report = HealthReport(
            orphan_notes=["a.md"],
            total_issues=1,
        )
        data = report.model_dump()
        assert data["orphan_notes"] == ["a.md"]
        assert data["total_issues"] == 1
        assert data["memory_overflow"] is False


class TestWeeklyReviewOutput:
    def test_default_values(self) -> None:
        output = WeeklyReviewOutput()
        assert output.review_content == ""
        assert output.week_themes == []
        assert output.stale_action_items == []
        assert output.project_updates == {}

    def test_with_all_fields(self) -> None:
        output = WeeklyReviewOutput(
            review_content="# Weekly Review\n## Themes\n- Architecture",
            week_themes=["Architecture", "Testing"],
            stale_action_items=["Update docs", "Fix CI"],
            project_updates={"jarvis": "Completed feature X"},
        )
        assert len(output.week_themes) == 2
        assert len(output.stale_action_items) == 2
        assert output.project_updates["jarvis"] == "Completed feature X"
        assert "# Weekly Review" in output.review_content

    def test_model_dump_serializes(self) -> None:
        output = WeeklyReviewOutput(
            review_content="content",
            week_themes=["theme1"],
            project_updates={"proj": "update"},
        )
        data = output.model_dump()
        assert data["review_content"] == "content"
        assert data["week_themes"] == ["theme1"]
        assert data["project_updates"] == {"proj": "update"}
        assert data["stale_action_items"] == []
