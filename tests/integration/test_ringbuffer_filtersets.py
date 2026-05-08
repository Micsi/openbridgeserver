"""Integration tests for RingBuffer filtersets API (issue #389)."""

from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.integration


_DP_BASE = {
    "name": "Ringbuffer Filterset Test DP",
    "data_type": "FLOAT",
    "unit": "W",
    "tags": ["ringbuffer-filterset-test"],
    "persist_value": False,
}


async def _create_dp(client, auth_headers, name: str) -> dict:
    resp = await client.post(
        "/api/v1/datapoints/",
        json={**_DP_BASE, "name": name},
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


async def _create_non_admin_user_and_headers(client, auth_headers, username: str, password: str) -> dict:
    create_resp = await client.post(
        "/api/v1/auth/users",
        json={
            "username": username,
            "password": password,
            "is_admin": False,
            "mqtt_enabled": False,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201, create_resp.text

    from obs.api.auth import create_access_token

    token = create_access_token(username)
    return {"Authorization": f"Bearer {token}"}


def _query_for_dp(dp_id: str) -> dict:
    return {
        "filters": {"datapoints": {"ids": [dp_id]}},
        "sort": {"field": "id", "order": "desc"},
        "pagination": {"limit": 100, "offset": 0},
    }


async def test_ringbuffer_filtersets_crud_clone_and_default(client, auth_headers):
    payload = {
        "name": f"RB Filterset {uuid.uuid4()}",
        "description": "Issue 389 integration test",
        "dsl_version": 2,
        "is_active": True,
        "query": {
            "filters": {"adapters": {"any_of": ["api"]}},
            "sort": {"field": "id", "order": "desc"},
            "pagination": {"limit": 50, "offset": 0},
        },
        "groups": [
            {
                "name": "Group A",
                "is_active": True,
                "group_order": 10,
                "rules": [
                    {
                        "name": "Rule A",
                        "is_active": True,
                        "rule_order": 10,
                        "query": {
                            "filters": {"metadata": {"tags_any_of": ["ringbuffer-filterset-test"]}},
                            "sort": {"field": "id", "order": "desc"},
                            "pagination": {"limit": 100, "offset": 0},
                        },
                    }
                ],
            }
        ],
    }

    created = await _create_filterset(client, auth_headers, payload)
    clone_id = None
    try:
        assert created["id"]
        assert created["name"] == payload["name"]
        assert created["dsl_version"] == 2
        assert created["is_default"] is False
        assert created["groups"][0]["name"] == "Group A"
        assert created["groups"][0]["rules"][0]["name"] == "Rule A"

        list_resp = await client.get("/api/v1/ringbuffer/filtersets", headers=auth_headers)
        assert list_resp.status_code == 200, list_resp.text
        ids = [row["id"] for row in list_resp.json()]
        assert created["id"] in ids

        get_resp = await client.get(f"/api/v1/ringbuffer/filtersets/{created['id']}", headers=auth_headers)
        assert get_resp.status_code == 200, get_resp.text
        fetched = get_resp.json()
        assert fetched["id"] == created["id"]
        assert fetched["groups"][0]["rules"][0]["is_active"] is True

        update_resp = await client.put(
            f"/api/v1/ringbuffer/filtersets/{created['id']}",
            json={
                "name": f"{payload['name']} Updated",
                "groups": [
                    {
                        "id": fetched["groups"][0]["id"],
                        "name": "Group A Updated",
                        "is_active": True,
                        "group_order": 10,
                        "rules": [
                            {
                                "id": fetched["groups"][0]["rules"][0]["id"],
                                "name": "Rule A Updated",
                                "is_active": False,
                                "rule_order": 10,
                                "query": fetched["groups"][0]["rules"][0]["query"],
                            }
                        ],
                    }
                ],
            },
            headers=auth_headers,
        )
        assert update_resp.status_code == 200, update_resp.text
        updated = update_resp.json()
        assert updated["name"].endswith("Updated")
        assert updated["groups"][0]["name"] == "Group A Updated"
        assert updated["groups"][0]["rules"][0]["is_active"] is False

        clone_resp = await client.post(
            f"/api/v1/ringbuffer/filtersets/{created['id']}/clone",
            json={"name": f"{payload['name']} Clone"},
            headers=auth_headers,
        )
        assert clone_resp.status_code == 201, clone_resp.text
        cloned = clone_resp.json()
        clone_id = cloned["id"]
        assert cloned["id"] != created["id"]
        assert cloned["name"].endswith("Clone")
        assert cloned["groups"][0]["rules"][0]["is_active"] is False

        default_resp = await client.post(
            f"/api/v1/ringbuffer/filtersets/{clone_id}/default",
            headers=auth_headers,
        )
        assert default_resp.status_code == 200, default_resp.text
        defaulted = default_resp.json()
        assert defaulted["id"] == clone_id
        assert defaulted["is_default"] is True

        default_get_resp = await client.get(
            "/api/v1/ringbuffer/filtersets/default",
            headers=auth_headers,
        )
        assert default_get_resp.status_code == 200, default_get_resp.text
        assert default_get_resp.json()["id"] == clone_id
    finally:
        if clone_id:
            await _delete_filterset(client, auth_headers, clone_id)
        await _delete_filterset(client, auth_headers, created["id"])


async def test_ringbuffer_filterset_query_ignores_disabled_rules(client, auth_headers):
    dp_a = await _create_dp(client, auth_headers, "RB Filterset Query A")
    dp_b = await _create_dp(client, auth_headers, "RB Filterset Query B")
    await _write_value(client, auth_headers, dp_a["id"], 10.0)
    await _write_value(client, auth_headers, dp_b["id"], 20.0)

    created = await _create_filterset(
        client,
        auth_headers,
        {
            "name": f"RB Query Filterset {uuid.uuid4()}",
            "description": "activation logic check",
            "dsl_version": 2,
            "is_active": True,
            "query": {
                "filters": {"adapters": {"any_of": ["api"]}},
                "sort": {"field": "id", "order": "desc"},
                "pagination": {"limit": 200, "offset": 0},
            },
            "groups": [
                {
                    "name": "Datapoint rules",
                    "is_active": True,
                    "group_order": 0,
                    "rules": [
                        {
                            "name": "Only A (active)",
                            "is_active": True,
                            "rule_order": 0,
                            "query": _query_for_dp(dp_a["id"]),
                        },
                        {
                            "name": "Only B (inactive)",
                            "is_active": False,
                            "rule_order": 1,
                            "query": _query_for_dp(dp_b["id"]),
                        },
                    ],
                }
            ],
        },
    )
    try:
        query_resp = await client.post(
            f"/api/v1/ringbuffer/filtersets/{created['id']}/query",
            headers=auth_headers,
        )
        assert query_resp.status_code == 200, query_resp.text
        rows = query_resp.json()
        assert rows
        assert all(row["datapoint_id"] == dp_a["id"] for row in rows)

        rule_1 = created["groups"][0]["rules"][0]
        rule_2 = created["groups"][0]["rules"][1]
        active_rule_2 = {
            "id": rule_2["id"],
            "name": rule_2["name"],
            "is_active": True,
            "rule_order": rule_2["rule_order"],
            "query": rule_2["query"],
        }
        update_resp = await client.put(
            f"/api/v1/ringbuffer/filtersets/{created['id']}",
            json={
                "groups": [
                    {
                        "id": created["groups"][0]["id"],
                        "name": created["groups"][0]["name"],
                        "is_active": True,
                        "group_order": created["groups"][0]["group_order"],
                        "rules": [
                            {
                                "id": rule_1["id"],
                                "name": rule_1["name"],
                                "is_active": rule_1["is_active"],
                                "rule_order": rule_1["rule_order"],
                                "query": rule_1["query"],
                            },
                            active_rule_2,
                        ],
                    }
                ]
            },
            headers=auth_headers,
        )
        assert update_resp.status_code == 200, update_resp.text

        query_resp_all_active = await client.post(
            f"/api/v1/ringbuffer/filtersets/{created['id']}/query",
            headers=auth_headers,
        )
        assert query_resp_all_active.status_code == 200, query_resp_all_active.text
        assert query_resp_all_active.json() == []

        set_inactive_resp = await client.put(
            f"/api/v1/ringbuffer/filtersets/{created['id']}",
            json={"is_active": False},
            headers=auth_headers,
        )
        assert set_inactive_resp.status_code == 200, set_inactive_resp.text

        query_resp_set_inactive = await client.post(
            f"/api/v1/ringbuffer/filtersets/{created['id']}/query",
            headers=auth_headers,
        )
        assert query_resp_set_inactive.status_code == 200, query_resp_set_inactive.text
        assert query_resp_set_inactive.json() == []
    finally:
        await _delete_filterset(client, auth_headers, created["id"])


async def test_ringbuffer_filterset_mutations_require_admin(client, auth_headers):
    username = f"rb-user-{uuid.uuid4().hex[:8]}"
    password = "test-password-123"
    user_headers = await _create_non_admin_user_and_headers(client, auth_headers, username=username, password=password)
    created_id = None
    try:
        create_resp = await client.post(
            "/api/v1/ringbuffer/filtersets",
            json={
                "name": f"RB Restricted {uuid.uuid4()}",
                "query": {
                    "filters": {"adapters": {"any_of": ["api"]}},
                    "pagination": {"limit": 100, "offset": 0},
                },
            },
            headers=user_headers,
        )
        assert create_resp.status_code == 403, create_resp.text

        created = await _create_filterset(
            client,
            auth_headers,
            {
                "name": f"RB Admin Created {uuid.uuid4()}",
                "query": {
                    "filters": {"adapters": {"any_of": ["api"]}},
                    "pagination": {"limit": 100, "offset": 0},
                },
            },
        )
        created_id = created["id"]

        for method, path in [
            ("put", f"/api/v1/ringbuffer/filtersets/{created_id}"),
            ("delete", f"/api/v1/ringbuffer/filtersets/{created_id}"),
            ("post", f"/api/v1/ringbuffer/filtersets/{created_id}/clone"),
            ("post", f"/api/v1/ringbuffer/filtersets/{created_id}/default"),
        ]:
            kwargs = {"headers": user_headers}
            if method == "put":
                kwargs["json"] = {"name": "forbidden update"}
            if path.endswith("/clone"):
                kwargs["json"] = {"name": "forbidden clone"}
            resp = await getattr(client, method)(path, **kwargs)
            assert resp.status_code == 403, f"{method.upper()} {path} -> {resp.status_code}, {resp.text}"
    finally:
        if created_id:
            await _delete_filterset(client, auth_headers, created_id)
        await client.delete(f"/api/v1/auth/users/{username}", headers=auth_headers)


async def test_ringbuffer_filterset_query_rejects_too_many_active_rules(client, auth_headers):
    created = await _create_filterset(
        client,
        auth_headers,
        {
            "name": f"RB Rule Cap {uuid.uuid4()}",
            "query": {
                "filters": {"adapters": {"any_of": ["api"]}},
                "pagination": {"limit": 100, "offset": 0},
            },
            "groups": [
                {
                    "name": "Too many active rules",
                    "is_active": True,
                    "group_order": 0,
                    "rules": [
                        {
                            "name": f"Rule {idx}",
                            "is_active": True,
                            "rule_order": idx,
                            "query": {
                                "filters": {"adapters": {"any_of": ["api"]}},
                                "pagination": {"limit": 100, "offset": 0},
                            },
                        }
                        for idx in range(51)
                    ],
                }
            ],
        },
    )
    try:
        resp = await client.post(
            f"/api/v1/ringbuffer/filtersets/{created['id']}/query",
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "too many active rules in filterset" in resp.text
    finally:
        await _delete_filterset(client, auth_headers, created["id"])
