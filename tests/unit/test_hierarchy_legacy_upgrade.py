"""K6 (#1266 P6): ETS trees of an installation from before P6 stay valid, and a reimport replaces them cleanly.

The fixtures ``tests/fixtures/hierarchy_legacy_<style>.json`` were produced with the code
of e77294c4 (``tools/hierarchy_legacy_fixture.py``): a three-level and a two-level
lighting layout imported with a KNX instance and the "groups" and "mid" hierarchies,
every row of the tables involved, and what the hierarchy read endpoints returned then
("before"). Each test loads the rows into a database at schema V56, starts it with the
current code (which runs V57, as an upgrade does) and reads through the endpoints.
"""

from __future__ import annotations

import io
import json
import pathlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from fastapi import UploadFile

from obs.api.v1 import hierarchy as hierarchy_api
from obs.api.v1 import knxproj as knxproj_api
from obs.api.v1.services.hierarchy_import import EtsImportRequest, create_ets_hierarchy
from obs.db import database
from obs.db.database import Database
from tests.knxproj_style_variants import knxproj_with_layout
from tools.hierarchy_legacy_fixture import LAYOUTS, TABLES, observe

FIXTURES = pathlib.Path(__file__).parent.parent / "fixtures"
LAST_PRE_P6_VERSION = 56


def _fixture(style: str) -> dict:
    return json.loads((FIXTURES / f"hierarchy_legacy_{style.lower()}.json").read_text(encoding="utf-8"))


@asynccontextmanager
async def _upgraded(monkeypatch, tmp_path, data: dict) -> AsyncIterator[Database]:
    path = str(tmp_path / "legacy.db")
    monkeypatch.setattr(database, "MIGRATIONS", [m for m in database.MIGRATIONS if m[0] <= LAST_PRE_P6_VERSION])
    legacy = Database(path)
    try:
        await legacy.connect()
        for table in TABLES:
            for row in data["rows"][table]:
                await legacy.execute(f"INSERT OR REPLACE INTO {table} ({','.join(row)}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
        await legacy.commit()
    finally:
        await legacy.disconnect()
        monkeypatch.undo()
    db = Database(path)
    try:
        await db.connect()
        yield db
    finally:
        await db.disconnect()


@pytest.mark.parametrize("style", LAYOUTS)
async def test_stored_trees_read_as_before_the_upgrade(style, monkeypatch, tmp_path):
    data = _fixture(style)
    async with _upgraded(monkeypatch, tmp_path, data) as db:
        assert await observe(db) == data["before"]


@pytest.mark.parametrize("style", LAYOUTS)
async def test_rebuilding_a_tree_without_reimport_keeps_the_stored_layout(style, monkeypatch, tmp_path):
    """No ranges recorded before P6: the rebuild falls back to the stored main/middle names until the next import."""
    data = _fixture(style)
    async with _upgraded(monkeypatch, tmp_path, data) as db:
        await create_ets_hierarchy(db, EtsImportRequest(tree_name="ETS Gruppenadressen", mode="groups", replace_existing=True))
        assert await observe(db) == data["before"]


@pytest.mark.parametrize(
    ("style", "expected"),
    [
        (
            "ThreeLevel",
            {
                "20/1/1": [
                    ["ETS Gruppenadressen", "Beleuchtung", "Schalten", "01 Esszimmer - Spots"],
                    ["ETS Haupt- und Mittelgruppen", "Beleuchtung", "Schalten"],
                ],
                "20/1/2": [
                    ["ETS Gruppenadressen", "Beleuchtung", "Schalten", "02 Kueche - Decke"],
                    ["ETS Haupt- und Mittelgruppen", "Beleuchtung", "Schalten"],
                ],
                "20/1/3": [
                    ["ETS Gruppenadressen", "Beleuchtung", "Schalten", "01 Esszimmer - Spots"],
                    ["ETS Haupt- und Mittelgruppen", "Beleuchtung", "Schalten"],
                ],
                "20/2/1": [
                    ["ETS Gruppenadressen", "Beleuchtung", "Status", "01 Esszimmer - Spots"],
                    ["ETS Haupt- und Mittelgruppen", "Beleuchtung", "Status"],
                ],
                "20/2/2": [
                    ["ETS Gruppenadressen", "Beleuchtung", "Status", "02 Kueche - Decke"],
                    ["ETS Haupt- und Mittelgruppen", "Beleuchtung", "Status"],
                ],
                "20/3/1": [
                    ["ETS Gruppenadressen", "Beleuchtung", "Dimmen", "01 Esszimmer - Spots"],
                    ["ETS Haupt- und Mittelgruppen", "Beleuchtung", "Dimmen"],
                ],
            },
        ),
        (
            "TwoLevel",
            {
                "21/0/1": [["ETS Gruppenadressen", "Beleuchtung", "01 Esszimmer - Spots"], ["ETS Haupt- und Mittelgruppen", "Beleuchtung"]],
                "21/1/44": [["ETS Gruppenadressen", "Beleuchtung", "02 Kueche - Decke"], ["ETS Haupt- und Mittelgruppen", "Beleuchtung"]],
            },
        ),
    ],
)
async def test_reimport_replaces_the_trees_with_the_ets_layout(style, expected, monkeypatch, tmp_path):
    data = _fixture(style)
    async with _upgraded(monkeypatch, tmp_path, data) as db:
        result = await knxproj_api.import_knxproj_file(
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

        after = await observe(db)
        trees = await hierarchy_api.list_trees(_user="admin", db=db)
        assert [(h.status, h.trees_replaced) for h in result.hierarchies] == [("created", 1), ("created", 1)]
        assert sorted(tree.name for tree in trees) == sorted(data["before"]["trees"]), "one tree per mode, no duplicate"
        assert after["paths"] == expected, "every datapoint once per tree, no link left on a replaced tree"
        assert result.created == 0, "datapoints and bindings are updated, not duplicated"
