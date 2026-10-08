"""ETS hierarchy import from the recorded group ranges, rooms and functions (#1266 P6), on a real database.

The integration tests in ``tests/integration/test_knxproj_hierarchy_layouts.py`` drive the
same code through the ``.knxproj`` import; these cover the edges an ETS export does not
produce on its own.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite
import pydantic
import pytest

from obs.api.v1.services.hierarchy_import import EtsImportRequest, create_ets_hierarchy
from obs.db.database import Database, _migration_v57_ets_range_layout

NOW = "2026-07-22T00:00:00+00:00"
HOUSE = {"name": "Haus", "start": 0, "end": 2047}
FLOOR = {"name": "EG", "start": 0, "end": 255}


@asynccontextmanager
async def _database(path: Path):
    db = Database(str(path))
    await db.connect()
    try:
        yield db
    finally:
        await db.disconnect()


async def _group_address(db: Database, address: str, name: str, ranges: list[dict] | None) -> None:
    await db.execute_and_commit(
        """INSERT INTO knx_group_addresses (address, name, description, dpt, main_group_name, mid_group_name, group_ranges, imported_at)
           VALUES (?, ?, '', 'DPT1.001', 'Main', 'Middle', ?, ?)""",
        (address, name, None if ranges is None else json.dumps(ranges), NOW),
    )


async def _datapoint(db: Database, datapoint_id: str, config: dict | str) -> None:
    await db.execute_and_commit(
        "INSERT INTO datapoints (id, name, data_type, unit, tags, mqtt_topic, created_at, updated_at) VALUES (?, ?, 'BOOL', NULL, '[]', ?, ?, ?)",
        (datapoint_id, datapoint_id, f"obs/test/{datapoint_id}", NOW, NOW),
    )
    await db.execute_and_commit(
        "INSERT INTO adapter_bindings (id, datapoint_id, adapter_type, direction, config, enabled, created_at, updated_at) VALUES (?, ?, 'KNX', 'BOTH', ?, 1, ?, ?)",
        (f"b-{datapoint_id}", datapoint_id, config if isinstance(config, str) else json.dumps(config), NOW, NOW),
    )


async def _paths(db: Database, tree_id: str) -> list[tuple[str, list[str], str | None]]:
    """(datapoint, root → linked node, link address) for every link of the tree."""
    nodes = {row["id"]: row for row in await db.fetchall("SELECT id, parent_id, name FROM hierarchy_nodes WHERE tree_id=?", (tree_id,))}

    def path(node_id: str) -> list[str]:
        names = []
        while node_id is not None:
            names.insert(0, nodes[node_id]["name"])
            node_id = nodes[node_id]["parent_id"]
        return names

    links = await db.fetchall(
        "SELECT datapoint_id, node_id, group_address FROM hierarchy_datapoint_links WHERE node_id IN (SELECT id FROM hierarchy_nodes WHERE tree_id=?)",
        (tree_id,),
    )
    return sorted((row["datapoint_id"], path(row["node_id"]), row["group_address"]) for row in links)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("groups", [("dp-deep", ["Haus", "EG", "Spots"], "0/0/1"), ("dp-outside", ["Draussen"], "0/0/9"), ("dp-top", ["Haus", "Decke"], "0/1/0")]),
        ("mid", [("dp-deep", ["Haus", "EG"], "0/0/1"), ("dp-outside", ["Draussen"], "0/0/9"), ("dp-top", ["Haus"], "0/1/0")]),
        ("flat", [("dp-deep", ["Haus", "Spots"], "0/0/1"), ("dp-outside", ["Draussen"], "0/0/9"), ("dp-top", ["Haus", "Decke"], "0/1/0")]),
    ],
)
async def test_group_modes_follow_the_recorded_ranges(tmp_path, mode, expected):
    async with _database(tmp_path / "ranges.db") as db:
        await _group_address(db, "0/0/1", "Spots", [HOUSE, FLOOR])
        await _group_address(db, "0/1/0", "Decke", [HOUSE])
        await _group_address(db, "0/0/9", "Draussen", [])  # outside every range
        await _datapoint(db, "dp-deep", {"group_address": "0/0/1"})
        await _datapoint(db, "dp-top", {"group_address": "0/1/0"})
        await _datapoint(db, "dp-outside", {"group_address": "0/0/9"})

        result = await create_ets_hierarchy(db, EtsImportRequest(tree_name=mode, mode=mode))

        assert await _paths(db, result.tree_id) == expected
        assert result.datapoints_unplaced == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(("style", "label"), [("TwoLevel", "0/256 – 0/511"), (None, "0/1/0 – 0/1/255")])
async def test_an_unnamed_range_is_labelled_with_its_bounds_in_the_project_style(tmp_path, style, label):
    async with _database(tmp_path / "unnamed.db") as db:
        if style:
            await db.execute_and_commit("UPDATE knx_project SET group_address_style = ? WHERE id = 1", (style,))
        else:
            await db.execute_and_commit("DELETE FROM knx_project")  # no project imported yet: default style
        await _group_address(db, "0/1/1", "Spots", [{"name": " ", "start": 256, "end": 511}])
        await _datapoint(db, "dp", {"group_address": "0/1/1"})

        result = await create_ets_hierarchy(db, EtsImportRequest(tree_name="mid", mode="mid"))

        assert await _paths(db, result.tree_id) == [("dp", [label], "0/1/1")]


@pytest.mark.asyncio
async def test_rows_imported_before_the_ranges_keep_main_and_middle_group(tmp_path):
    async with _database(tmp_path / "legacy.db") as db:
        await _group_address(db, "1/2/3", "Spots", None)
        await _datapoint(db, "dp", {"group_address": "1/2/3"})

        result = await create_ets_hierarchy(db, EtsImportRequest(tree_name="groups", mode="groups"))

        assert await _paths(db, result.tree_id) == [("dp", ["Main", "Middle", "Spots"], "1/2/3")]


@pytest.mark.asyncio
async def test_a_switch_and_its_status_address_in_one_range_link_once_through_the_switch(tmp_path):
    async with _database(tmp_path / "status.db") as db:
        await _group_address(db, "0/0/1", "Spots", [HOUSE, FLOOR])
        await _group_address(db, "0/0/2", "Spots Status", [HOUSE, FLOOR])
        await _datapoint(db, "dp", {"group_address": "0/0/2", "state_group_address": "0/0/1"})
        await _datapoint(db, "dp-status", {"group_address": "0/0/1"})

        mid = await create_ets_hierarchy(db, EtsImportRequest(tree_name="mid", mode="mid"))
        groups = await create_ets_hierarchy(db, EtsImportRequest(tree_name="groups", mode="groups"))

        assert await _paths(db, mid.tree_id) == [("dp", ["Haus", "EG"], "0/0/2"), ("dp-status", ["Haus", "EG"], "0/0/1")]
        assert await _paths(db, groups.tree_id) == [
            ("dp", ["Haus", "EG", "Spots"], "0/0/1"),
            ("dp", ["Haus", "EG", "Spots Status"], "0/0/2"),
            ("dp-status", ["Haus", "EG", "Spots"], "0/0/1"),
        ]
        assert (groups.addresses_shared, mid.addresses_shared) == (1, 1)


@pytest.mark.asyncio
async def test_broken_binding_configs_are_skipped(tmp_path):
    async with _database(tmp_path / "broken.db") as db:
        await _group_address(db, "0/0/1", "Spots", [HOUSE])
        await _datapoint(db, "dp-list", "[1, 2]")
        await _datapoint(db, "dp-invalid", {"group_address": "99/9/999", "state_group_address": "0/0/1"})

        result = await create_ets_hierarchy(db, EtsImportRequest(tree_name="groups", mode="groups"))

        assert await _paths(db, result.tree_id) == [("dp-invalid", ["Haus", "Spots"], "0/0/1")]


def test_a_backup_link_address_is_normalized_or_rejected():
    from obs.api.v1.config import ExportedHierarchyDpLink

    def link(address):
        return ExportedHierarchyDpLink(id="l", node_id="n", datapoint_id="d", group_address=address)

    assert (link(None).group_address, link("1/234").group_address) == (None, "1/0/234")
    with pytest.raises(pydantic.ValidationError):
        link("Licht")


def test_scope_addresses_are_normalized_at_the_entrance():
    assert EtsImportRequest(tree_name="t", mode="groups", group_addresses=["1/234", " 2282 "]).group_addresses == ["1/0/234", "1/0/234"]
    with pytest.raises(pydantic.ValidationError):
        EtsImportRequest(tree_name="t", mode="groups", group_addresses=["Licht"])


async def _rooms(db: Database) -> None:
    for row in (("b", None, "Haus", "Building", 1), ("k", "b", "Kueche", "Room", 2), ("bad", "b", "Bad", "Room", 3)):
        await db.execute_and_commit(
            "INSERT INTO knx_locations (id, parent_id, name, space_type, sort_order, imported_at) VALUES (?,?,?,?,?,?)", (*row, NOW)
        )
    functions = (
        ("f-decke", "k", "Licht Decke", ["0/0/1", "0/0/2"]),
        ("f-insel", "k", "Licht Insel", ["0/0/3"]),
        ("f-bad", "bad", "Licht Decke", ["0/0/4"]),
        ("f-lost", "nowhere", "Verwaist", ["0/0/3"]),
    )
    for function_id, space_id, name, addresses in functions:
        await db.execute_and_commit(
            "INSERT INTO knx_functions (id, space_id, name, usage_text, imported_at) VALUES (?,?,?,'Licht',?)", (function_id, space_id, name, NOW)
        )
        for address in addresses:
            await db.execute_and_commit("INSERT INTO knx_function_ga_links (function_id, ga_address) VALUES (?,?)", (function_id, address))
    for sub in range(1, 6):
        await _group_address(db, f"0/0/{sub}", "Schalten", [HOUSE])


@pytest.mark.asyncio
async def test_buildings_get_a_function_level_and_count_what_has_no_place(tmp_path):
    async with _database(tmp_path / "rooms.db") as db:
        await _rooms(db)
        await _datapoint(db, "dp-1", {"group_address": "0/0/1", "state_group_address": "0/0/2"})
        await _datapoint(db, "dp-3", {"group_address": "0/0/3"})
        await _datapoint(db, "dp-4", {"group_address": "9/0/0", "state_group_address": "0/0/4"})
        await _datapoint(db, "dp-5", {"group_address": "0/0/5"})  # address without a function

        result = await create_ets_hierarchy(db, EtsImportRequest(tree_name="b", mode="buildings"))
        scoped = await create_ets_hierarchy(db, EtsImportRequest(tree_name="s", mode="buildings", group_addresses=["0/0/1"]))

        assert await _paths(db, result.tree_id) == [
            ("dp-1", ["Haus", "Kueche", "Licht Decke"], "0/0/1"),
            ("dp-3", ["Haus", "Kueche", "Licht Insel"], "0/0/3"),
            ("dp-4", ["Haus", "Bad", "Licht Decke"], "0/0/4"),
        ]
        assert (result.links_created, result.datapoints_unplaced) == (3, 1)
        assert result.message.endswith("3 DataPoints automatisch verknüpft, 1 Datenpunkte ohne Platz in diesem Baum")
        assert await _paths(db, scoped.tree_id) == [("dp-1", ["Haus", "Kueche", "Licht Decke"], "0/0/1")]
        assert scoped.datapoints_unplaced == 0


@pytest.mark.asyncio
async def test_trades_link_through_status_addresses_within_the_scope(tmp_path):
    async with _database(tmp_path / "trades.db") as db:
        await _rooms(db)
        await db.execute_and_commit("INSERT INTO knx_trades (id, name, sort_order, imported_at) VALUES ('t', 'Licht', 1, ?)", (NOW,))
        await db.execute_and_commit("UPDATE knx_functions SET trade_id = 't' WHERE id IN ('f-decke', 'f-insel')")
        await _datapoint(db, "dp-1", {"group_address": "9/0/0", "state_group_address": "0/0/2"})
        await _datapoint(db, "dp-3", {"group_address": "0/0/3"})

        result = await create_ets_hierarchy(db, EtsImportRequest(tree_name="t", mode="trades", group_addresses=["0/0/2"]))

        assert await _paths(db, result.tree_id) == [("dp-1", ["Licht", "Licht Decke"], "0/0/2")]
        assert result.datapoints_unplaced == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["1/234", " 1/0/234", "Licht"])
async def test_database_rejects_a_link_address_in_another_notation(tmp_path, value):
    async with _database(tmp_path / "trigger.db") as db:
        await _group_address(db, "0/0/1", "Spots", [HOUSE])
        await _datapoint(db, "dp", {"group_address": "0/0/1"})
        result = await create_ets_hierarchy(db, EtsImportRequest(tree_name="g", mode="groups"))
        link = await db.fetchone("SELECT id, node_id FROM hierarchy_datapoint_links")
        with pytest.raises(sqlite3.IntegrityError, match="interner Schreibweise"):
            await db.execute_and_commit("UPDATE hierarchy_datapoint_links SET group_address = ? WHERE id = ?", (value, link["id"]))
        with pytest.raises(sqlite3.IntegrityError, match="interner Schreibweise"):
            await db.execute_and_commit(
                "INSERT INTO hierarchy_datapoint_links (id, node_id, datapoint_id, group_address, created_at) VALUES ('x', ?, 'dp', ?, ?)",
                (link["node_id"], value, NOW),
            )
        await db.execute_and_commit("UPDATE hierarchy_datapoint_links SET group_address = NULL WHERE id = ?", (link["id"],))
        assert result.links_created == 1


@pytest.mark.asyncio
async def test_migration_v57_is_idempotent_and_skips_missing_tables(tmp_path):
    async with aiosqlite.connect(tmp_path / "partial.db") as conn:
        conn.row_factory = aiosqlite.Row
        await _migration_v57_ets_range_layout(conn)
        async with conn.execute("SELECT name FROM sqlite_master") as cur:
            assert await cur.fetchall() == []
    async with _database(tmp_path / "full.db") as db:
        await _migration_v57_ets_range_layout(db.conn)
        assert "group_address" in {row["name"] for row in await db.fetchall("PRAGMA table_info(hierarchy_datapoint_links)")}
