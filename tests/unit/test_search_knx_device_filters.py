"""Search API: KNX device filters (#1266 P7).

``GET /api/v1/search`` narrows datapoints to KNX devices like the KNX monitor and
the device view do: a datapoint belongs to a device when one of its KNX bindings
carries, as command or status address, a group address that a communication
object of the device links.

- ``device``: comma-separated physical addresses (OR), like the other list filters;
- ``knx_linked=true``: datapoints with at least one group address linked to a device;
  ``knx_linked=false``: datapoints with a KNX group address, none of them linked;
- ``GET /api/v1/search/knx-device-data``: whether any group address is linked to a
  device the caller may see, so a client can switch ``knx_linked`` off for a project
  without device data instead of showing an empty list.

Non-admins only match through bindings on adapter instances they may read and
through devices and group addresses the device view shows them.
"""

from __future__ import annotations

import uuid

import pytest

import obs.api.v1.datapoints as datapoints_api
import obs.api.v1.search as search_api
from obs.api.auth import Principal
from obs.db.database import Database
from obs.models.datapoint import DataPoint
from tests.unit.test_search_command_group_address import ADMIN, ALICE, NOW, _binding, _datapoint, _grant, _instance, _RegistryStub


@pytest.fixture
async def db() -> Database:
    database = Database(":memory:")
    await database.connect()
    try:
        yield database
    finally:
        await database.disconnect()


async def _device(db: Database, pa: str, comm_objects: list[list[str]]) -> str:
    """A device with one communication object per address list."""
    device_id = str(uuid.uuid4())
    await db.execute_and_commit(
        "INSERT INTO knx_devices (id, individual_address, name, imported_at) VALUES (?, ?, ?, ?)",
        (device_id, pa, f"Device {pa}", NOW),
    )
    for number, addresses in enumerate(comm_objects, start=1):
        co_id = str(uuid.uuid4())
        await db.execute_and_commit(
            "INSERT INTO knx_comm_objects (id, device_id, number, imported_at) VALUES (?, ?, ?, ?)",
            (co_id, device_id, str(number), NOW),
        )
        for address in addresses:
            await db.execute_and_commit("INSERT OR IGNORE INTO knx_group_addresses (address) VALUES (?)", (address,))
            await db.execute_and_commit("INSERT INTO knx_co_ga_links (comm_object_id, ga_address) VALUES (?, ?)", (co_id, address))
    return device_id


async def _search(db: Database, monkeypatch, datapoints: list[DataPoint], principal: Principal = ADMIN, **params):
    registry = _RegistryStub(datapoints)
    monkeypatch.setattr(search_api, "get_registry", lambda: registry)
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)
    query = {
        "q": "",
        "tag": "",
        "type": "",
        "adapter": "",
        "quality": "",
        "node_id": "",
        "tree_id": "",
        "sort": "name",
        "order": "asc",
        "page": 0,
        "size": 50,
        **params,
    }
    return await search_api.search(**query, _user=principal, db=db)


async def _device_data(db: Database, principal: Principal = ADMIN) -> bool:
    return (await search_api.knx_device_data(_user=principal, db=db)).knx_device_data


def _names(page) -> list[str]:
    return [item.name for item in page.items]


@pytest.fixture
async def plant(db: Database):
    """Two devices: 1.1.1 with two objects (three addresses), 1.1.2 sharing one address with 1.1.1."""
    knx = await _instance(db)
    await _device(db, "1.1.1", [["1/0/1"], ["1/0/2", "1/0/3"]])
    await _device(db, "1.1.2", [["1/0/3"], ["1/0/9"]])
    dps = {}
    for name, config in (
        ("A switch", {"group_address": "1/0/1"}),
        ("A dimmer", {"group_address": "1/0/2"}),
        ("Shared", {"group_address": "1/0/3"}),
        ("Status only", {"group_address": "2/0/1", "state_group_address": "1/0/9"}),
        ("Two-level notation", {"group_address": "1/2"}),
        ("No device", {"group_address": "2/0/2"}),
    ):
        dps[name] = await _datapoint(db, name)
        await _binding(db, dps[name], knx, config=config)
    dps["MQTT"] = await _datapoint(db, "MQTT")
    await _binding(db, dps["MQTT"], await _instance(db, "MQTT"), config={"group_address": "1/0/1"}, adapter_type="MQTT")
    dps["Unbound"] = await _datapoint(db, "Unbound")
    return knx, dps


