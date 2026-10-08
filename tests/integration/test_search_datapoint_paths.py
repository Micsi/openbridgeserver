"""Seam S3 (#1266): .knxproj import → GET /api/v1/search → picker path formatter.

The demo project is imported with two group addresses of one middle range named
alike (``Schalten``) and a third one of that name in another middle range
(``Status Rueckmeldung``), plus the ETS "groups" hierarchy. The search response
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

from tests.knxproj_style_variants import knxproj_with_group_address_names

pytestmark = pytest.mark.integration

NAME = "Spots P8"
RENAMED = {2305: NAME, 2306: NAME, 3073: NAME}  # 1/1/1 and 1/1/2 (Schalten), 1/4/1 (Status Rueckmeldung)
FIXTURE = Path(__file__).parent.parent.parent / "gui" / "tests" / "fixtures" / "search-same-name.json"


@pytest.fixture
async def imported(client, auth_headers):
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={"adapter_type": "KNX", "name": f"KnxPaths-{uuid.uuid4().hex[:8]}", "config": {}, "enabled": False},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    instance = resp.json()
    resp = await client.post(
        "/api/v1/knxproj/import",
        files={"file": ("demo-same-name.knxproj", knxproj_with_group_address_names(RENAMED), "application/octet-stream")},
        params={"adapter_name": instance["name"], "hierarchy_modes": "groups"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    [tree] = [h for h in resp.json()["hierarchies"] if h["mode"] == "groups"]
    assert tree["status"] == "created", tree
    yield tree["tree_id"]
    await client.delete(f"/api/v1/hierarchy/trees/{tree['tree_id']}", headers=auth_headers)
    resp = await client.delete(f"/api/v1/adapters/instances/{instance['id']}", headers=auth_headers)
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
    items = sorted((item for item in resp.json()["items"] if item["name"] == NAME), key=lambda item: item["group_address"])

    assert [item["group_address"] for item in items] == ["1/1/1", "1/1/2", "1/4/1"]
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
