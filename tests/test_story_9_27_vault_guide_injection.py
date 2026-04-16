"""Tests for Story 9.27: Vault Guide as Source of Truth — Inject _guide.md into Dream Agents."""

from pathlib import Path


# ── Path constants ──

_ROOT = Path(__file__).resolve().parents[1]
GUIDE_PATH = _ROOT / "docs" / "deployment" / "templates-ai-memory" / "_guide.md"
CONSOLIDATION_PROMPT_PATH = _ROOT / "prompts" / "deep_dream_consolidate.md"
RECORD_PROMPT_PATH = _ROOT / "prompts" / "record_agent.md"
WEEKLY_REVIEW_PROMPT_PATH = _ROOT / "prompts" / "weekly_review_agent.md"
DEEP_DREAM_TASK_PATH = _ROOT / "app" / "tasks" / "deep_dream_task.py"
DREAM_AGENT_PATH = _ROOT / "app" / "services" / "dream_agent.py"
WEEKLY_REVIEW_TASK_PATH = _ROOT / "app" / "tasks" / "weekly_review_task.py"
DREAM_MODELS_PATH = _ROOT / "app" / "services" / "dream_models.py"
VAULT_UPDATER_PATH = _ROOT / "app" / "services" / "vault_updater.py"


# ── AC6: _guide.md contains detailed templates for ALL file types ──


class TestGuideContainsDetailedTemplates:

    def setup_method(self) -> None:
        self.content = GUIDE_PATH.read_text(encoding="utf-8")

    def test_decisions_adr_with_alternatives_and_consequences(self) -> None:
        assert "### decisions/" in self.content
        assert "Alternatives Considered" in self.content
        assert "### Positive" in self.content
        assert "### Negative" in self.content
        assert "### Trade-offs Accepted" in self.content

    def test_patterns_with_code_pattern_and_evidence(self) -> None:
        assert "### patterns/" in self.content
        assert "## Code Pattern" in self.content
        assert "## Evidence" in self.content
        assert "## Apply When" in self.content

    def test_lessons_with_root_cause_and_fix(self) -> None:
        assert "### lessons/" in self.content
        assert "## What Happened" in self.content
        assert "Root cause" in self.content
        assert "## Fix" in self.content

    def test_concepts_with_how_it_works_and_gotchas(self) -> None:
        assert "### concepts/" in self.content
        assert "## How It Works" in self.content
        assert "## Gotchas" in self.content

    def test_connections_with_mapping_table(self) -> None:
        assert "### connections/" in self.content
        assert "## Mapping" in self.content
        assert "## Evidence" in self.content
        assert "## Implications" in self.content

    def test_projects_with_tech_stack_and_structure(self) -> None:
        assert "### projects/" in self.content
        assert "## Tech Stack" in self.content
        assert "## Project Structure" in self.content
        assert "## Environment Setup" in self.content
        assert "## Current Phase" in self.content

    def test_templates_with_steps_and_gotchas(self) -> None:
        assert "### templates/" in self.content
        assert "## When to Use" in self.content
        assert "## Gotchas to Remember" in self.content

    def test_topics_deep_dive(self) -> None:
        assert "### topics/" in self.content
        assert "## How It Works" in self.content

    def test_dailys_session_log(self) -> None:
        assert "### dailys/" in self.content
        assert "session_id" in self.content
        assert "Key Exchanges" in self.content
        assert "Decisions Made" in self.content
        assert "Lessons Learned" in self.content

    def test_reviews_weekly_format(self) -> None:
        assert "### reviews/" in self.content
        assert "## Week Summary" in self.content
        assert "## Patterns Reinforced" in self.content
        assert "## Lifecycle Transitions" in self.content


# ── AC4: consolidation prompt references Vault Guide, no inline templates ──


class TestConsolidationPromptReferencesVaultGuide:

    def setup_method(self) -> None:
        self.content = CONSOLIDATION_PROMPT_PATH.read_text(encoding="utf-8")

    def test_references_vault_guide(self) -> None:
        assert "Vault Guide" in self.content

    def test_no_inline_decision_template(self) -> None:
        assert "#### Decision Files (ADR Format)" not in self.content

    def test_no_inline_pattern_template(self) -> None:
        assert "#### Pattern Files (Rule + Evidence)" not in self.content

    def test_no_inline_lesson_template(self) -> None:
        assert not any(
            line.strip() == "#### Lesson Files"
            for line in self.content.split("\n")
        )

    def test_no_inline_concept_template(self) -> None:
        assert "#### Concept Files" not in self.content

    def test_no_inline_connection_template(self) -> None:
        assert "#### Connection Files" not in self.content

    def test_keeps_consolidation_rules(self) -> None:
        assert "## Consolidation Rules" in self.content

    def test_keeps_memory_md_structure(self) -> None:
        assert "## MEMORY.md Section Structure" in self.content

    def test_keeps_lifecycle_transitions(self) -> None:
        assert "### Lifecycle Transitions During Consolidation" in self.content

    def test_keeps_bidirectional_link_protocol(self) -> None:
        assert "### Bidirectional Link Protocol" in self.content

    def test_keeps_terminal_node_rules(self) -> None:
        assert "### Terminal Node Rules" in self.content


