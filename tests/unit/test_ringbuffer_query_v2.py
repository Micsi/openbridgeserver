"""Unit tests for ringbuffer query v2 guards and validation."""

from __future__ import annotations

import pytest

from obs.ringbuffer.ringbuffer import RingBuffer


async def _record_value(rb: RingBuffer, value: int, ts: str) -> None:
    await rb.record(
        ts=ts,
        datapoint_id="dp-query-v2",
        topic="dp/dp-query-v2/value",
        old_value=None,
        new_value=value,
        source_adapter="api",
        quality="good",
    )


@pytest.mark.asyncio
async def test_query_v2_returns_empty_when_not_started():
    rb = RingBuffer(storage="memory", max_entries=100)
    rows = await rb.query_v2()
    assert rows == []


@pytest.mark.asyncio
async def test_query_v2_rejects_invalid_time_window():
    rb = RingBuffer(storage="memory", max_entries=100)
    await rb.start()
    try:
        await _record_value(rb, 1, "2026-01-01T00:00:00.000Z")
        with pytest.raises(ValueError, match="effective 'from' must be earlier than effective 'to'"):
            await rb.query_v2(
                from_ts="2026-01-01T00:00:10.000Z",
                to_ts="2026-01-01T00:00:00.000Z",
            )
    finally:
        await rb.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kwargs", "msg"),
    [
        ({"sort_field": "datapoint_id"}, "invalid sort field"),
        ({"sort_order": "sideways"}, "invalid sort order"),
        ({"limit": 0}, "limit must be >= 1"),
        ({"offset": -1}, "offset must be >= 0"),
    ],
)
async def test_query_v2_rejects_invalid_sort_and_pagination(kwargs: dict, msg: str):
    rb = RingBuffer(storage="memory", max_entries=100)
    await rb.start()
    try:
        await _record_value(rb, 1, "2026-01-01T00:00:00.000Z")
        with pytest.raises(ValueError, match=msg):
            await rb.query_v2(**kwargs)
    finally:
        await rb.stop()


@pytest.mark.asyncio
async def test_query_v2_supports_relative_time_bound_only():
    rb = RingBuffer(storage="memory", max_entries=100)
    await rb.start()
    try:
        await _record_value(rb, 1, "2099-01-01T00:00:00.000Z")
        rows = await rb.query_v2(from_relative_seconds=-60)
        assert rows
    finally:
        await rb.stop()
