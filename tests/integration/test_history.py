"""Integration Tests — History Objekt-Filter (issue #178)

Deckt ab:
  - record_history=True  (Standard): Werte werden in die Historie geschrieben
  - record_history=False: Werte werden NICHT in die Historie geschrieben
  - PATCH /api/v1/datapoints/{id} setzt record_history korrekt
  - record_history wird im GET-Response zurückgeliefert
"""

from __future__ import annotations

import asyncio
import datetime
import uuid

import pytest

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_dp(client, auth_headers, name: str, record_history: bool = True) -> dict:
    resp = await client.post(
        "/api/v1/datapoints/",
        json={
            "name": name,
            "data_type": "FLOAT",
            "unit": "°C",
            "record_history": record_history,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, f"create failed: {resp.text}"
    return resp.json()


async def _write_value(client, auth_headers, dp_id: str, value: float) -> None:
    resp = await client.post(
        f"/api/v1/datapoints/{dp_id}/value",
        json={"value": value},
        headers=auth_headers,
    )
    assert resp.status_code == 204, f"write value failed: {resp.text}"


async def _query_history(client, auth_headers, dp_id: str) -> list:
    past = (datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=5)).isoformat()
    resp = await client.get(
        f"/api/v1/history/{dp_id}",
        params={"from": past, "limit": 100},
        headers=auth_headers,
    )
    assert resp.status_code == 200, f"history query failed: {resp.text}"
    return resp.json()


# ---------------------------------------------------------------------------
# Tests: record_history field returned in API responses
# ---------------------------------------------------------------------------


async def test_create_datapoint_default_record_history(client, auth_headers):
    """record_history defaults to True when not specified."""
    dp = await _create_dp(client, auth_headers, f"HistTest-Default-{uuid.uuid4().hex[:6]}")
    assert dp["record_history"] is True


async def test_create_datapoint_record_history_false(client, auth_headers):
    """record_history=False is stored and returned correctly."""
    dp = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Excluded-{uuid.uuid4().hex[:6]}",
        record_history=False,
    )
    assert dp["record_history"] is False


async def test_get_datapoint_returns_record_history(client, auth_headers):
    """GET /datapoints/{id} includes record_history field."""
    created = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Get-{uuid.uuid4().hex[:6]}",
        record_history=False,
    )
    resp = await client.get(f"/api/v1/datapoints/{created['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["record_history"] is False


async def test_patch_datapoint_enables_record_history(client, auth_headers):
    """PATCH can enable record_history after creation."""
    created = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Patch-{uuid.uuid4().hex[:6]}",
        record_history=False,
    )
    dp_id = created["id"]

    resp = await client.patch(
        f"/api/v1/datapoints/{dp_id}",
        json={"record_history": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["record_history"] is True

    # Verify persisted
    resp2 = await client.get(f"/api/v1/datapoints/{dp_id}", headers=auth_headers)
    assert resp2.json()["record_history"] is True


async def test_patch_datapoint_disables_record_history(client, auth_headers):
    """PATCH can disable record_history after creation."""
    created = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Disable-{uuid.uuid4().hex[:6]}",
        record_history=True,
    )
    dp_id = created["id"]

    resp = await client.patch(
        f"/api/v1/datapoints/{dp_id}",
        json={"record_history": False},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["record_history"] is False


# ---------------------------------------------------------------------------
# Tests: History recording behaviour
# ---------------------------------------------------------------------------


async def test_history_recorded_when_enabled(client, auth_headers):
    """Values are written to history when record_history=True."""
    dp = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Enabled-{uuid.uuid4().hex[:6]}",
        record_history=True,
    )
    dp_id = dp["id"]

    await _write_value(client, auth_headers, dp_id, 21.5)
    # Give the async EventBus handler a moment to write
    await asyncio.sleep(0.1)

    entries = await _query_history(client, auth_headers, dp_id)
    assert len(entries) >= 1, "Expected at least one history entry"
    assert any(abs(e["v"] - 21.5) < 0.01 for e in entries), "Value 21.5 not found in history"


async def test_history_not_recorded_when_disabled(client, auth_headers):
    """Values are NOT written to history when record_history=False."""
    dp = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Disabled-{uuid.uuid4().hex[:6]}",
        record_history=False,
    )
    dp_id = dp["id"]

    await _write_value(client, auth_headers, dp_id, 99.9)
    await asyncio.sleep(0.1)

    entries = await _query_history(client, auth_headers, dp_id)
    assert len(entries) == 0, f"Expected no history entries, got {len(entries)}"


async def test_history_stops_after_disabling(client, auth_headers):
    """After disabling record_history, subsequent values are no longer recorded."""
    dp = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Stop-{uuid.uuid4().hex[:6]}",
        record_history=True,
    )
    dp_id = dp["id"]

    # Write while enabled
    await _write_value(client, auth_headers, dp_id, 10.0)
    await asyncio.sleep(0.1)
    entries_before = await _query_history(client, auth_headers, dp_id)
    assert len(entries_before) >= 1

    # Disable
    await client.patch(
        f"/api/v1/datapoints/{dp_id}",
        json={"record_history": False},
        headers=auth_headers,
    )

    # Write while disabled
    await _write_value(client, auth_headers, dp_id, 20.0)
    await asyncio.sleep(0.1)
    entries_after = await _query_history(client, auth_headers, dp_id)

    # Count must not have increased — no new entry with value 20.0
    assert not any(abs(e["v"] - 20.0) < 0.01 for e in entries_after), "Value 20.0 was recorded even though record_history=False"


async def test_history_limit_above_1000(client, auth_headers):
    """API must accept limit values above 1000 (bug #316 regression guard)."""
    dp = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Limit-{uuid.uuid4().hex[:6]}",
        record_history=True,
    )
    dp_id = dp["id"]

    # Write two values
    for v in (1.0, 2.0):
        await _write_value(client, auth_headers, dp_id, v)
    await asyncio.sleep(0.1)

    # Requesting limit=10000 must be accepted (not rejected with 422)
    past = (datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=5)).isoformat()
    resp = await client.get(
        f"/api/v1/history/{dp_id}",
        params={"from": past, "limit": 10000},
        headers=auth_headers,
    )
    assert resp.status_code == 200, f"limit=10000 was rejected: {resp.text}"
    assert len(resp.json()) >= 2


async def test_history_resumes_after_enabling(client, auth_headers):
    """After re-enabling record_history, values are recorded again."""
    dp = await _create_dp(
        client,
        auth_headers,
        f"HistTest-Resume-{uuid.uuid4().hex[:6]}",
        record_history=False,
    )
    dp_id = dp["id"]

    # Write while disabled — must not be recorded
    await _write_value(client, auth_headers, dp_id, 5.0)
    await asyncio.sleep(0.1)
    assert len(await _query_history(client, auth_headers, dp_id)) == 0

    # Enable
    await client.patch(
        f"/api/v1/datapoints/{dp_id}",
        json={"record_history": True},
        headers=auth_headers,
    )

    # Write while enabled — must be recorded
    await _write_value(client, auth_headers, dp_id, 42.0)
    await asyncio.sleep(0.1)
    entries = await _query_history(client, auth_headers, dp_id)
    assert any(abs(e["v"] - 42.0) < 0.01 for e in entries), "Value 42.0 not found after re-enabling"
