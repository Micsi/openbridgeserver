"""Search API: command group address per datapoint (#1266).

The datapoint picker tells same-named rows apart by their group address, so
``GET /api/v1/search`` delivers, per datapoint, the command group address of
its KNX binding in the internal notation (``group_address``). Rule for several
KNX bindings: a writing binding (``DEST``/``BOTH``) before a reading one
(``SOURCE``), then the oldest (``created_at``, then ``id``); a binding whose
stored address is no group address is skipped. Non-admins only get addresses
of bindings on adapter instances they may read, like
``GET /api/v1/datapoints/{id}/bindings``.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest

import obs.api.v1.datapoints as datapoints_api
import obs.api.v1.search as search_api
from obs.api.auth import Principal
from obs.db.database import Database
from obs.models.datapoint import DataPoint

NOW = "2026-06-10T00:00:00+00:00"
ADMIN = Principal(subject="admin", type="user", is_admin=True)
ALICE = Principal(subject="alice", type="user", is_admin=False)


class _RegistryStub:
    def __init__(self, datapoints: list[DataPoint]) -> None:
        self._datapoints = datapoints

    def all(self) -> list[DataPoint]:
        return list(self._datapoints)

    def get_value(self, dp_id):
        return None


@pytest.fixture
async def db() -> Database:
    database = Database(":memory:")
    await database.connect()
    try:
        yield database
    finally:
        await database.disconnect()


async def _datapoint(db: Database, name: str) -> DataPoint:
    dp = DataPoint(name=name, data_type="BOOLEAN", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
    await db.execute_and_commit(
        """INSERT INTO datapoints
               (id, name, data_type, unit, tags, mqtt_topic, mqtt_alias, persist_value, record_history, created_at, updated_at)
           VALUES (?, ?, ?, NULL, '[]', ?, NULL, 0, 0, ?, ?)""",
        (str(dp.id), dp.name, dp.data_type, dp.mqtt_topic, NOW, NOW),
    )
    return dp


async def _instance(db: Database, adapter_type: str = "KNX") -> str:
    instance_id = str(uuid.uuid4())
    await db.execute_and_commit(
        """INSERT INTO adapter_instances (id, adapter_type, name, config, enabled, created_at, updated_at)
           VALUES (?, ?, ?, '{}', 0, ?, ?)""",
        (instance_id, adapter_type, f"inst-{instance_id[:8]}", NOW, NOW),
    )
    return instance_id


async def _binding(
    db: Database,
    dp: DataPoint,
    instance_id: str | None,
    *,
    config: dict,
    direction: str = "SOURCE",
    adapter_type: str = "KNX",
    created_at: str = NOW,
    binding_id: str | None = None,
) -> None:
    await db.execute_and_commit(
        """INSERT INTO adapter_bindings
               (id, datapoint_id, adapter_type, adapter_instance_id, direction, config, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)""",
        (
            binding_id or str(uuid.uuid4()),
            str(dp.id),
            adapter_type,
            instance_id,
            direction,
            json.dumps(config),
            created_at,
            created_at,
        ),
    )


async def _grant(db: Database, node_type: str, node_id: str) -> None:
    await db.execute_and_commit(
        """INSERT INTO authz_node_roles (principal_type, principal_id, node_type, node_id, role, effect)
           VALUES ('user', 'alice', ?, ?, 'guest', 'allow')""",
        (node_type, node_id),
    )


async def _search(db: Database, monkeypatch, datapoints: list[DataPoint], principal: Principal = ADMIN) -> dict:
    registry = _RegistryStub(datapoints)
    monkeypatch.setattr(search_api, "get_registry", lambda: registry)
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)
    page = await search_api.search(
        q="",
        tag="",
        type="",
        adapter="",
        quality="",
        node_id="",
        tree_id="",
        sort="name",
        order="asc",
        page=0,
        size=50,
        _user=principal,
        db=db,
    )
    return {item.name: item.group_address for item in page.items}


@pytest.mark.asyncio
async def test_a_datapoint_without_knx_binding_has_no_group_address(db: Database, monkeypatch):
    dp = await _datapoint(db, "No binding")
    mqtt = await _datapoint(db, "MQTT only")
    await _binding(db, mqtt, await _instance(db, "MQTT"), config={"group_address": "1/1/1"}, adapter_type="MQTT")

    assert await _search(db, monkeypatch, [dp, mqtt]) == {"No binding": None, "MQTT only": None}


@pytest.mark.asyncio
async def test_the_knx_binding_delivers_its_address_in_internal_notation(db: Database, monkeypatch):
    knx = await _instance(db)
    stored_internal = await _datapoint(db, "Internal")
    legacy_two_level = await _datapoint(db, "Legacy")
    lower_case_type = await _datapoint(db, "Lower")
    await _binding(db, stored_internal, knx, config={"group_address": "1/0/7"})
    await _binding(db, legacy_two_level, knx, config={"group_address": " 1/257 "})
    await _binding(db, lower_case_type, knx, config={"group_address": "2/0/1"}, adapter_type="knx")

    assert await _search(db, monkeypatch, [stored_internal, legacy_two_level, lower_case_type]) == {
        "Internal": "1/0/7",
        "Legacy": "1/1/1",
        "Lower": "2/0/1",
    }


@pytest.mark.asyncio
async def test_a_writing_binding_wins_over_an_older_reading_one(db: Database, monkeypatch):
    knx = await _instance(db)
    dp = await _datapoint(db, "Spots")
    await _binding(db, dp, knx, config={"group_address": "1/4/1"}, direction="SOURCE", created_at="2026-01-01T00:00:00+00:00")
    await _binding(db, dp, knx, config={"group_address": "1/0/1"}, direction="DEST", created_at="2026-02-01T00:00:00+00:00")

    assert await _search(db, monkeypatch, [dp]) == {"Spots": "1/0/1"}


@pytest.mark.asyncio
async def test_among_writing_bindings_the_oldest_wins_then_the_lower_id(db: Database, monkeypatch):
    knx = await _instance(db)
    by_age = await _datapoint(db, "By age")
    await _binding(db, by_age, knx, config={"group_address": "1/0/2"}, direction="DEST", created_at="2026-02-01T00:00:00+00:00")
    await _binding(db, by_age, knx, config={"group_address": "1/0/1"}, direction="BOTH", created_at="2026-01-01T00:00:00+00:00")
    by_id = await _datapoint(db, "By id")
    await _binding(db, by_id, knx, config={"group_address": "2/0/2"}, direction="BOTH", binding_id="b-2")
    await _binding(db, by_id, knx, config={"group_address": "2/0/1"}, direction="BOTH", binding_id="b-1")

    assert await _search(db, monkeypatch, [by_age, by_id]) == {"By age": "1/0/1", "By id": "2/0/1"}


@pytest.mark.asyncio
async def test_a_binding_without_valid_address_is_skipped(db: Database, monkeypatch):
    knx = await _instance(db)
    dp = await _datapoint(db, "Fallback")
    await _binding(db, dp, knx, config={"group_address": "not-a-ga"}, direction="DEST", created_at="2026-01-01T00:00:00+00:00")
    await _binding(db, dp, knx, config={"group_address": 2305}, direction="DEST", created_at="2026-01-02T00:00:00+00:00")
    await _binding(db, dp, knx, config={}, direction="DEST", created_at="2026-01-03T00:00:00+00:00")
    await _binding(db, dp, knx, config={"group_address": "3/0/1"}, direction="SOURCE")
    none_valid = await _datapoint(db, "None valid")
    await _binding(db, none_valid, knx, config={"group_address": "99/99/99"})

    assert await _search(db, monkeypatch, [dp, none_valid]) == {"Fallback": "3/0/1", "None valid": None}


@pytest.mark.asyncio
async def test_non_admins_get_only_addresses_of_readable_adapter_instances(db: Database, monkeypatch):
    readable = await _instance(db)
    hidden = await _instance(db)
    await _grant(db, "adapter_instance", readable)
    granted = await _datapoint(db, "Readable")
    ungranted = await _datapoint(db, "Hidden")
    falls_back = await _datapoint(db, "Falls back")
    no_instance = await _datapoint(db, "No instance")
    for dp in (granted, ungranted, falls_back, no_instance):
        await _grant(db, "datapoint", str(dp.id))
    await _binding(db, granted, readable, config={"group_address": "1/0/1"})
    await _binding(db, ungranted, hidden, config={"group_address": "1/0/2"})
    await _binding(db, falls_back, hidden, config={"group_address": "1/0/3"}, direction="DEST")
    await _binding(db, falls_back, readable, config={"group_address": "1/4/3"})
    await _binding(db, no_instance, None, config={"group_address": "1/0/4"})
    datapoints = [granted, ungranted, falls_back, no_instance]

    assert await _search(db, monkeypatch, datapoints, ALICE) == {
        "Readable": "1/0/1",
        "Hidden": None,
        "Falls back": "1/4/3",
        "No instance": "1/0/4",
    }
    assert (await _search(db, monkeypatch, datapoints, ADMIN))["Hidden"] == "1/0/2"


def test_the_response_field_only_holds_internal_addresses():
    out = datapoints_api.DataPointOut(
        id=uuid.uuid4(),
        name="x",
        data_type="BOOLEAN",
        unit=None,
        tags=[],
        mqtt_topic="t",
        mqtt_alias=None,
        persist_value=False,
        record_history=False,
        created_at=NOW,
        updated_at=NOW,
        group_address="1/257",
    )
    assert out.group_address == "1/1/1"
    assert out.model_validate({**out.model_dump(), "group_address": None}).group_address is None


@pytest.mark.asyncio
async def test_an_empty_result_needs_no_binding_query(db: Database, monkeypatch):
    assert await _search(db, monkeypatch, []) == {}