@pytest.mark.asyncio
async def test_device_filter_matches_command_and_status_addresses_of_the_device(db: Database, monkeypatch, plant):
    _, dps = plant
    datapoints = list(dps.values())

    one = await _search(db, monkeypatch, datapoints, device="1.1.1")
    assert _names(one) == ["A dimmer", "A switch", "Shared", "Two-level notation"]
    assert one.total == 4
    assert _names(await _search(db, monkeypatch, datapoints, device="1.1.2")) == ["Shared", "Status only"]


@pytest.mark.asyncio
async def test_several_devices_are_or_combined_and_counted_once(db: Database, monkeypatch, plant):
    _, dps = plant

    page = await _search(db, monkeypatch, list(dps.values()), device=" 1.1.1 , 1.1.2,, ")
    assert _names(page) == ["A dimmer", "A switch", "Shared", "Status only", "Two-level notation"]
    assert page.total == 5
    assert page.query["device"] == " 1.1.1 , 1.1.2,, "


@pytest.mark.asyncio
async def test_an_unknown_device_matches_nothing_and_a_blank_one_filters_nothing(db: Database, monkeypatch, plant):
    _, dps = plant
    datapoints = list(dps.values())

    assert (await _search(db, monkeypatch, datapoints, device="9.9.9")).total == 0
    assert (await _search(db, monkeypatch, datapoints, device=" , ")).total == len(datapoints)


@pytest.mark.asyncio
async def test_knx_linked_splits_the_knx_datapoints(db: Database, monkeypatch, plant):
    _, dps = plant
    datapoints = list(dps.values())

    linked = await _search(db, monkeypatch, datapoints, knx_linked=True)
    unlinked = await _search(db, monkeypatch, datapoints, knx_linked=False)
    assert _names(linked) == ["A dimmer", "A switch", "Shared", "Status only", "Two-level notation"]
    assert _names(unlinked) == ["No device"]
    assert (linked.query["knx_linked"], unlinked.query["knx_linked"]) == (True, False)
    assert await _device_data(db) is True


@pytest.mark.asyncio
async def test_device_filters_combine_with_query_and_pagination(db: Database, monkeypatch, plant):
    _, dps = plant
    datapoints = list(dps.values())

    first = await _search(db, monkeypatch, datapoints, device="1.1.1", size=3, page=1)
    assert (_names(first), first.total, first.pages) == (["Two-level notation"], 4, 2)
    named = await _search(db, monkeypatch, datapoints, q="i", device="1.1.1,1.1.2", knx_linked=True)
    assert _names(named) == ["A dimmer", "A switch", "Two-level notation"]


@pytest.mark.asyncio
async def test_a_project_without_device_data_says_so(db: Database, monkeypatch):
    knx = await _instance(db)
    dp = await _datapoint(db, "Licht")
    await _binding(db, dp, knx, config={"group_address": "1/0/1"})

    assert await _device_data(db) is False
    assert (await _search(db, monkeypatch, [dp])).total == 1
    assert (await _search(db, monkeypatch, [dp], knx_linked=True)).total == 0
    assert _names(await _search(db, monkeypatch, [dp], knx_linked=False)) == ["Licht"]


@pytest.mark.asyncio
async def test_without_filters_nothing_is_filtered(db: Database, monkeypatch, plant):
    _, dps = plant
    page = await _search(db, monkeypatch, list(dps.values()))
    assert page.total == len(dps)
    assert (page.query["device"], page.query["knx_linked"]) == ("", None)


@pytest.mark.asyncio
async def test_non_admins_match_only_through_readable_instances(db: Database, monkeypatch, plant):
    """No instance grant: no match, no count, no device data – nothing about the hidden instance."""
    knx, dps = plant
    datapoints = list(dps.values())
    for dp in datapoints:
        await _grant(db, "datapoint", str(dp.id))

    for params in ({"device": "1.1.1"}, {"device": "1.1.2"}, {"knx_linked": True}, {"knx_linked": False}):
        page = await _search(db, monkeypatch, datapoints, ALICE, **params)
        assert (page.items, page.total) == ([], 0), params
    assert (await _search(db, monkeypatch, datapoints, ALICE)).total == len(datapoints)
    assert await _device_data(db, ALICE) is False

    await _grant(db, "adapter_instance", knx)
    # The device view needs an enabled instance (``_authorized_knx_device_scope``).
    await db.execute_and_commit("UPDATE adapter_instances SET enabled = 1 WHERE id = ?", (knx,))
    page = await _search(db, monkeypatch, datapoints, ALICE, device="1.1.1")
    assert (_names(page), await _device_data(db, ALICE)) == (["A dimmer", "A switch", "Shared", "Two-level notation"], True)
    assert _names(await _search(db, monkeypatch, datapoints, ALICE, knx_linked=False)) == ["No device"]


