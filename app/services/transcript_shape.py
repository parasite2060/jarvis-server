from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

GAP_THRESHOLD = timedelta(hours=1)

_TIMESTAMP_PREFIX = re.compile(r"^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]")
_USER_LINE = re.compile(
    r"^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]\s+User:"
)
_ASSISTANT_LINE = re.compile(
    r"^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]\s+Assistant:"
)


@dataclass
class SubSession:
    start_line: int
    end_line: int
    start_ts: datetime
    end_ts: datetime


@dataclass
class TranscriptShape:
    line_count: int
    token_estimate: int
    span_start: datetime | None
    span_end: datetime | None
    wall_clock: timedelta | None
    user_message_count: int
    assistant_message_count: int
    sub_sessions: list[SubSession] = field(default_factory=list)
    unparseable_lines: int = 0


def _parse_ts(value: str) -> datetime:
    cleaned = value[:-1] if value.endswith("Z") else value
    return datetime.fromisoformat(cleaned)


def compute_transcript_shape(path: Path) -> TranscriptShape:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    line_count = len(lines)
    token_estimate = len(text) // 4

    user_events: list[tuple[int, datetime]] = []
    assistant_count = 0
    unparseable = 0
    first_ts: datetime | None = None
    last_ts: datetime | None = None

    for idx, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        ts_match = _TIMESTAMP_PREFIX.match(line)
        if not ts_match:
            unparseable += 1
            continue
        try:
            ts = _parse_ts(ts_match.group(1))
        except ValueError:
            unparseable += 1
            continue

        if first_ts is None:
            first_ts = ts
        last_ts = ts

        if _USER_LINE.match(line):
            user_events.append((idx, ts))
        elif _ASSISTANT_LINE.match(line):
            assistant_count += 1

    sub_sessions: list[SubSession] = []
    if user_events:
        cluster_start_idx = 0
        for i in range(1, len(user_events)):
            prev_ts = user_events[i - 1][1]
            curr_ts = user_events[i][1]
            if curr_ts - prev_ts > GAP_THRESHOLD:
                cluster = user_events[cluster_start_idx:i]
                sub_sessions.append(
                    SubSession(
                        start_line=cluster[0][0],
                        end_line=user_events[i - 1][0],
                        start_ts=cluster[0][1],
                        end_ts=cluster[-1][1],
                    )
                )
                cluster_start_idx = i
        tail = user_events[cluster_start_idx:]
        sub_sessions.append(
            SubSession(
                start_line=tail[0][0],
                end_line=tail[-1][0],
                start_ts=tail[0][1],
                end_ts=tail[-1][1],
            )
        )

    wall_clock = (last_ts - first_ts) if (first_ts and last_ts) else None

    return TranscriptShape(
        line_count=line_count,
        token_estimate=token_estimate,
        span_start=first_ts,
        span_end=last_ts,
        wall_clock=wall_clock,
        user_message_count=len(user_events),
        assistant_message_count=assistant_count,
        sub_sessions=sub_sessions,
        unparseable_lines=unparseable,
    )


def _format_duration(delta: timedelta) -> str:
    total_minutes = int(delta.total_seconds() // 60)
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def _format_ts(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%d %H:%M")


def _format_time(ts: datetime) -> str:
    return ts.strftime("%H:%M")


def format_shape_report(shape: TranscriptShape) -> str:
    lines = ["## Transcript Shape"]
    lines.append(
        f"- Total: {shape.line_count:,} lines, ~{shape.token_estimate:,} tokens"
    )

    if shape.span_start and shape.span_end and shape.wall_clock is not None:
        lines.append(
            f"- Span: {_format_ts(shape.span_start)} → {_format_ts(shape.span_end)} "
            f"({_format_duration(shape.wall_clock)})"
        )
    else:
        lines.append("- Span: (no parseable timestamps)")

    lines.append(
        f"- Messages: {shape.user_message_count} user, "
        f"{shape.assistant_message_count} assistant"
    )
    lines.append(
        f"- Sub-sessions detected: {len(shape.sub_sessions)} (gap threshold: 1h)"
    )

    for i, sub in enumerate(shape.sub_sessions, start=1):
        same_day = sub.start_ts.date() == sub.end_ts.date()
        end_repr = _format_time(sub.end_ts) if same_day else _format_ts(sub.end_ts)
        duration = _format_duration(sub.end_ts - sub.start_ts)
        lines.append(
            f"  {i}. lines {sub.start_line}-{sub.end_line} "
            f"{_format_ts(sub.start_ts)} → {end_repr} ({duration})"
        )

    lines.append(f"- Unparseable lines: {shape.unparseable_lines}")
    return "\n".join(lines)
