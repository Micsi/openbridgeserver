"""Seams S3/S7 (#1266 P6): ETS layouts → hierarchy import → node and search API.

Synthetic projects (``knxproj_with_layout``) cover the group address layouts the
datapoint picker has to tell apart:

- K1 three-level, one name repeated over middle groups; K4 one name twice in one range;
- K2 two-level without middle groups; K3 free with nested ranges;
- K5 a datapoint with a switch and a status address;
- R1–R3 a room-oriented project: generic address names, a meaningless main group,
  an address without a function;
- several datapoints on one address (two KNX instances).

Every test uses its own main group (20–24), keeps to its own adapter instances and
reads trees through the API only. ``test_layouts_through_the_formatter`` writes what
the search API returns per tree to ``gui/tests/fixtures/search-ets-layouts.json``;
``gui/tests/utils/hierarchyDatapointPathsLayouts.spec.js`` feeds it through the
picker's path formatter. ``OBS_UPDATE_FIXTURES=1`` rewrites the fixture instead of
comparing.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

from obs.db.database import get_db
from tests.knx_group_address_invariant import non_internal_group_addresses
from tests.knxproj_style_variants import (
    LIGHTING_NAMES,
    GroupRangeSpec,
    RoomSpec,
    knxproj_with_layout,
    lighting_layout,
    raw_address,
    two_level_lighting_layout,
)

pytestmark = pytest.mark.integration

FIXTURE = Path(__file__).parent.parent.parent / "gui" / "tests" / "fixtures" / "search-ets-layouts.json"
SPOTS, CEILING = LIGHTING_NAMES


async def _instance(client, auth_headers) -> dict:
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={"adapter_type": "KNX", "name": f"KnxLayout-{uuid.uuid4().hex[:8]}", "config": {}, "enabled": False},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _import(client, auth_headers, content: bytes, instance: dict, modes: str) -> dict:
    resp = await client.post(
        "/api/v1/knxproj/import",
        files={"file": ("layout.knxproj", content, "application/octet-stream")},
        params={"adapter_name": instance["name"], "hierarchy_modes": modes},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    trees = {h["mode"]: h for h in body["hierarchies"]}
    assert all(h["status"] == "created" for h in trees.values()), trees
    return trees


async def _bindings(client, auth_headers, instance: dict) -> dict[str, dict]:
    """Group address → binding of this instance."""
    resp = await client.get(f"/api/v1/adapters/instances/{instance['id']}/bindings", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return {entry["config"]["group_address"]: entry for entry in resp.json()}


async def _tree_items(client, auth_headers, tree_id: str, datapoint_ids: set[str]) -> list[dict]:
    resp = await client.get("/api/v1/search/", params={"tree_id": tree_id, "size": 500}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return sorted((item for item in resp.json()["items"] if item["id"] in datapoint_ids), key=lambda item: item["group_address"])


def _paths(item: dict, tree_id: str) -> list[tuple[list[str], str | None]]:
    """(root → linked node, address of the link) per link of ``item`` in ``tree_id``."""
    return [
        ([*(seg["node_name"] for seg in ref["node_path"]), ref["node_name"]], ref["group_address"])
        for ref in item["hierarchy_nodes"]
        if ref["tree_id"] == tree_id
    ]


async def _node_names(client, auth_headers, tree_id: str) -> list[str]:
    resp = await client.get(f"/api/v1/hierarchy/trees/{tree_id}/nodes", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    names: list[str] = []

    def walk(nodes: list[dict]) -> None:
        for node in nodes:
            names.append(node["name"])
            walk(node["children"])

    walk(resp.json())
    return names


async def _cleanup(client, auth_headers, trees: dict, *instances: dict) -> None:
    for tree in trees.values():
        await client.delete(f"/api/v1/hierarchy/trees/{tree['tree_id']}", headers=auth_headers)
    for instance in instances:
        resp = await client.delete(f"/api/v1/adapters/instances/{instance['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text


def _projection(items: list[dict], tree_id: str) -> list[dict]:
    """What the path formatter reads, with ids replaced in order of appearance."""
    ids: dict[str, str] = {tree_id: "tree"}

    def stable(value: str, prefix: str) -> str:
        return ids.setdefault(value, f"{prefix}-{len(ids)}")

    return [
        {
            "id": stable(item["id"], "dp"),
            "name": item["name"],
            "data_type": item["data_type"],
            "group_address": item["group_address"],
            "hierarchy_nodes": [
                {
                    "node_id": stable(ref["node_id"], "node"),
                    "node_name": ref["node_name"],
                    "tree_id": stable(ref["tree_id"], "tree"),
                    "tree_name": ref["tree_name"],
                    "node_path": [{"node_id": stable(seg["node_id"], "node"), "node_name": seg["node_name"]} for seg in ref["node_path"]],
                    "display_depth": ref["display_depth"],
                    "group_address": ref["group_address"],
                }
                for ref in item["hierarchy_nodes"]
                if ref["tree_id"] == tree_id
            ],
        }
        for item in items
    ]


async def test_k1_k4_three_level_paths_follow_the_ranges_and_record_their_address(client, auth_headers):
    instance = await _instance(client, auth_headers)
    trees = await _import(client, auth_headers, knxproj_with_layout("ThreeLevel", lighting_layout(20)), instance, "groups,mid")
    try:
        bindings = await _bindings(client, auth_headers, instance)
        ids = {entry["datapoint_id"] for entry in bindings.values()}
        groups = await _tree_items(client, auth_headers, trees["groups"]["tree_id"], ids)
        mid = await _tree_items(client, auth_headers, trees["mid"]["tree_id"], ids)

        assert [(item["group_address"], _paths(item, trees["groups"]["tree_id"])) for item in groups] == [
            ("20/1/1", [(["Beleuchtung", "Schalten", SPOTS], "20/1/1")]),
            ("20/1/2", [(["Beleuchtung", "Schalten", CEILING], "20/1/2")]),
            ("20/1/3", [(["Beleuchtung", "Schalten", SPOTS], "20/1/3")]),
            ("20/2/1", [(["Beleuchtung", "Status", SPOTS], "20/2/1")]),
            ("20/2/2", [(["Beleuchtung", "Status", CEILING], "20/2/2")]),
            ("20/3/1", [(["Beleuchtung", "Dimmen", SPOTS], "20/3/1")]),
        ]
        assert [(item["group_address"], _paths(item, trees["mid"]["tree_id"])) for item in mid] == [
            ("20/1/1", [(["Beleuchtung", "Schalten"], "20/1/1")]),
            ("20/1/2", [(["Beleuchtung", "Schalten"], "20/1/2")]),
            ("20/1/3", [(["Beleuchtung", "Schalten"], "20/1/3")]),
            ("20/2/1", [(["Beleuchtung", "Status"], "20/2/1")]),
            ("20/2/2", [(["Beleuchtung", "Status"], "20/2/2")]),
            ("20/3/1", [(["Beleuchtung", "Dimmen"], "20/3/1")]),
        ]
        resp = await client.get("/api/v1/config/export", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        exported = {(link["datapoint_id"], link["group_address"]) for link in resp.json()["hierarchy_dp_links"]}
        assert {(entry["datapoint_id"], address) for address, entry in bindings.items()} <= exported, "a backup keeps the link address"
    finally:
        await _cleanup(client, auth_headers, trees, instance)


async def test_k2_two_level_tree_has_no_middle_groups(client, auth_headers):
    instance = await _instance(client, auth_headers)
    trees = await _import(client, auth_headers, knxproj_with_layout("TwoLevel", two_level_lighting_layout(21)), instance, "groups,mid,flat")
    try:
        bindings = await _bindings(client, auth_headers, instance)
        ids = {entry["datapoint_id"] for entry in bindings.values()}
        expected = {
            "groups": [(["Beleuchtung", SPOTS], "21/0/1"), (["Beleuchtung", CEILING], "21/1/44")],
            "mid": [(["Beleuchtung"], "21/0/1"), (["Beleuchtung"], "21/1/44")],
            "flat": [(["Beleuchtung", SPOTS], "21/0/1"), (["Beleuchtung", CEILING], "21/1/44")],
        }
        for mode, paths in expected.items():
            tree_id = trees[mode]["tree_id"]
            items = await _tree_items(client, auth_headers, tree_id, ids)
            assert [path for item in items for path in _paths(item, tree_id)] == paths, mode
            assert not [name for name in await _node_names(client, auth_headers, tree_id) if name.startswith(("Mittelgruppe", "Hauptgruppe"))], mode
        assert await non_internal_group_addresses(get_db(), binding_ids={entry["binding_id"] for entry in bindings.values()}) == []
    finally:
        await _cleanup(client, auth_headers, trees, instance)


async def test_k3_free_layout_follows_nested_range_names(client, auth_headers):
    house = raw_address(22, 0, 0)
    layout = [
        GroupRangeSpec(
            "Haus",
            house,
            house + 2047,
            ranges=[
                GroupRangeSpec("EG", house, house + 255, ranges=[GroupRangeSpec("Licht", house, house + 63, {house + 1: SPOTS, house + 2: CEILING})]),
                GroupRangeSpec("OG", house + 256, house + 511, {house + 257: SPOTS}),
            ],
        )
    ]
    instance = await _instance(client, auth_headers)
    trees = await _import(client, auth_headers, knxproj_with_layout("Free", layout), instance, "groups,mid")
    try:
        bindings = await _bindings(client, auth_headers, instance)
        ids = {entry["datapoint_id"] for entry in bindings.values()}
        groups_id, mid_id = trees["groups"]["tree_id"], trees["mid"]["tree_id"]
        groups = await _tree_items(client, auth_headers, groups_id, ids)
        mid = await _tree_items(client, auth_headers, mid_id, ids)
        assert [path for item in groups for path in _paths(item, groups_id)] == [
            (["Haus", "EG", "Licht", SPOTS], "22/0/1"),
            (["Haus", "EG", "Licht", CEILING], "22/0/2"),
            (["Haus", "OG", SPOTS], "22/1/1"),
        ]
        assert [path for item in mid for path in _paths(item, mid_id)] == [
            (["Haus", "EG", "Licht"], "22/0/1"),
            (["Haus", "EG", "Licht"], "22/0/2"),
            (["Haus", "OG"], "22/1/1"),
        ]
        assert await non_internal_group_addresses(get_db(), binding_ids={entry["binding_id"] for entry in bindings.values()}) == []
    finally:
        await _cleanup(client, auth_headers, trees, instance)


async def _switch_with_status(client, auth_headers, main: int) -> tuple[dict, dict, dict[str, str]]:
    """K5: the ``CEILING`` switch datapoint also listens to its status address; trees rebuilt."""
    instance = await _instance(client, auth_headers)
    await _import(client, auth_headers, knxproj_with_layout("ThreeLevel", lighting_layout(main)), instance, "groups")
    bindings = await _bindings(client, auth_headers, instance)
    switch = bindings[f"{main}/1/2"]
    resp = await client.patch(
        f"/api/v1/datapoints/{switch['datapoint_id']}/bindings/{switch['binding_id']}",
        json={"config": {**switch["config"], "state_group_address": f"{main}/2/2"}},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    trees = {}
    for mode in ("groups", "mid"):
        resp = await client.post(
            "/api/v1/hierarchy/import-from-ets",
            json={"tree_name": f"K5 {mode}", "mode": mode, "replace_existing": True, "group_addresses": sorted(bindings)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        trees[mode] = resp.json()
    return instance, trees, {address: entry["datapoint_id"] for address, entry in bindings.items()}


async def test_k5_switch_and_status_address_give_two_paths_each_with_its_address(client, auth_headers):
    instance, trees, datapoints = await _switch_with_status(client, auth_headers, 23)
    try:
        for mode, expected in {
            "groups": [(["Beleuchtung", "Schalten", CEILING], "23/1/2"), (["Beleuchtung", "Status", CEILING], "23/2/2")],
            "mid": [(["Beleuchtung", "Schalten"], "23/1/2"), (["Beleuchtung", "Status"], "23/2/2")],
        }.items():
            tree_id = trees[mode]["tree_id"]
            [switch] = [
                item for item in await _tree_items(client, auth_headers, tree_id, set(datapoints.values())) if item["id"] == datapoints["23/1/2"]
            ]
            assert switch["group_address"] == "23/1/2", "the command address decides the main path"
            assert sorted(_paths(switch, tree_id)) == expected, mode
    finally:
        await _cleanup(client, auth_headers, {mode: {"tree_id": tree["tree_id"]} for mode, tree in trees.items()}, instance)


async def test_several_datapoints_on_one_address_are_all_linked_and_reported(client, auth_headers):
    first, second = await _instance(client, auth_headers), await _instance(client, auth_headers)
    content = knxproj_with_layout("ThreeLevel", lighting_layout(24))
    trees = await _import(client, auth_headers, content, first, "groups")
    await client.delete(f"/api/v1/hierarchy/trees/{trees['groups']['tree_id']}", headers=auth_headers)
    trees = await _import(client, auth_headers, content, second, "groups,mid")
    try:
        ids = {entry["datapoint_id"] for instance in (first, second) for entry in (await _bindings(client, auth_headers, instance)).values()}
        for mode in ("groups", "mid"):
            tree_id = trees[mode]["tree_id"]
            items = await _tree_items(client, auth_headers, tree_id, ids)
            assert len(items) == 12, f"{mode}: both datapoints of every address are linked"
            assert (trees[mode]["links_created"], trees[mode]["addresses_shared"], trees[mode]["datapoints_unplaced"]) == (12, 6, 0)
            assert "6 Gruppenadressen mit mehreren Datenpunkten (alle verknüpft)" in trees[mode]["message"], trees[mode]["message"]
    finally:
        await _cleanup(client, auth_headers, trees, first, second)


def _room_project() -> bytes:
    """R1–R3: generic address names in a meaningless main group; rooms and functions carry the meaning."""
    main = 25
    names = {1: "Schalten", 2: "Status", 3: "Schalten", 4: "Status", 5: "Schalten", 6: "Schalten"}
    layout = [
        GroupRangeSpec(
            "Neue Hauptgruppe",
            raw_address(main, 0, 0),
            raw_address(main, 7, 255),
            ranges=[
                GroupRangeSpec(
                    "Neue Mittelgruppe",
                    raw_address(main, 0, 0),
                    raw_address(main, 0, 255),
                    {raw_address(main, 0, sub): name for sub, name in names.items()},
                )
            ],
        )
    ]
    rooms = [
        RoomSpec(
            "Kueche",
            {"Licht Decke": [raw_address(main, 0, 1), raw_address(main, 0, 2)], "Licht Insel": [raw_address(main, 0, 3), raw_address(main, 0, 4)]},
        ),
        RoomSpec("Bad", {"Licht Decke": [raw_address(main, 0, 5)]}),
    ]
    return knxproj_with_layout("ThreeLevel", layout, rooms)


async def test_r1_r3_rooms_get_a_function_level_and_unplaced_datapoints_are_reported(client, auth_headers):
    instance = await _instance(client, auth_headers)
    trees = await _import(client, auth_headers, _room_project(), instance, "buildings,groups")
    try:
        bindings = await _bindings(client, auth_headers, instance)
        ids = {entry["datapoint_id"] for entry in bindings.values()}
        tree_id = trees["buildings"]["tree_id"]
        items = await _tree_items(client, auth_headers, tree_id, ids)
        assert [(item["name"], _paths(item, tree_id)) for item in items] == [
            ("Schalten", [(["Demo-Test-Projekt", "EG", "Kueche", "Licht Decke"], "25/0/1")]),
            ("Status", [(["Demo-Test-Projekt", "EG", "Kueche", "Licht Decke"], "25/0/2")]),
            ("Schalten", [(["Demo-Test-Projekt", "EG", "Kueche", "Licht Insel"], "25/0/3")]),
            ("Status", [(["Demo-Test-Projekt", "EG", "Kueche", "Licht Insel"], "25/0/4")]),
            ("Schalten", [(["Demo-Test-Projekt", "EG", "Bad", "Licht Decke"], "25/0/5")]),
        ], "R1/R2: Raum › Funktion tells the generic names apart; R3: 25/0/6 has no function"
        assert (trees["buildings"]["datapoints_unplaced"], trees["groups"]["datapoints_unplaced"]) == (1, 0)
        assert "1 Datenpunkte ohne Platz in diesem Baum" in trees["buildings"]["message"], trees["buildings"]["message"]
    finally:
        await _cleanup(client, auth_headers, trees, instance)


async def test_layouts_through_the_formatter(client, auth_headers):
    """Writes/compares the search responses the GUI formatter spec reads, one entry per family and tree."""
    house = raw_address(26, 0, 0)
    free = [GroupRangeSpec("Haus", house, house + 2047, ranges=[GroupRangeSpec("EG", house, house + 255, {house + 1: SPOTS, house + 2: CEILING})])]
    fixture: dict[str, list[dict]] = {}
    cleanups = []
    try:
        for family, content, modes in (
            ("K1", knxproj_with_layout("ThreeLevel", lighting_layout(28)), "groups,mid"),
            ("K2", knxproj_with_layout("TwoLevel", two_level_lighting_layout(27)), "groups,mid"),
            ("K3", knxproj_with_layout("Free", free), "groups,mid"),
            ("R1", _room_project(), "buildings,groups"),
        ):
            instance = await _instance(client, auth_headers)
            trees = await _import(client, auth_headers, content, instance, modes)
            cleanups.append((trees, instance))
            ids = {entry["datapoint_id"] for entry in (await _bindings(client, auth_headers, instance)).values()}
            for mode, tree in trees.items():
                fixture[f"{family} {mode}"] = _projection(await _tree_items(client, auth_headers, tree["tree_id"], ids), tree["tree_id"])
        instance, trees, datapoints = await _switch_with_status(client, auth_headers, 29)
        cleanups.append(({mode: {"tree_id": tree["tree_id"]} for mode, tree in trees.items()}, instance))
        for mode, tree in trees.items():
            fixture[f"K5 {mode}"] = _projection(await _tree_items(client, auth_headers, tree["tree_id"], set(datapoints.values())), tree["tree_id"])
    finally:
        for trees, instance in cleanups:
            await _cleanup(client, auth_headers, trees, instance)

    if os.environ.get("OBS_UPDATE_FIXTURES") == "1":
        staged = FIXTURE.with_suffix(".json.tmp")
        staged.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        staged.replace(FIXTURE)
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == fixture, "stale fixture: rerun with OBS_UPDATE_FIXTURES=1"