@pytest.mark.asyncio
async def test_non_admins_see_device_data_only_where_the_device_view_shows_it(db: Database, monkeypatch, plant):
    knx, dps = plant
    await _grant(db, "adapter_instance", knx)
    await db.execute_and_commit("UPDATE adapter_instances SET enabled = 1 WHERE id = ?", (knx,))
    readable = [dps["A switch"], dps["No device"], dps["Status only"]]
    for dp in readable:
        await _grant(db, "datapoint", str(dp.id))
    # A disabled binding keeps 1/0/9 out of the device view, so 1.1.2 is hidden from alice.
    await db.execute_and_commit("UPDATE adapter_bindings SET enabled = 0 WHERE datapoint_id = ?", (str(dps["Status only"].id),))

    assert await _device_data(db, ALICE) is True
    assert (await _search(db, monkeypatch, readable, ALICE, device="1.1.2")).total == 0
    assert _names(await _search(db, monkeypatch, readable, ALICE, knx_linked=True)) == ["A switch"]
    assert (await _search(db, monkeypatch, readable, ADMIN, device="1.1.2")).total == 1


@pytest.mark.asyncio
async def test_without_visible_device_data_every_knx_datapoint_counts_as_unlinked(db: Database, monkeypatch, plant):
    """The flag is false then, which tells the client to switch the filter off."""
    knx, dps = plant
    await _grant(db, "adapter_instance", knx)
    readable = [dps["A switch"], dps["No device"]]
    for dp in readable:
        await _grant(db, "datapoint", str(dp.id))

    hidden = await _search(db, monkeypatch, readable, ALICE, knx_linked=True)
    assert (hidden.total, await _device_data(db, ALICE)) == (0, False)
    assert _names(await _search(db, monkeypatch, readable, ALICE, knx_linked=False)) == ["A switch", "No device"]


@pytest.mark.asyncio
async def test_an_address_outside_the_page_still_counts_through_another_readable_datapoint(db: Database, monkeypatch, plant):
    """The read check of the result page is reused; other datapoints on the address are checked on their own."""
    knx, dps = plant
    await _grant(db, "adapter_instance", knx)
    await db.execute_and_commit("UPDATE adapter_instances SET enabled = 1 WHERE id = ?", (knx,))
    mirror = await _datapoint(db, "Mirror")
    await _binding(db, mirror, knx, config={"group_address": "1/0/1"})
    hidden_mirror = await _datapoint(db, "Hidden mirror")
    await _binding(db, hidden_mirror, knx, config={"group_address": "1/0/2"})
    for dp in (dps["A switch"], dps["A dimmer"], mirror):
        await _grant(db, "datapoint", str(dp.id))
    # Both switch and dimmer have their own binding disabled; only the switch's address
    # is carried by another datapoint alice may read.
    for name in ("A switch", "A dimmer"):
        await db.execute_and_commit("UPDATE adapter_bindings SET enabled = 0 WHERE datapoint_id = ?", (str(dps[name].id),))

    # The mirrors are not on the page (as if another filter had dropped them).
    page = await _search(db, monkeypatch, [dps["A switch"], dps["A dimmer"]], ALICE, device="1.1.1")
    assert _names(page) == ["A switch"]


@pytest.mark.asyncio
async def test_a_binding_without_a_valid_address_counts_as_no_knx_address(db: Database, monkeypatch, plant):
    knx, dps = plant
    invalid = await _datapoint(db, "Invalid address")
    await _binding(db, invalid, knx, config={"group_address": "not-a-ga"})

    assert _names(await _search(db, monkeypatch, [*dps.values(), invalid], knx_linked=False)) == ["No device"]
