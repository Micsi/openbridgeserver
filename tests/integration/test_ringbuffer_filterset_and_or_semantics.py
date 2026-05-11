"""Characterization tests for filterset apply-endpoint AND/OR semantics (issue #429).

Pins the current behaviour of POST /api/v1/ringbuffer/filtersets/{id}/query:

  * Within a single rule:
      - adapters.any_of  → OR across adapter names
      - metadata.tags_any_of → OR across tag values
      - datapoints.ids → OR across ids
  * Between rules (and between groups):
      - intersected by id → AND

These tests are short-lived and will be replaced once the #438 refactor lands.
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.integration


_DP_BASE = {
    "name": "RB Filterset AND/OR DP",
    "data_type": "FLOAT",
    "unit": "W",
    "persist_value": False,
}


async def _create_dp(client, auth_headers, name: str, tags: list[str]) -> dict:
    resp = await client.post(
        "/api/v1/datapoints/",
        json={**_DP_BASE, "name": name, "tags": tags},
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


async def _create_filterset(client, auth_headers, payload: dict) -> dict:
    resp = await client.post(
        "/api/v1/ringbuffer/filtersets",
        json=payload,
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _delete_filterset(client, auth_headers, filterset_id: str) -> None:
    await client.delete(
        f"/api/v1/ringbuffer/filtersets/{filterset_id}",
        headers=auth_headers,
    )


async def _query_filterset(client, auth_headers, filterset_id: str) -> list[dict]:
    resp = await client.post(
        f"/api/v1/ringbuffer/filtersets/{filterset_id}/query",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _wide_query(extra_filters: dict | None = None) -> dict:
    """Build a v2 query body with the given filters and a generous limit."""
    filters: dict = {"adapters": {"any_of": ["api"]}}
    if extra_filters:
        filters.update(extra_filters)
    return {
        "filters": filters,
        "sort": {"field": "id", "order": "desc"},
        "pagination": {"limit": 500, "offset": 0},
    }


async def test_filterset_two_groups_intersect_by_id_and_semantics(client, auth_headers):
    """Two groups, each with one rule — the apply endpoint must intersect the per-rule result sets.

    Rule G1 keeps {dp_a, dp_b} (datapoints OR list).
    Rule G2 keeps {dp_b, dp_c} (tag OR list).
    The intersection by id must contain only entries from dp_b.
    """
    tag = f"rb429-{uuid.uuid4().hex[:8]}"
    dp_a = await _create_dp(client, auth_headers, "RB429 AndA", tags=["other"])
    dp_b = await _create_dp(client, auth_headers, "RB429 AndB", tags=[tag])
    dp_c = await _create_dp(client, auth_headers, "RB429 AndC", tags=[tag])

    await _write_value(client, auth_headers, dp_a["id"], 1.0)
    await _write_value(client, auth_headers, dp_b["id"], 2.0)
    await _write_value(client, auth_headers, dp_c["id"], 3.0)

    created = await _create_filterset(
        client,
        auth_headers,
        {
            "name": f"RB429 Two Groups {uuid.uuid4()}",
            "description": "AND across groups, OR within rule lists",
            "dsl_version": 2,
            "is_active": True,
            "query": _wide_query(),
            "groups": [
                {
                    "name": "Group 1: datapoint OR",
                    "is_active": True,
                    "group_order": 0,
                    "rules": [
                        {
                            "name": "Rule 1",
                            "is_active": True,
                            "rule_order": 0,
                            "query": _wide_query({"datapoints": {"ids": [dp_a["id"], dp_b["id"]]}}),
                        }
                    ],
                },
                {
                    "name": "Group 2: tag OR",
                    "is_active": True,
                    "group_order": 1,
                    "rules": [
                        {
                            "name": "Rule 1",
                            "is_active": True,
                            "rule_order": 0,
                            "query": _wide_query({"metadata": {"tags_any_of": [tag]}}),
                        }
                    ],
                },
            ],
        },
    )

    try:
        rows = await _query_filterset(client, auth_headers, created["id"])
        ids = {row["datapoint_id"] for row in rows}
        assert ids == {dp_b["id"]}, f"expected only dp_b, got {ids}"
    finally:
        await _delete_filterset(client, auth_headers, created["id"])


async def test_filterset_rule_adapter_list_is_or(client, auth_headers):
    """`adapters.any_of` inside a single rule must behave as OR.

    With ["api", "knx"] and only an "api" write, the rule must still match.
    """
    dp = await _create_dp(client, auth_headers, "RB429 AdapterOR", tags=["x"])
    await _write_value(client, auth_headers, dp["id"], 7.0)

    created = await _create_filterset(
        client,
        auth_headers,
        {
            "name": f"RB429 Adapter OR {uuid.uuid4()}",
            "dsl_version": 2,
            "is_active": True,
            "query": _wide_query(),
            "groups": [
                {
                    "name": "G",
                    "is_active": True,
                    "group_order": 0,
                    "rules": [
                        {
                            "name": "Adapter OR",
                            "is_active": True,
                            "rule_order": 0,
                            "query": {
                                "filters": {
                                    "adapters": {"any_of": ["api", "knx"]},
                                    "datapoints": {"ids": [dp["id"]]},
                                },
                                "sort": {"field": "id", "order": "desc"},
                                "pagination": {"limit": 100, "offset": 0},
                            },
                        }
                    ],
                }
            ],
        },
    )

    try:
        rows = await _query_filterset(client, auth_headers, created["id"])
        assert rows
        assert all(row["source_adapter"] == "api" for row in rows)
        assert all(row["datapoint_id"] == dp["id"] for row in rows)
    finally:
        await _delete_filterset(client, auth_headers, created["id"])


async def test_filterset_rule_tags_list_is_or(client, auth_headers):
    """`metadata.tags_any_of` inside a single rule must behave as OR."""
    tag_a = f"rb429a-{uuid.uuid4().hex[:8]}"
    tag_b = f"rb429b-{uuid.uuid4().hex[:8]}"
    dp_a = await _create_dp(client, auth_headers, "RB429 TagOR A", tags=[tag_a])
    dp_b = await _create_dp(client, auth_headers, "RB429 TagOR B", tags=[tag_b])

    await _write_value(client, auth_headers, dp_a["id"], 1.0)
    await _write_value(client, auth_headers, dp_b["id"], 2.0)

    created = await _create_filterset(
        client,
        auth_headers,
        {
            "name": f"RB429 Tag OR {uuid.uuid4()}",
            "dsl_version": 2,
            "is_active": True,
            "query": _wide_query(),
            "groups": [
                {
                    "name": "G",
                    "is_active": True,
                    "group_order": 0,
                    "rules": [
                        {
                            "name": "Tag OR",
                            "is_active": True,
                            "rule_order": 0,
                            "query": {
                                "filters": {"metadata": {"tags_any_of": [tag_a, tag_b]}},
                                "sort": {"field": "id", "order": "desc"},
                                "pagination": {"limit": 100, "offset": 0},
                            },
                        }
                    ],
                }
            ],
        },
    )

    try:
        rows = await _query_filterset(client, auth_headers, created["id"])
        ids = {row["datapoint_id"] for row in rows}
        assert dp_a["id"] in ids
        assert dp_b["id"] in ids
    finally:
        await _delete_filterset(client, auth_headers, created["id"])


async def test_filterset_two_rules_in_one_group_are_intersected(client, auth_headers):
    """Multiple rules in a single group must also be intersected by id (AND).

    Mirrors the documented "AND between groups, AND between rules" semantics
    where both per-group and per-rule sets are intersected.
    """
    tag_shared = f"rb429shared-{uuid.uuid4().hex[:8]}"
    dp_match = await _create_dp(client, auth_headers, "RB429 BothMatch", tags=[tag_shared])
    dp_partial = await _create_dp(client, auth_headers, "RB429 PartialMatch", tags=[tag_shared])

    await _write_value(client, auth_headers, dp_match["id"], 10.0)
    await _write_value(client, auth_headers, dp_partial["id"], 20.0)

    created = await _create_filterset(
        client,
        auth_headers,
        {
            "name": f"RB429 Two Rules AND {uuid.uuid4()}",
            "dsl_version": 2,
            "is_active": True,
            "query": _wide_query(),
            "groups": [
                {
                    "name": "Group with two rules",
                    "is_active": True,
                    "group_order": 0,
                    "rules": [
                        {
                            "name": "Rule keep shared tag",
                            "is_active": True,
                            "rule_order": 0,
                            "query": {
                                "filters": {"metadata": {"tags_any_of": [tag_shared]}},
                                "sort": {"field": "id", "order": "desc"},
                                "pagination": {"limit": 200, "offset": 0},
                            },
                        },
                        {
                            "name": "Rule keep only dp_match",
                            "is_active": True,
                            "rule_order": 1,
                            "query": {
                                "filters": {"datapoints": {"ids": [dp_match["id"]]}},
                                "sort": {"field": "id", "order": "desc"},
                                "pagination": {"limit": 200, "offset": 0},
                            },
                        },
                    ],
                }
            ],
        },
    )

    try:
        rows = await _query_filterset(client, auth_headers, created["id"])
        ids = {row["datapoint_id"] for row in rows}
        assert ids == {dp_match["id"]}
    finally:
        await _delete_filterset(client, auth_headers, created["id"])


async def test_filterset_inactive_group_rules_are_ignored(client, auth_headers):
    """When a whole group is inactive, its rules are skipped, leaving only the base query."""
    dp_a = await _create_dp(client, auth_headers, "RB429 InactiveGroup A", tags=["x"])
    dp_b = await _create_dp(client, auth_headers, "RB429 InactiveGroup B", tags=["x"])

    await _write_value(client, auth_headers, dp_a["id"], 1.0)
    await _write_value(client, auth_headers, dp_b["id"], 2.0)

    created = await _create_filterset(
        client,
        auth_headers,
        {
            "name": f"RB429 Inactive Group {uuid.uuid4()}",
            "dsl_version": 2,
            "is_active": True,
            "query": _wide_query({"datapoints": {"ids": [dp_a["id"], dp_b["id"]]}}),
            "groups": [
                {
                    "name": "Disabled narrowing group",
                    "is_active": False,
                    "group_order": 0,
                    "rules": [
                        {
                            "name": "Would narrow to dp_a only — but inactive",
                            "is_active": True,
                            "rule_order": 0,
                            "query": {
                                "filters": {"datapoints": {"ids": [dp_a["id"]]}},
                                "sort": {"field": "id", "order": "desc"},
                                "pagination": {"limit": 200, "offset": 0},
                            },
                        }
                    ],
                }
            ],
        },
    )

    try:
        rows = await _query_filterset(client, auth_headers, created["id"])
        ids = {row["datapoint_id"] for row in rows}
        # Inactive group ignored → both dp_a and dp_b survive.
        assert dp_a["id"] in ids
        assert dp_b["id"] in ids
    finally:
        await _delete_filterset(client, auth_headers, created["id"])
