"""Seam S6 (#1266): .knxproj import → GET /api/v1/search with the KNX device filters.

The demo project gets five group addresses it does not use and two devices on
line 1.1: device 1.1.21 links four of them through three communication objects,
device 1.1.22 shares one of them, the fifth address has no device. A datapoint
made by hand carries the unlinked address as command address and the shared one
as status address. The plain demo is imported into a second KNX instance first,
so the test passes on an empty and on a populated database alike; datapoints of
earlier runs lost their bindings with their instance and match no device filter.
"""

from __future__ import annotations

import uuid

import pytest

from obs.api.auth import create_access_token
from obs.db.database import get_db
from tests.knxproj_style_variants import DEMO_KNXPROJ, knxproj_with_extra_group_addresses

pytestmark = pytest.mark.integration

PREFIX = "P7 Linse"
# 1/1/116 … 1/1/120, all in the demo's "Schalten" range.
EXTRA = {2420: f"{PREFIX} A1", 2421: f"{PREFIX} A2", 2422: f"{PREFIX} A3", 2423: f"{PREFIX} B", 2424: f"{PREFIX} C"}
DEVICES = {21: [[2420], [2421, 2422], [2423]], 22: [[2423]]}
ON_21 = [f"{PREFIX} A1", f"{PREFIX} A2", f"{PREFIX} A3", f"{PREFIX} B", f"{PREFIX} S"]


