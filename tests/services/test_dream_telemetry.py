from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pydantic_ai.usage import RunUsage

from app.models.tables import DreamPhase
from app.services.dream_telemetry import (
    _serialize_messages,
    format_conversation,
    store_phase_telemetry,
)


class TestSerializeMessages:
    def test_pydantic_model_dump(self) -> None:
        msg = MagicMock()
        msg.model_dump.return_value = {"kind": "request", "parts": []}
        result = _serialize_messages([msg])
        assert result == [{"kind": "request", "parts": []}]

    def test_fallback_to_str(self) -> None:
        msg = "plain string"
        result = _serialize_messages([msg])
        assert result == ["plain string"]

    def test_object_with_dict_but_no_model_dump(self) -> None:
        class FakeMsg:
            def __init__(self) -> None:
                self.data = "test"

            def __str__(self) -> str:
                return "FakeMsg(data=test)"

        result = _serialize_messages([FakeMsg()])
        assert result == ["FakeMsg(data=test)"]

    def test_serialization_error_fallback(self) -> None:
        msg = MagicMock()
        msg.model_dump.side_effect = RuntimeError("boom")
        result = _serialize_messages([msg])
        assert result == [{"error": "serialization_failed", "type": "MagicMock"}]

    def test_empty_list(self) -> None:
        assert _serialize_messages([]) == []

    def test_mixed_message_types(self) -> None:
        pydantic_msg = MagicMock()
        pydantic_msg.model_dump.return_value = {"kind": "response"}

        result = _serialize_messages([pydantic_msg, "plain", 42])
        assert len(result) == 3
        assert result[0] == {"kind": "response"}
        assert result[1] == "plain"
        assert result[2] == "42"


class FakePhase:
    def __init__(self) -> None:
        self.id = 99


class FakeSession:
    def __init__(self) -> None:
        self.added: list[Any] = []

    def add(self, item: Any) -> None:
        self.added.append(item)

    async def commit(self) -> None:
        pass

    async def refresh(self, item: Any) -> None:
        item.id = 99


class FakeSessionFactory:
    def __init__(self) -> None:
        self.session = FakeSession()

    def __call__(self) -> "FakeSessionFactory":
        return self

    async def __aenter__(self) -> FakeSession:
        return self.session

    async def __aexit__(self, *args: Any) -> None:
        pass


@pytest.mark.asyncio
async def test_store_phase_telemetry_all_fields() -> None:
    factory = FakeSessionFactory()
    usage = RunUsage(input_tokens=100, output_tokens=50, requests=1)
    messages = [MagicMock()]
    messages[0].model_dump.return_value = {"kind": "request"}

    with patch("app.services.dream_telemetry.async_session_factory", factory):
        phase_id = await store_phase_telemetry(
            dream_id=1,
            phase="phase1_light_sleep",
            status="completed",
            run_prompt="test prompt",
            output_json={"candidates": []},
            messages=messages,
            usage=usage,
            tool_calls=5,
            duration_ms=1234,
            started_at=datetime(2026, 4, 15, tzinfo=UTC),
        )

    assert phase_id == 99
    added = factory.session.added
    assert len(added) == 1
    row: DreamPhase = added[0]
    assert row.dream_id == 1
    assert row.phase == "phase1_light_sleep"
    assert row.status == "completed"
    assert row.run_prompt == "test prompt"
    assert row.output_json == {"candidates": []}
    assert row.conversation_history == [{"kind": "request"}]
    assert row.tool_calls == 5
    assert row.duration_ms == 1234
    assert row.started_at == datetime(2026, 4, 15, tzinfo=UTC)
    assert row.completed_at is not None
    assert row.error_message is None


@pytest.mark.asyncio
async def test_store_phase_telemetry_failed_status() -> None:
    factory = FakeSessionFactory()

    with patch("app.services.dream_telemetry.async_session_factory", factory):
        phase_id = await store_phase_telemetry(
            dream_id=2,
            phase="extraction",
            status="failed",
            error_message="Agent crashed",
            duration_ms=500,
        )

    assert phase_id == 99
    row: DreamPhase = factory.session.added[0]
    assert row.status == "failed"
    assert row.error_message == "Agent crashed"
    assert row.completed_at is not None
    assert row.conversation_history is None
    assert row.output_json is None


@pytest.mark.asyncio
async def test_store_phase_telemetry_processing_status_no_completed_at() -> None:
    factory = FakeSessionFactory()

    with patch("app.services.dream_telemetry.async_session_factory", factory):
        await store_phase_telemetry(
            dream_id=3,
            phase="phase3_deep_sleep",
            status="processing",
        )

    row: DreamPhase = factory.session.added[0]
    assert row.status == "processing"
    assert row.completed_at is None


