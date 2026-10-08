"""Generate the hierarchy fixture of an installation from before #1266 P6 (upgrade test K6).

Must run against the code of e77294c4 (the last state before the ETS hierarchy was
built from the group ranges), with this checkout's ``tests`` package for the projects::

    git archive e77294c4 obs | tar -x -C /tmp/obs-e77294c4
    PYTHONPATH=/tmp/obs-e77294c4:. tools/with-venv python tools/hierarchy_legacy_fixture.py

For a three-level and a two-level lighting layout it imports the project with a KNX
adapter instance and the "groups" and "mid" hierarchies into a fresh database,
records what the hierarchy read endpoints return ("before") and dumps every row of
the tables involved to ``tests/fixtures/hierarchy_legacy_<style>.json``.
"""

from __future__ import annotations

import asyncio
import io
import json
import pathlib
import tempfile
import uuid

from fastapi import UploadFile

from tests.knxproj_style_variants import knxproj_with_layout, lighting_layout, two_level_lighting_layout

OUT = pathlib.Path(__file__).parent.parent / "tests" / "fixtures"
LAYOUTS = {"ThreeLevel": lighting_layout(20), "TwoLevel": two_level_lighting_layout(21)}
TABLES = (
    "knx_group_addresses",
    "knx_project",
    "adapter_instances",
    "datapoints",
    "adapter_bindings",
    "hierarchy_trees",
    "hierarchy_nodes",
    "hierarchy_datapoint_links",
)


async def observe(db) -> dict:
    """What the hierarchy read endpoints return, independent of ids: trees and each datapoint's paths."""
    from obs.api.v1 import hierarchy as api

    def names(nodes) -> list:
        return [[node.name, names(node.children)] for node in nodes]

    trees = {tree.name: names(await api.get_tree_nodes(tree_id=tree.id, _user="admin", db=db)) for tree in await api.list_trees(_user="admin", db=db)}
    bindings = await db.fetchall("SELECT datapoint_id, json_extract(config, '$.group_address') AS address FROM adapter_bindings ORDER BY address")
    paths = {
        row["address"]: sorted(
            [ref.tree_name, *(seg.node_name for seg in ref.node_path), ref.node_name]
            for ref in await api.get_datapoint_nodes(dp_id=row["datapoint_id"], _user="admin", db=db)
        )
        for row in bindings
    }
    return {"trees": trees, "paths": paths}


async def _generate(style: str) -> dict:
    from obs.api.v1 import knxproj as api
    from obs.db.database import Database
    from obs.knxproj import parser

    assert not hasattr(parser, "_extract_group_ranges"), "run against e77294c4, not against #1266 P6"
    with tempfile.TemporaryDirectory() as tmp:
        db = Database(str(pathlib.Path(tmp) / "legacy.db"))
        await db.connect()
        now = "2026-01-01T00:00:00+00:00"
        await db.execute_and_commit(
            "INSERT INTO adapter_instances (id, adapter_type, name, config, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), "KNX", "KNX-Bestand", "{}", 0, now, now),
        )
        await api.import_knxproj_file(
            file=UploadFile(file=io.BytesIO(knxproj_with_layout(style, LAYOUTS[style])), filename=f"{style}.knxproj"),
            request=None,
            password=None,
            adapter_name="KNX-Bestand",
            direction="SOURCE",
            hierarchy_modes=["groups,mid"],
            hierarchy_auto_link=True,
            hierarchy_replace_existing=True,
            _user="admin",
            db=db,
        )
        rows = {table: [dict(row) for row in await db.fetchall(f"SELECT * FROM {table} ORDER BY rowid")] for table in TABLES}
        before = await observe(db)
        await db.disconnect()
    return {"generated_with": "e77294c4", "style": style, "before": before, "rows": rows}


def main() -> None:
    for style in LAYOUTS:
        data = asyncio.run(_generate(style))
        path = OUT / f"hierarchy_legacy_{style.lower()}.json"
        path.write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        print(path, {table: len(rows) for table, rows in data["rows"].items()})


if __name__ == "__main__":
    main()