# ── AC2: record agent prompt references Vault Guide ──


class TestRecordPromptReferencesVaultGuide:

    def setup_method(self) -> None:
        self.content = RECORD_PROMPT_PATH.read_text(encoding="utf-8")

    def test_references_vault_guide(self) -> None:
        assert "Vault Guide" in self.content

    def test_keeps_workflow(self) -> None:
        assert "## Workflow" in self.content

    def test_keeps_continuation_mode(self) -> None:
        assert "## Continuation Sessions" in self.content

    def test_keeps_reinforcement_tracking(self) -> None:
        assert "## Reinforcement Tracking" in self.content


# ── AC3: weekly review prompt references Vault Guide ──


class TestWeeklyReviewPromptReferencesVaultGuide:

    def setup_method(self) -> None:
        self.content = WEEKLY_REVIEW_PROMPT_PATH.read_text(encoding="utf-8")

    def test_references_vault_guide(self) -> None:
        assert "Vault Guide" in self.content

    def test_keeps_output_rules(self) -> None:
        assert "## Output Rules" in self.content

    def test_keeps_your_tasks(self) -> None:
        assert "## Your Tasks" in self.content


# ── AC1: Phase 3 code reads _guide.md ──


class TestPhase3CodeReadsVaultGuide:

    def setup_method(self) -> None:
        self.content = DEEP_DREAM_TASK_PATH.read_text(encoding="utf-8")

    def test_reads_guide_md(self) -> None:
        assert 'read_vault_file("_guide.md")' in self.content

    def test_injects_vault_guide_section(self) -> None:
        assert "Vault Guide (file templates & structure)" in self.content

    def test_guide_content_in_phase3_sections(self) -> None:
        assert "vault_guide" in self.content
        assert "phase3_sections" in self.content


# ── AC2: record agent code reads _guide.md ──


class TestRecordAgentCodeReadsVaultGuide:

    def setup_method(self) -> None:
        self.content = DREAM_AGENT_PATH.read_text(encoding="utf-8")

    def test_reads_guide_md_in_run_record(self) -> None:
        assert '_read_vault_file("_guide.md")' in self.content

    def test_injects_vault_guide_section(self) -> None:
        assert "Vault Guide (daily log format)" in self.content


# ── AC3: weekly review code reads _guide.md ──


class TestWeeklyReviewCodeReadsVaultGuide:

    def setup_method(self) -> None:
        self.task_content = WEEKLY_REVIEW_TASK_PATH.read_text(encoding="utf-8")
        self.agent_content = DREAM_AGENT_PATH.read_text(encoding="utf-8")

    def test_task_reads_guide_md(self) -> None:
        assert 'read_vault_file("_guide.md")' in self.task_content

    def test_deps_has_vault_guide_field(self) -> None:
        assert "vault_guide" in self.agent_content
        assert "vault_guide: str" in self.agent_content

    def test_injects_vault_guide_section(self) -> None:
        assert "Vault Guide (review format)" in self.agent_content

    def test_task_passes_vault_guide_to_deps(self) -> None:
        assert "vault_guide=vault_guide" in self.task_content


# ── AC7: VaultUpdates has topics field + routing ──


class TestTopicsSupport:

    def test_vault_updates_has_topics_field(self) -> None:
        content = DREAM_MODELS_PATH.read_text(encoding="utf-8")
        assert "topics: list[VaultFileEntry]" in content

    def test_deep_dream_task_routes_topics(self) -> None:
        content = DEEP_DREAM_TASK_PATH.read_text(encoding="utf-8")
        assert '"topics"' in content

    def test_vault_updater_includes_topics(self) -> None:
        content = VAULT_UPDATER_PATH.read_text(encoding="utf-8")
        assert '"topics"' in content

    def test_vault_updater_type_map_includes_topics(self) -> None:
        content = VAULT_UPDATER_PATH.read_text(encoding="utf-8")
        assert '"topics": "topic"' in content
