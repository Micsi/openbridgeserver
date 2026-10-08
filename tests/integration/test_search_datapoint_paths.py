"""Seam S3 (#1266): .knxproj import → GET /api/v1/search → picker path formatter.

The demo project is imported with three extra group addresses of one name: two
in one middle range (``Schalten``) and one in another (``Status Rueckmeldung``),
plus the ETS "groups" hierarchy. The extra addresses are not part of the demo, and
the plain demo is imported into a second KNX instance first, so the test passes
on an empty and on a populated database alike (datapoints of other instances on
the demo's addresses are linked too, #1266 P6, but are not named like these). The search response
for that name is the input of the GUI's path formatter: this test checks the
real response and keeps ``gui/tests/fixtures/search-same-name.json`` equal to
it (ids replaced by stable placeholders, fields the formatter does not read
left out), which ``gui/tests/utils/hierarchyDatapointPathsApi.spec.js`` feeds
through ``datapointPathRows``.

``OBS_UPDATE_FIXTURES=1`` rewrites the fixture instead of comparing.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

from tests.knxproj_style_variants import DEMO_KNXPROJ, knxproj_with_extra_group_addresses

pytestmark = pytest.mark.integration

NAME = "Spots P8"
EXTRA = {2400: NAME, 2401: NAME, 3200: NAME}  # 1/1/96 and 1/1/97 (Schalten), 1/4/128 (Status Rueckmeldung)
FIXTURE = Path(__file__).parent.parent.parent / "gui" / "tests" / "fixtures" / "search-same-name.json"


async def _knx_instance(client, auth_headers) -> dict:
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={"adapter_type": "KNX", "name": f"KnxPaths-{uuid.uuid4().hex[:8]}", "config": {}, "enabled": False},
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


@pytest.fixture
async def imported(client, auth_headers):
    neighbour = await _knx_instance(client, auth_headers)
    await _import(client, auth_headers, DEMO_KNXPROJ.read_bytes(), adapter_name=neighbour["name"])
    instance = await _knx_instance(client, auth_headers)
    body = await _import(client, auth_headers, knxproj_with_extra_group_addresses(EXTRA), adapter_name=instance["name"], hierarchy_modes="groups")
    [tree] = [h for h in body["hierarchies"] if h["mode"] == "groups"]
    assert tree["status"] == "created", tree
    yield tree["tree_id"]
    await client.delete(f"/api/v1/hierarchy/trees/{tree['tree_id']}", headers=auth_headers)
    for inst in (instance, neighbour):
        resp = await client.delete(f"/api/v1/adapters/instances/{inst['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text


def _projection(items: list[dict], tree_id: str) -> list[dict]:
    """What the formatter reads, with ids replaced in order of appearance."""
    ids: dict[str, str] = {tree_id: "tree-groups"}

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


async def test_search_delivers_paths_and_command_addresses_of_same_named_datapoints(client, auth_headers, imported):
    resp = await client.get("/api/v1/search/", params={"q": NAME, "size": 500}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    # Datapoints of earlier runs lost their binding with their instance.
    items = sorted((item for item in resp.json()["items"] if item["name"] == NAME and item["group_address"]), key=lambda item: item["group_address"])

    assert [item["group_address"] for item in items] == ["1/1/96", "1/1/97", "1/4/128"]
    paths = [
        [*(seg["node_name"] for seg in ref["node_path"]), ref["node_name"]]
        for item in items
        for ref in item["hierarchy_nodes"]
        if ref["tree_id"] == imported
    ]
    assert paths == [
        ["Demo 01 - Binaersignale", "Schalten", NAME],
        ["Demo 01 - Binaersignale", "Schalten", NAME],
        ["Demo 01 - Binaersignale", "Status Rueckmeldung", NAME],
    ]

    projection = _projection(items, imported)
    if os.environ.get("OBS_UPDATE_FIXTURES") == "1":
        staged = FIXTURE.with_suffix(".json.tmp")
        staged.write_text(json.dumps(projection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        staged.replace(FIXTURE)
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == projection, "stale fixture: rerun with OBS_UPDATE_FIXTURES=1"
