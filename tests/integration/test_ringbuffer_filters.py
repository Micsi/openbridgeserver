"""Integration baseline tests for /api/v1/ringbuffer filter parameters."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.integration


_DP_BASE = {
    "name": "Ringbuffer Filter Test DP",
    "data_type": "FLOAT",
    "unit": "W",
    "tags": ["ringbuffer-filter-test"],
    "persist_value": False,
}


async def _create_dp(client, auth_headers, name: str, data_type: str = "FLOAT", unit: str | None = "W") -> dict:
    resp = await client.post(
        "/api/v1/datapoints/",
        json={**_DP_BASE, "name": name, "data_type": data_type, "unit": unit},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _write_value(client, auth_headers, dp_id: str, value: object) -> None:
    resp = await client.post(
        f"/api/v1/datapoints/{dp_id}/value",
        json={"value": value},
        headers=auth_headers,
    )
    assert resp.status_code == 204, resp.text


async def _query_ringbuffer(client, auth_headers, params: dict) -> list[dict]:
    resp = await client.get(
        "/api/v1/ringbuffer/",
        params=params,
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _query_ringbuffer_v2(client, auth_headers, body: dict) -> list[dict]:
    resp = await client.post(
        "/api/v1/ringbuffer/query",
        json=body,
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_ringbuffer_filter_basics_q_adapter_from_and_limit(client, auth_headers):
    dp_a = await _create_dp(client, auth_headers, "RB Filter A")
    dp_b = await _create_dp(client, auth_headers, "RB Filter B")

    await _write_value(client, auth_headers, dp_a["id"], 10.0)
    first_for_a = await _query_ringbuffer(
        client,
        auth_headers,
        {"q": dp_a["id"], "limit": 1},
    )
    assert len(first_for_a) == 1
    assert first_for_a[0]["datapoint_id"] == dp_a["id"]
    first_ts = first_for_a[0]["ts"]

    # Ensure later write gets a strictly newer timestamp than first_ts.
    await asyncio.sleep(0.02)
    await _write_value(client, auth_headers, dp_a["id"], 11.0)
    await _write_value(client, auth_headers, dp_b["id"], 20.0)

    by_adapter = await _query_ringbuffer(
        client,
        auth_headers,
        {"adapter": "api", "limit": 2},
    )
    assert len(by_adapter) == 2
    assert all(entry["source_adapter"] == "api" for entry in by_adapter)

    from_filtered = await _query_ringbuffer(
        client,
        auth_headers,
        {"q": dp_a["id"], "from": first_ts, "limit": 10},
    )
    assert from_filtered
    assert len(from_filtered) <= 10
    assert all(entry["datapoint_id"] == dp_a["id"] for entry in from_filtered)
    assert all(entry["ts"] > first_ts for entry in from_filtered)
    assert from_filtered[0]["new_value"] == pytest.approx(11.0)


async def test_ringbuffer_from_filter_is_exclusive_at_equal_timestamp(client, auth_headers):
    dp = await _create_dp(client, auth_headers, "RB From Equal Boundary")
    await _write_value(client, auth_headers, dp["id"], 55.0)

    rows = await _query_ringbuffer(
        client,
        auth_headers,
        {"q": dp["id"], "limit": 1},
    )
    assert len(rows) == 1
    exact_ts = rows[0]["ts"]

    equal_boundary = await _query_ringbuffer(
        client,
        auth_headers,
        {"q": dp["id"], "from": exact_ts, "limit": 10},
    )
    assert equal_boundary == []


async def test_ringbuffer_limit_validation_rejects_zero(client, auth_headers):
    resp = await client.get(
        "/api/v1/ringbuffer/",
        params={"limit": 0},
        headers=auth_headers,
    )
    assert resp.status_code == 422, resp.text


async def test_ringbuffer_config_rejects_invalid_storage_mode(client, auth_headers):
    resp = await client.post(
        "/api/v1/ringbuffer/config",
        json={"storage": "invalid", "max_entries": 100},
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert "storage must be 'file'" in resp.text


async def test_ringbuffer_config_rejects_memory_storage_mode(client, auth_headers):
    resp = await client.post(
        "/api/v1/ringbuffer/config",
        json={"storage": "memory", "max_entries": 100},
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert "storage must be 'file'" in resp.text


async def test_ringbuffer_config_accepts_retention_fields(client, auth_headers):
    resp = await client.post(
        "/api/v1/ringbuffer/config",
        json={
            "storage": "file",
            "max_entries": 100,
            "max_file_size_bytes": 4096,
            "max_age": 60,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["max_entries"] == 100
    assert body["max_file_size_bytes"] == 4096
    assert body["max_age"] == 60

    # Keep session-scoped integration app stable for subsequent tests.
    reset_resp = await client.post(
        "/api/v1/ringbuffer/config",
        json={
            "storage": "file",
            "max_entries": 1000,
            "max_file_size_bytes": None,
            "max_age": None,
        },
        headers=auth_headers,
    )
    assert reset_resp.status_code == 200, reset_resp.text


async def test_ringbuffer_v2_adapter_or_is_combined_with_group_and(client, auth_headers):
    dp_a = await _create_dp(client, auth_headers, "RB DSL A")
    dp_b = await _create_dp(client, auth_headers, "RB DSL B")

    await _write_value(client, auth_headers, dp_a["id"], 1.0)
    await _write_value(client, auth_headers, dp_b["id"], 2.0)

    rows = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "adapters": {"any_of": ["api", "knx"]},
                "datapoints": {"ids": [dp_a["id"]]},
            },
            "sort": {"field": "id", "order": "desc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )

    assert rows
    assert all(row["datapoint_id"] == dp_a["id"] for row in rows)
    assert all(row["source_adapter"] in {"api", "knx"} for row in rows)


async def test_ringbuffer_v2_time_filter_supports_open_boundaries(client, auth_headers):
    dp = await _create_dp(client, auth_headers, "RB DSL Open Bounds")

    await _write_value(client, auth_headers, dp["id"], 10.0)
    first = (await _query_ringbuffer(client, auth_headers, {"q": dp["id"], "limit": 1}))[0]
    await asyncio.sleep(0.02)
    await _write_value(client, auth_headers, dp["id"], 11.0)
    second = (await _query_ringbuffer(client, auth_headers, {"q": dp["id"], "limit": 1}))[0]

    only_from = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp["id"]]},
                "time": {"from": first["ts"]},
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert only_from
    assert all(row["ts"] > first["ts"] for row in only_from)

    only_to = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp["id"]]},
                "time": {"to": second["ts"]},
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert only_to
    assert all(row["ts"] < second["ts"] for row in only_to)


async def test_ringbuffer_v2_combines_absolute_and_relative_time_bounds(client, auth_headers):
    dp = await _create_dp(client, auth_headers, "RB DSL Abs+Rel")

    now = datetime.now(UTC)
    old_ts = (now - timedelta(seconds=120)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    future_ts = (now + timedelta(seconds=120)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    await _write_value(client, auth_headers, dp["id"], 100.0)
    await asyncio.sleep(0.02)
    await _write_value(client, auth_headers, dp["id"], 101.0)

    # from=max(absolute, relative): absolute old + relative recent => rows exist.
    rows_with_old_abs = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp["id"]]},
                "time": {
                    "from": old_ts,
                    "from_relative_seconds": -30,
                },
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert rows_with_old_abs

    # from=max(absolute, relative): absolute future + relative recent => effective lower bound is future.
    rows_with_future_abs = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp["id"]]},
                "time": {
                    "from": future_ts,
                    "from_relative_seconds": -30,
                },
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert rows_with_future_abs == []


async def test_ringbuffer_v2_rejects_empty_adapter_filter_list(client, auth_headers):
    resp = await client.post(
        "/api/v1/ringbuffer/query",
        json={
            "filters": {
                "adapters": {"any_of": ["  ", ""]},
            },
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert "filters.adapters.any_of must contain at least one adapter" in resp.text


async def test_ringbuffer_v2_rejects_empty_datapoint_filter_list(client, auth_headers):
    resp = await client.post(
        "/api/v1/ringbuffer/query",
        json={
            "filters": {
                "datapoints": {"ids": ["", "  "]},
            },
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert "filters.datapoints.ids must contain at least one datapoint id" in resp.text


async def test_ringbuffer_v2_q_matches_datapoint_name(client, auth_headers):
    dp = await _create_dp(client, auth_headers, "RB DSL Name Match")
    await _write_value(client, auth_headers, dp["id"], 12.5)

    rows = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {"q": "name match"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert rows
    assert any(row["datapoint_id"] == dp["id"] for row in rows)


async def test_ringbuffer_v2_invalid_timestamp_returns_422(client, auth_headers):
    resp = await client.post(
        "/api/v1/ringbuffer/query",
        json={
            "filters": {
                "time": {"from": "not-a-ts"},
            },
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert "invalid timestamp: not-a-ts" in resp.text


async def test_ringbuffer_stats_endpoint_returns_current_config(client, auth_headers):
    resp = await client.get("/api/v1/ringbuffer/stats", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["storage"] == "file"
    assert "total" in body
    assert "max_entries" in body


async def test_ringbuffer_v2_value_filters_numeric_string_boolean_and_regex(client, auth_headers):
    dp_float = await _create_dp(client, auth_headers, "RB DSL Value Float", data_type="FLOAT", unit="W")
    dp_string = await _create_dp(client, auth_headers, "RB DSL Value String", data_type="STRING", unit=None)
    dp_bool = await _create_dp(client, auth_headers, "RB DSL Value Bool", data_type="BOOLEAN", unit=None)

    await _write_value(client, auth_headers, dp_float["id"], 10.0)
    await _write_value(client, auth_headers, dp_float["id"], 20.0)
    await _write_value(client, auth_headers, dp_string["id"], "Wohnzimmer Temperatur")
    await _write_value(client, auth_headers, dp_string["id"], "Garage Licht")
    await _write_value(client, auth_headers, dp_bool["id"], True)
    await _write_value(client, auth_headers, dp_bool["id"], False)

    numeric_rows = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp_float["id"]]},
                "values": [{"operator": "between", "lower": 15, "upper": 25}],
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert [row["new_value"] for row in numeric_rows] == [20.0]

    contains_rows = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp_string["id"]]},
                "values": [{"operator": "contains", "value": "Wohn"}],
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert [row["new_value"] for row in contains_rows] == ["Wohnzimmer Temperatur"]

    regex_rows = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp_string["id"]]},
                "values": [{"operator": "regex", "pattern": "^Garage"}],
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert [row["new_value"] for row in regex_rows] == ["Garage Licht"]

    bool_rows = await _query_ringbuffer_v2(
        client,
        auth_headers,
        {
            "filters": {
                "datapoints": {"ids": [dp_bool["id"]]},
                "values": [{"operator": "eq", "value": True}],
            },
            "sort": {"field": "ts", "order": "asc"},
            "pagination": {"limit": 50, "offset": 0},
        },
    )
    assert [row["new_value"] for row in bool_rows] == [True]


async def test_ringbuffer_v2_value_filter_type_conflict_returns_422(client, auth_headers):
    dp_bool = await _create_dp(client, auth_headers, "RB DSL Value Conflict Bool", data_type="BOOLEAN", unit=None)
    await _write_value(client, auth_headers, dp_bool["id"], True)

    resp = await client.post(
        "/api/v1/ringbuffer/query",
        json={
            "filters": {
                "datapoints": {"ids": [dp_bool["id"]]},
                "values": [{"operator": "gt", "value": 0}],
            },
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert "operator 'gt' is not supported for data_type 'BOOLEAN'" in resp.text


async def test_ringbuffer_v2_value_filter_regex_guard_returns_422(client, auth_headers):
    dp_string = await _create_dp(client, auth_headers, "RB DSL Value Regex Guard", data_type="STRING", unit=None)
    await _write_value(client, auth_headers, dp_string["id"], "aaaaaaaaaaaaaaaa")

    resp = await client.post(
        "/api/v1/ringbuffer/query",
        json={
            "filters": {
                "datapoints": {"ids": [dp_string["id"]]},
                "values": [{"operator": "regex", "pattern": "(a+)+$"}],
            },
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert "unsafe regex pattern" in resp.text
