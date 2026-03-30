import json

import pytest

from app.services.transcript_parser import count_tokens_approximate, parse_transcript


def _make_jsonl(*entries: dict) -> str:  # type: ignore[type-arg]
    return "\n".join(json.dumps(e) for e in entries)


class TestParseTranscript:
    def test_extracts_human_and_assistant_text(self) -> None:
        raw = _make_jsonl(
            {"type": "human", "message": {"role": "user", "content": "Hello"}},
            {"type": "assistant", "message": {"role": "assistant", "content": "Hi there"}},
        )

        result = parse_transcript(raw)

        assert result == "User: Hello\n\nAssistant: Hi there"

    def test_skips_tool_use_and_tool_result(self) -> None:
        raw = _make_jsonl(
            {"type": "human", "message": {"role": "user", "content": "Fix the bug"}},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/src/auth.ts"}},
            {"type": "tool_result", "name": "Read", "output": "export function auth()..."},
            {"type": "assistant", "message": {"role": "assistant", "content": "Done"}},
        )

        result = parse_transcript(raw)

        assert "tool" not in result.lower()
        assert result == "User: Fix the bug\n\nAssistant: Done"

    def test_skips_progress_and_system(self) -> None:
        raw = _make_jsonl(
            {"type": "system", "message": {"content": "system prompt"}},
            {"type": "human", "message": {"role": "user", "content": "Hi"}},
            {"type": "progress", "data": "thinking..."},
            {"type": "assistant", "message": {"role": "assistant", "content": "Hello"}},
        )

        result = parse_transcript(raw)

        assert result == "User: Hi\n\nAssistant: Hello"

    def test_handles_content_as_list_of_blocks(self) -> None:
        raw = _make_jsonl(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Found the issue."},
                        {"type": "tool_use", "id": "call_1", "name": "Edit", "input": {}},
                        {"type": "text", "text": "Fixed it."},
                    ],
                },
            },
        )

        result = parse_transcript(raw)

        assert result == "Assistant: Found the issue. Fixed it."

    def test_handles_content_as_string(self) -> None:
        raw = _make_jsonl(
            {"type": "human", "message": {"role": "user", "content": "Simple text"}},
        )

        result = parse_transcript(raw)

        assert result == "User: Simple text"

    def test_handles_malformed_jsonl_lines(self) -> None:
        raw = (
            '{"type":"human","message":{"role":"user","content":"Hello"}}\n'
            "NOT JSON\n"
            '{"type":"assistant","message":{"role":"assistant","content":"Hi"}}'
        )

        result = parse_transcript(raw)

        assert result == "User: Hello\n\nAssistant: Hi"

    def test_handles_empty_input(self) -> None:
        assert parse_transcript("") == ""

    def test_handles_missing_message_field(self) -> None:
        raw = _make_jsonl(
            {"type": "human"},
            {"type": "assistant", "message": {"role": "assistant", "content": "Response"}},
        )

        result = parse_transcript(raw)

        assert result == "Assistant: Response"

    def test_handles_missing_content_field(self) -> None:
        raw = _make_jsonl(
            {"type": "human", "message": {"role": "user"}},
            {"type": "assistant", "message": {"role": "assistant", "content": "OK"}},
        )

        result = parse_transcript(raw)

        assert result == "Assistant: OK"

    def test_handles_empty_content_string(self) -> None:
        raw = _make_jsonl(
            {"type": "human", "message": {"role": "user", "content": ""}},
            {"type": "assistant", "message": {"role": "assistant", "content": "Reply"}},
        )

        result = parse_transcript(raw)

        assert result == "Assistant: Reply"

    def test_handles_empty_content_list(self) -> None:
        raw = _make_jsonl(
            {"type": "assistant", "message": {"role": "assistant", "content": []}},
        )

        result = parse_transcript(raw)

        assert result == ""


class TestCountTokensApproximate:
    def test_returns_reasonable_estimate(self) -> None:
        text = "The quick brown fox jumps over the lazy dog"
        result = count_tokens_approximate(text)

        assert result == int(9 * 1.3)

    def test_empty_string(self) -> None:
        assert count_tokens_approximate("") == 0

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("one", 1),
            ("one two three", 3),
        ],
    )
    def test_scales_with_word_count(self, text: str, expected: int) -> None:
        result = count_tokens_approximate(text)
        assert result == int(expected * 1.3)