async def _knx_instance(client, auth_headers) -> dict:
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={"adapter_type": "KNX", "name": f"KnxLens-{uuid.uuid4().hex[:8]}", "config": {}, "enabled": False},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _import(client, auth_headers, content: bytes, **params) -> dict:
    resp = await client.post(
        "/api/v1/knxproj/import",
        files={"file": ("demo.knxproj", content, "application/octet-stream")},
        params=params,
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _search(client, headers, **params) -> dict:
    resp = await client.get("/api/v1/search/", params={"size": 500, **params}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _device_data(client, headers) -> bool:
    resp = await client.get("/api/v1/search/knx-device-data", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["knx_device_data"]


def _names(body: dict) -> list[str]:
    return [item["name"] for item in body["items"]]


@pytest.fixture
async def plant(client, auth_headers):
    neighbour = await _knx_instance(client, auth_headers)
    await _import(client, auth_headers, DEMO_KNXPROJ.read_bytes(), adapter_name=neighbour["name"])
    instance = await _knx_instance(client, auth_headers)
    body = await _import(
        client,
        auth_headers,
        knxproj_with_extra_group_addresses(EXTRA, DEVICES),
        adapter_name=instance["name"],
        hierarchy_modes="groups",
    )
    for pa in ("1.1.21", "1.1.22"):
        assert (await client.get(f"/api/v1/knxproj/devices/{pa}", headers=auth_headers)).status_code == 200
    [tree] = [h for h in body["hierarchies"] if h["mode"] == "groups"]
    by_hand = await client.post(
        "/api/v1/datapoints/",
        json={"name": f"{PREFIX} S", "data_type": "BOOLEAN", "persist_value": False},
        headers=auth_headers,
    )
    assert by_hand.status_code == 201, by_hand.text
    binding = await client.post(
        f"/api/v1/datapoints/{by_hand.json()['id']}/bindings",
        json={"adapter_instance_id": instance["id"], "direction": "DEST", "config": {"group_address": "1/1/120", "state_group_address": "1/1/119"}},
        headers=auth_headers,
    )
    assert binding.status_code == 201, binding.text
    yield {"instance": instance, "tree_id": tree["tree_id"]}
    await client.delete(f"/api/v1/hierarchy/trees/{tree['tree_id']}", headers=auth_headers)
    await client.delete(f"/api/v1/datapoints/{by_hand.json()['id']}", headers=auth_headers)
    for inst in (instance, neighbour):
        resp = await client.delete(f"/api/v1/adapters/instances/{inst['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text


async def test_device_filter_and_link_filter_after_import(client, auth_headers, plant):
    own = {"q": PREFIX}
    on_21 = await _search(client, auth_headers, device="1.1.21", **own)
    assert (_names(on_21), on_21["total"], await _device_data(client, auth_headers)) == (ON_21, 5, True)
    assert _names(await _search(client, auth_headers, device="1.1.22", **own)) == [f"{PREFIX} B", f"{PREFIX} S"]
    assert (await _search(client, auth_headers, device="1.1.21,1.1.22", **own))["total"] == 5
    assert (await _search(client, auth_headers, device="1.1.99", **own))["total"] == 0

    assert _names(await _search(client, auth_headers, knx_linked="true", **own)) == ON_21
    assert _names(await _search(client, auth_headers, knx_linked="false", **own)) == [f"{PREFIX} C"]


async def test_device_filter_matches_the_device_view(client, auth_headers, plant):
    for pa in ("1.1.21", "1.1.22"):
        view = await client.get(f"/api/v1/knxproj/devices/{pa}/datapoints", headers=auth_headers)
        assert view.status_code == 200, view.text
        searched = await _search(client, auth_headers, device=pa)
        assert {item["id"] for item in searched["items"]} == {dp["id"] for dp in view.json()["datapoints"]}
        assert searched["total"] == len({dp["id"] for dp in view.json()["datapoints"]})


async def test_device_filter_combines_with_pagination_and_tree(client, auth_headers, plant):
    pages = [await _search(client, auth_headers, q=PREFIX, device="1.1.21", size=2, page=page) for page in range(3)]
    assert [(body["total"], body["pages"]) for body in pages] == [(5, 3)] * 3
    assert [name for body in pages for name in _names(body)] == ON_21

    # The hand-made datapoint is not in the imported tree.
    in_tree = await _search(client, auth_headers, tree_id=plant["tree_id"], device="1.1.22")
    assert (_names(in_tree), in_tree["total"]) == ([f"{PREFIX} B"], 1)


async def test_non_admins_learn_nothing_through_the_filters_without_instance_grant(client, auth_headers, plant):
    username = f"lens-user-{uuid.uuid4().hex[:8]}"
    created = await client.post(
        "/api/v1/auth/users",
        json={"username": username, "password": "pw-12345678", "is_admin": False, "mqtt_enabled": False},
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text
    headers = {"Authorization": f"Bearer {create_access_token(username)}"}
    own = await _search(client, auth_headers, q=PREFIX)
    # Datapoints of earlier runs lost their binding with their instance.
    ours = [item for item in own["items"] if item["group_address"]]
    assert len(ours) == 6
    db = get_db()
    try:
        await _set_grants(client, auth_headers, username, [("datapoint", item["id"]) for item in ours])
        assert (await _search(client, headers, q=PREFIX))["total"] == 6
        for params in ({"device": "1.1.21"}, {"device": "1.1.22"}, {"knx_linked": "true"}, {"knx_linked": "false"}):
            body = await _search(client, headers, q=PREFIX, **params)
            assert (body["items"], body["total"]) == ([], 0), params
        assert await _device_data(client, headers) is False

        # Positive control: with the instance readable, and enabled for the device view.
        await _set_grants(
            client, auth_headers, username, [("datapoint", item["id"]) for item in ours] + [("adapter_instance", plant["instance"]["id"])]
        )
        await db.execute_and_commit("UPDATE adapter_instances SET enabled = 1 WHERE id = ?", (plant["instance"]["id"],))
        body = await _search(client, headers, q=PREFIX, device="1.1.21")
        assert (_names(body), await _device_data(client, headers)) == (ON_21, True)
    finally:
        await db.execute_and_commit("UPDATE adapter_instances SET enabled = 0 WHERE id = ?", (plant["instance"]["id"],))
        await client.delete(f"/api/v1/auth/users/{username}", headers=auth_headers)


async def _set_grants(client, auth_headers, username: str, targets: list[tuple[str, str]]) -> None:
    state = await client.get(f"/api/v1/authz/principals/user/{username}/grants", headers=auth_headers)
    assert state.status_code == 200, state.text
    resp = await client.put(
        f"/api/v1/authz/principals/user/{username}/grants",
        json={"grants": [{"node_type": node_type, "node_id": node_id, "role": "guest", "effect": "allow"} for node_type, node_id in targets]},
        headers={**auth_headers, "If-Match": state.headers["etag"]},
    )
    assert resp.status_code == 200, resp.text


async def test_a_project_without_device_data_switches_the_link_filter_off(client, auth_headers):
    """K7: only group addresses, no devices – the response says so, the list stays usable."""
    instance = await _knx_instance(client, auth_headers)
    try:
        await _import(client, auth_headers, knxproj_with_extra_group_addresses({2426: "P7 Ohne Geraete"}), adapter_name=instance["name"])
        plain = await _search(client, auth_headers, q="P7 Ohne Geraete")
        assert (_names(plain), await _device_data(client, auth_headers)) == (["P7 Ohne Geraete"], False)
        assert (await _search(client, auth_headers, knx_linked="true"))["total"] == 0
        assert _names(await _search(client, auth_headers, q="P7 Ohne Geraete", knx_linked="false")) == ["P7 Ohne Geraete"]
    finally:
        resp = await client.delete(f"/api/v1/adapters/instances/{instance['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
