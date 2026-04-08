from app.services.dream_models import (
    ALLOWED_VAULT_TARGETS,
    VaultFileEntry,
    VaultUpdates,
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
