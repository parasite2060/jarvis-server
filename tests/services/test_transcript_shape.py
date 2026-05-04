from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.services.transcript_shape import (
    SubSession,
    TranscriptShape,
    compute_transcript_shape,
    format_shape_report,
)


def _write(path: Path, content: str) -> Path:
    path.write_text(content, encoding="utf-8")
    return path


def _build_short_transcript() -> str:
    lines = [
        "[2026-04-29T14:59:00Z] User: hello",
        "",
        "[2026-04-29T14:59:30Z] Assistant: hi",
        "",
        "[2026-04-29T15:00:00Z] User: how are you?",
        "",
        "[2026-04-29T15:00:30Z] Assistant: good",
        "",
        "[2026-04-29T15:05:00Z] User: bye",
    ]
    return "\n".join(lines) + "\n"


class TestShortTranscript:
    def test_short_transcript_has_one_subsession_covering_full_range(
        self, tmp_path: Path
    ) -> None:
        path = _write(tmp_path / "transcript.txt", _build_short_transcript())

        shape = compute_transcript_shape(path)

        assert len(shape.sub_sessions) == 1
        assert shape.user_message_count == 3
        assert shape.assistant_message_count == 2
        assert shape.unparseable_lines == 0
        sub = shape.sub_sessions[0]
        assert sub.start_ts == datetime(2026, 4, 29, 14, 59, 0)
        assert sub.end_ts == datetime(2026, 4, 29, 15, 5, 0)


class TestLongSingleSession:
    def test_long_single_session_has_one_subsession(self, tmp_path: Path) -> None:
        rows: list[str] = []
        base = datetime(2026, 4, 29, 9, 0, 0)
        for i in range(600):
            ts = (base + timedelta(seconds=i * 10)).isoformat() + "Z"
            rows.append(f"[{ts}] User: msg {i}")
            rows.append(f"[{ts}] Assistant: reply {i}")
        path = _write(tmp_path / "transcript.txt", "\n".join(rows) + "\n")

        shape = compute_transcript_shape(path)

        assert len(shape.sub_sessions) == 1
        assert shape.user_message_count == 600
        assert shape.assistant_message_count == 600


class TestResumedSession:
    def test_two_clusters_separated_by_long_gap_yield_two_subsessions(
        self, tmp_path: Path
    ) -> None:
        lines = [
            "[2026-04-29T14:00:00Z] User: cluster1 a",
            "[2026-04-29T14:00:10Z] Assistant: r1",
            "[2026-04-29T14:30:00Z] User: cluster1 b",
            "[2026-04-29T14:30:10Z] Assistant: r2",
            "[2026-04-30T04:00:00Z] User: cluster2 a",
            "[2026-04-30T04:00:10Z] Assistant: r3",
            "[2026-04-30T05:00:00Z] User: cluster2 b",
        ]
        path = _write(tmp_path / "transcript.txt", "\n".join(lines) + "\n")

        shape = compute_transcript_shape(path)

        assert len(shape.sub_sessions) == 2
        first, second = shape.sub_sessions
        assert first.start_line == 1
        assert first.end_line == 3
        assert first.start_ts == datetime(2026, 4, 29, 14, 0, 0)
        assert first.end_ts == datetime(2026, 4, 29, 14, 30, 0)
        assert second.start_line == 5
        assert second.end_line == 7
        assert second.start_ts == datetime(2026, 4, 30, 4, 0, 0)
        assert second.end_ts == datetime(2026, 4, 30, 5, 0, 0)


class TestMalformedTimestamps:
    def test_unparseable_lines_counted_and_ignored_for_gaps(
        self, tmp_path: Path
    ) -> None:
        lines = [
            "[2026-04-29T14:00:00Z] User: a",
            "no timestamp here",
            "another bare line",
            "[2026-04-29T14:30:00Z] User: b",
            "yet another bare line",
            "[2026-04-29T14:45:00Z] User: c",
            "free text",
            "free text 2",
        ]
        path = _write(tmp_path / "transcript.txt", "\n".join(lines) + "\n")

        shape = compute_transcript_shape(path)

        assert shape.unparseable_lines == 5
        assert len(shape.sub_sessions) == 1
        assert shape.user_message_count == 3


class TestComputationFailure:
    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            compute_transcript_shape(tmp_path / "missing.txt")


class TestFormatShapeReport:
    def test_renders_within_25_lines_with_all_sections(self) -> None:
        shape = TranscriptShape(
            line_count=18620,
            token_estimate=287552,
            span_start=datetime(2026, 4, 29, 14, 59),
            span_end=datetime(2026, 5, 1, 15, 10),
            wall_clock=timedelta(hours=48, minutes=11),
            user_message_count=180,
            assistant_message_count=142,
            sub_sessions=[
                SubSession(
                    start_line=1,
                    end_line=15800,
                    start_ts=datetime(2026, 4, 29, 14, 59),
                    end_ts=datetime(2026, 4, 29, 15, 14),
                ),
                SubSession(
                    start_line=16824,
                    end_line=18620,
                    start_ts=datetime(2026, 4, 30, 4, 26),
                    end_ts=datetime(2026, 5, 1, 15, 10),
                ),
            ],
            unparseable_lines=0,
        )

        report = format_shape_report(shape)

        assert report.startswith("## Transcript Shape")
        assert len(report.splitlines()) <= 25
        assert "18,620 lines" in report
        assert "Sub-sessions detected: 2" in report
        assert "Unparseable lines: 0" in report