class TestFormatConversation:
    def test_empty_history_returns_marker(self) -> None:
        assert format_conversation(None) == "_(no conversation recorded)_"
        assert format_conversation([]) == "_(no conversation recorded)_"

    def test_standard_extraction_trace(self) -> None:
        system_text = "You are an extraction agent. " * 50
        history = [
            {
                "kind": "request",
                "instructions": None,
                "parts": [
                    {"part_kind": "system-prompt", "content": system_text},
                    {"part_kind": "user-prompt", "content": "Extract from today"},
                ],
            },
            {
                "kind": "response",
                "parts": [
                    {
                        "part_kind": "tool-call",
                        "tool_name": "search_memory",
                        "args": {"query": "today", "limit": 5},
                        "tool_call_id": "c1",
                    },
                ],
            },
            {
                "kind": "request",
                "parts": [
                    {
                        "part_kind": "tool-return",
                        "tool_name": "search_memory",
                        "content": "found 3 hits",
                        "tool_call_id": "c1",
                    },
                ],
            },
            {
                "kind": "request",
                "parts": [
                    {"part_kind": "system-prompt", "content": system_text},
                ],
            },
            {
                "kind": "response",
                "parts": [
                    {
                        "part_kind": "tool-call",
                        "tool_name": "save_candidate",
                        "args": {"text": "candidate one"},
                        "tool_call_id": "c2",
                    },
                ],
            },
        ]

        rendered = format_conversation(history)

        assert rendered.count("system [hash:") == 1
        assert "user prompt:" in rendered
        assert rendered.count("Extract from today") == 1
        assert "turn 1  assistant  → search_memory(" in rendered
        assert "turn 2  assistant  → save_candidate(" in rendered
        assert "search_memory → found 3 hits" in rendered
        idx_turn1 = rendered.index("turn 1")
        idx_turn2 = rendered.index("turn 2")
        assert idx_turn1 < idx_turn2

    def test_long_tool_return_truncated(self) -> None:
        long_content = "x" * 500
        history = [
            {
                "kind": "request",
                "parts": [
                    {
                        "part_kind": "tool-return",
                        "tool_name": "fetch_dump",
                        "content": long_content,
                        "tool_call_id": "c1",
                    },
                ],
            },
        ]

        rendered = format_conversation(history)

        assert "[500 chars total]" in rendered
        assert "x" * 500 not in rendered
        assert "x" * 80 in rendered

    def test_malformed_serialization_failed_entry(self) -> None:
        history = [
            {"error": "serialization_failed", "type": "MagicMock"},
            {
                "kind": "response",
                "parts": [
                    {
                        "part_kind": "tool-call",
                        "tool_name": "search",
                        "args": {"q": "after"},
                        "tool_call_id": "c1",
                    },
                ],
            },
        ]

        rendered = format_conversation(history)

        assert "[unrenderable: serialization_failed]" in rendered
        assert "turn 1  assistant  → search(" in rendered

    def test_malformed_string_entry_continues(self) -> None:
        history = [
            "raw string entry",
            {
                "kind": "response",
                "parts": [
                    {
                        "part_kind": "tool-call",
                        "tool_name": "ping",
                        "args": {},
                        "tool_call_id": "c1",
                    },
                ],
            },
        ]

        rendered = format_conversation(history)

        assert "[unrenderable:" in rendered
        assert "ping(" in rendered

    def test_dict_missing_kind_renders_unrenderable(self) -> None:
        history = [{"parts": []}]
        rendered = format_conversation(history)
        assert "[unrenderable: missing_kind]" in rendered

    def test_instructions_field_used_when_no_system_part(self) -> None:
        history = [
            {
                "kind": "request",
                "instructions": "Long agent instructions block",
                "parts": [
                    {"part_kind": "user-prompt", "content": "go"},
                ],
            },
        ]
        rendered = format_conversation(history)
        assert "system [hash:" in rendered
        assert "user prompt:" in rendered

    def test_args_value_truncated_to_60_chars(self) -> None:
        long_value = "v" * 200
        history = [
            {
                "kind": "response",
                "parts": [
                    {
                        "part_kind": "tool-call",
                        "tool_name": "store",
                        "args": {"data": long_value},
                        "tool_call_id": "c1",
                    },
                ],
            },
        ]
        rendered = format_conversation(history)
        assert "v" * 60 + "…" in rendered
        assert "v" * 200 not in rendered


class TestDreamPhaseModel:
    def test_create_dream_phase_with_defaults(self) -> None:
        phase = DreamPhase(
            dream_id=1,
            phase="extraction",
            status="completed",
        )
        assert phase.dream_id == 1
        assert phase.phase == "extraction"
        assert phase.status == "completed"
        assert phase.run_prompt is None
        assert phase.output_json is None
        assert phase.conversation_history is None
        assert phase.input_tokens is None
        assert phase.tool_calls is None
        assert phase.error_message is None

    def test_create_dream_phase_with_all_fields(self) -> None:
        now = datetime.now(UTC)
        phase = DreamPhase(
            dream_id=5,
            phase="phase3_deep_sleep",
            status="completed",
            run_prompt="Consolidate memories.",
            output_json={"memory_md": "# Memory"},
            conversation_history=[{"kind": "request"}],
            input_tokens=500,
            output_tokens=200,
            total_tokens=700,
            tool_calls=3,
            duration_ms=5000,
            started_at=now,
            completed_at=now,
        )
        assert phase.total_tokens == 700
        assert phase.duration_ms == 5000
        assert phase.conversation_history == [{"kind": "request"}]
