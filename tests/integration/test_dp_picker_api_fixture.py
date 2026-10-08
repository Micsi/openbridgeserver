"""Seam S9 (#1266 P9): the API responses the datapoint picker reads, recorded from a real import.

A room-oriented project in main group 30 (generic address names, rooms with ETS
functions, an address without a function) with three devices – 1.1.21 and 1.1.22
link four of the six addresses, 1.1.23 links none – is imported with the
``buildings`` and ``groups`` hierarchies. The test records what the picker asks
for: the trees, their nodes, the search pages of every lens (tree, function node,
device, link filter, pagination), the device list and ``knx-device-data``. It
keeps ``gui/tests/fixtures/dp-picker-api.json`` equal to the live responses (ids
replaced by stable placeholders, other trees and datapoints left out), which
``gui/tests/components/ui/DpPicker.spec.js`` serves through a fake API client.
Datapoints of one name are listed by group address: the API sorts by name only and
leaves equal names in the registry's order, which differs from run to run.

``OBS_UPDATE_FIXTURES=1`` rewrites the fixture instead of comparing.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

from tests.knxproj_style_variants import GroupRangeSpec, RoomSpec, knxproj_with_layout, raw_address

pytestmark = pytest.mark.integration

FIXTURE = Path(__file__).parent.parent.parent / "gui" / "tests" / "fixtures" / "dp-picker-api.json"
MAIN = 30


def _project() -> bytes:
    names = {1: "Schalten", 2: "Status", 3: "Schalten", 4: "Status", 5: "Schalten", 6: "Schalten"}
    layout = [
        GroupRangeSpec(
            "Neue Hauptgruppe",
            raw_address(MAIN, 0, 0),
            raw_address(MAIN, 7, 255),
            ranges=[
                GroupRangeSpec(
                    "Neue Mittelgruppe",
                    raw_address(MAIN, 0, 0),
                    raw_address(MAIN, 0, 255),
                    {raw_address(MAIN, 0, sub): name for sub, name in names.items()},
                )
            ],
        )
    ]
    rooms = [
        RoomSpec(
            "Kueche",
            {"Licht Decke": [raw_address(MAIN, 0, 1), raw_address(MAIN, 0, 2)], "Licht Insel": [raw_address(MAIN, 0, 3), raw_address(MAIN, 0, 4)]},
        ),
        RoomSpec("Bad", {"Licht Decke": [raw_address(MAIN, 0, 5)]}),
    ]
    devices = {
        21: [[raw_address(MAIN, 0, 1)], [raw_address(MAIN, 0, 2)]],
        22: [[raw_address(MAIN, 0, 3), raw_address(MAIN, 0, 4)]],
        23: [],
    }
    return knxproj_with_layout("ThreeLevel", layout, rooms, devices=devices)


@pytest.fixture
async def plant(client, auth_headers):
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={"adapter_type": "KNX", "name": f"KnxPicker-{uuid.uuid4().hex[:8]}", "config": {}, "enabled": False},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    instance = resp.json()
    resp = await client.post(
        "/api/v1/knxproj/import",
        files={"file": ("picker.knxproj", _project(), "application/octet-stream")},
        params={"adapter_name": instance["name"], "hierarchy_modes": "buildings,groups"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    trees = {h["mode"]: h["tree_id"] for h in resp.json()["hierarchies"]}
    assert set(trees) == {"buildings", "groups"}, trees
    yield trees
    for tree_id in trees.values():
        await client.delete(f"/api/v1/hierarchy/trees/{tree_id}", headers=auth_headers)
    resp = await client.delete(f"/api/v1/adapters/instances/{instance['id']}", headers=auth_headers)
    assert resp.status_code == 204, resp.text


class _Ids:
    """Replaces ids by placeholders in order of appearance."""

    def __init__(self, trees: dict[str, str]) -> None:
        self.trees = set(trees.values())
        self.ids = {tree_id: f"tree-{mode}" for mode, tree_id in trees.items()}

    def __call__(self, value: str | None, prefix: str) -> str | None:
        if value is None:
            return None
        return self.ids.setdefault(value, f"{prefix}-{len(self.ids)}")


def _item(item: dict, ids: _Ids) -> dict:
    return {
        "id": ids(item["id"], "dp"),
        "name": item["name"],
        "data_type": item["data_type"],
        "unit": item["unit"],
        "group_address": item["group_address"],
        "hierarchy_nodes": [
            {
                "node_id": ids(ref["node_id"], "node"),
                "node_name": ref["node_name"],
                "tree_id": ids(ref["tree_id"], "tree"),
                "tree_name": ref["tree_name"],
                "node_path": [{"node_id": ids(seg["node_id"], "node"), "node_name": seg["node_name"]} for seg in ref["node_path"]],
                "display_depth": ref["display_depth"],
                "group_address": ref["group_address"],
            }
            for ref in item["hierarchy_nodes"]
            if ref["tree_id"] in ids.trees
        ],
    }


def _nodes(nodes: list[dict], ids: _Ids) -> list[dict]:
    return [
        {
            "id": ids(node["id"], "node"),
            "tree_id": ids(node["tree_id"], "tree"),
            "parent_id": ids(node["parent_id"], "node"),
            "name": node["name"],
            "description": node["description"],
            "children": _nodes(node["children"], ids),
        }
        for node in nodes
    ]


async def _get(client, auth_headers, path: str, **params) -> dict | list:
    resp = await client.get(path, params=params, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_picker_reads_trees_nodes_lenses_and_device_data(client, auth_headers, plant):
    ids = _Ids(plant)
    fixture: dict = {}

    trees = [tree for tree in await _get(client, auth_headers, "/api/v1/hierarchy/trees") if tree["id"] in plant.values()]
    fixture["trees"] = [
        {
            "id": ids(tree["id"], "tree"),
            "name": tree["name"],
            "description": tree["description"],
            "display_depth": tree["display_depth"],
            "root_node_id": ids(tree["root_node_id"], "node"),
        }
        for tree in sorted(trees, key=lambda tree: ids(tree["id"], "tree"))
    ]
    fixture["nodes"] = {
        ids(tree_id, "tree"): _nodes(await _get(client, auth_headers, f"/api/v1/hierarchy/trees/{tree_id}/nodes"), ids)
        for _mode, tree_id in sorted(plant.items())
    }

    groups, buildings = plant["groups"], plant["buildings"]
    in_buildings = await _get(client, auth_headers, "/api/v1/search/", tree_id=buildings, size=500)
    [kitchen_ceiling] = {
        ref["node_id"]
        for item in in_buildings["items"]
        for ref in item["hierarchy_nodes"]
        if ref["tree_id"] == buildings and ref["node_name"] == "Licht Decke" and ref["node_path"][-1]["node_name"] == "Kueche"
    }
    in_groups = await _get(client, auth_headers, "/api/v1/search/", tree_id=groups, size=500)
    ours = {item["id"] for item in in_groups["items"]}
    [kitchen_switch] = [item["id"] for item in in_groups["items"] if item["group_address"] == "30/0/1"]
    # (params, only ours): device filters stay unscoped because no other test uses main group 30;
    # the name search sees datapoints of other tests and is cut down to this plant's.
    queries = [
        ({"tree_id": groups, "size": 500}, False),
        ({"tree_id": groups, "size": 4, "page": 0}, False),
        ({"tree_id": groups, "size": 4, "page": 1}, False),
        ({"tree_id": buildings, "size": 500}, False),
        ({"node_id": kitchen_ceiling, "size": 500}, False),
        ({"device": "1.1.21", "size": 500}, False),
        ({"device": "1.1.21,1.1.22", "size": 500}, False),
        ({"device": "1.1.23", "size": 500}, False),
        ({"tree_id": groups, "knx_linked": "true", "size": 500}, False),
        ({"tree_id": groups, "knx_linked": "false", "size": 500}, False),
        ({"tree_id": groups, "q": "status", "size": 500}, False),
        ({"q": kitchen_switch, "size": 1}, False),
        ({"q": "Schalten", "size": 500}, True),
    ]
    fixture["search"] = []
    for params, only_ours in queries:
        body = await _get(client, auth_headers, "/api/v1/search/", **params)
        # The API sorts by name only; equal names keep the registry's order, which differs per process.
        found = sorted(
            (item for item in body["items"] if not only_ours or item["id"] in ours), key=lambda item: (item["name"].lower(), item["group_address"])
        )
        stable = {key: ids(value, "node") if key in ("tree_id", "node_id") or value in ours else value for key, value in params.items()}
        fixture["search"].append(
            {
                "params": stable,
                "response": {
                    "items": [_item(item, ids) for item in found],
                    "total": len(found) if only_ours else body["total"],
                    "page": body["page"],
                    "size": body["size"],
                    "pages": 1 if only_ours else body["pages"],
                },
            }
        )

    devices = await _get(client, auth_headers, "/api/v1/knxproj/devices", q="Testgeraet", page=0, size=50)
    fixture["devices"] = {
        "items": [{key: device[key] for key in ("pa", "name", "manufacturer", "order_number")} for device in devices["items"]],
        "total": devices["total"],
    }
    fixture["knx_device_data"] = await _get(client, auth_headers, "/api/v1/search/knx-device-data")

    # What the lenses must show, checked on the live responses before they become the fixture.
    by_query = {json.dumps(entry["params"], sort_keys=True): entry["response"] for entry in fixture["search"]}

    def response(**params) -> dict:
        return by_query[json.dumps(params, sort_keys=True)]

    assert response(tree_id="tree-groups", size=500)["total"] == 6
    assert [item["name"] for item in response(node_id=ids(kitchen_ceiling, "node"), size=500)["items"]] == ["Schalten", "Status"]
    assert response(tree_id="tree-buildings", size=500)["total"] == 5, "R3: 30/0/6 has no function"
    assert [item["group_address"] for item in response(device="1.1.21", size=500)["items"]] == ["30/0/1", "30/0/2"]
    assert response(device="1.1.21,1.1.22", size=500)["total"] == 4
    assert response(device="1.1.23", size=500)["total"] == 0
    assert [item["group_address"] for item in response(q=ids(kitchen_switch, "dp"), size=1)["items"]] == ["30/0/1"]
    assert response(q="Schalten", size=500)["total"] == 4
    assert sorted(item["group_address"] for item in response(tree_id="tree-groups", knx_linked="false", size=500)["items"]) == ["30/0/5", "30/0/6"]
    assert [(page["total"], page["pages"], len(page["items"])) for page in (response(tree_id="tree-groups", size=4, page=n) for n in (0, 1))] == [
        (6, 2, 4),
        (6, 2, 2),
    ]
    assert [device["pa"] for device in fixture["devices"]["items"]] == ["1.1.21", "1.1.22", "1.1.23"]
    assert fixture["knx_device_data"] == {"knx_device_data": True}
    assert {tree["description"] for tree in fixture["trees"]} == {"ets_import:buildings", "ets_import:groups"}

    if os.environ.get("OBS_UPDATE_FIXTURES") == "1":
        staged = FIXTURE.with_suffix(".json.tmp")
        staged.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        staged.replace(FIXTURE)
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == fixture, "stale fixture: rerun with OBS_UPDATE_FIXTURES=1"
