"""Targeted coverage boost tests for obs.api.v1.ringbuffer."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from obs.api.v1 import ringbuffer as rb_api


class _RegistryStub:
    def __init__(self, entries):
        self._entries = entries

    def all(self):
        return list(self._entries)


class _RingbufferStub:
    def __init__(self, rows=None, exc: Exception | None = None):
        self.rows = rows or []
        self.exc = exc
        self.last_kwargs = None

    async def query_v2(self, **kwargs):
        self.last_kwargs = kwargs
        if self.exc:
            raise self.exc
        return list(self.rows)


class _FetchDbStub:
    def __init__(self):
        self.filtersets = {
            "fs-1": {
                "id": "fs-1",
                "name": "FS",
                "description": "desc",
                "dsl_version": 2,
                "is_active": 1,
                "is_default": 0,
                "query_json": "{}",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
        }
        self.groups = {
            "fs-1": [
                {
                    "id": "g-1",
                    "name": "Group",
                    "is_active": 1,
                    "group_order": 5,
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": "2026-01-01T00:00:00Z",
                }
            ]
        }
        self.rules = {
            "g-1": [
                {
                    "id": "r-1",
                    "name": "Rule",
                    "is_active": 1,
                    "rule_order": 7,
                    "query_json": "{}",
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": "2026-01-01T00:00:00Z",
                }
            ]
        }

    async def fetchone(self, query, params):
        if "FROM ringbuffer_filtersets" in query:
            return self.filtersets.get(params[0])
        raise AssertionError(f"Unexpected query: {query}")

    async def fetchall(self, query, params=()):
        if "FROM ringbuffer_filterset_groups" in query:
            return list(self.groups.get(params[0], []))
        if "FROM ringbuffer_filterset_rules" in query:
            return list(self.rules.get(params[0], []))
        raise AssertionError(f"Unexpected query: {query}")


class _InsertDbStub:
    def __init__(self):
        self.executes = []
        self.committed = False

    async def execute(self, query, params=None):
        self.executes.append((query, params))

    async def commit(self):
        self.committed = True


def _mk_dp(dp_id="dp-1", name="Wohnzimmer", data_type="FLOAT"):
    return SimpleNamespace(id=dp_id, name=name, data_type=data_type)


def _mk_row(row_id=1, dp_id="dp-1"):
    return SimpleNamespace(
        id=row_id,
        ts="2026-01-01T00:00:00.000Z",
        datapoint_id=dp_id,
        topic=f"dp/{dp_id}/value",
        old_value=1,
        new_value=2,
        source_adapter="api",
        quality="good",
        metadata_version=1,
        metadata={"k": "v"},
    )


def _mk_filterset_out(filterset_id="fs-1", is_active=True, groups=None):
    return rb_api.RingBufferFiltersetOut(
        id=filterset_id,
        name="FS",
        description="desc",
        dsl_version=2,
        is_active=is_active,
        is_default=False,
        query=rb_api.RingBufferQueryV2(),
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        groups=groups or [],
    )


def test_helpers_now_uuid_decode_encode_and_cap():
    assert rb_api._now_iso().endswith("+00:00")
    assert len(rb_api._new_id()) == 36

    default_q = rb_api._decode_query(None)
    assert isinstance(default_q, rb_api.RingBufferQueryV2)

    # Invalid JSON and non-object payload should both fall back to default query
    assert isinstance(rb_api._decode_query("{invalid"), rb_api.RingBufferQueryV2)
    assert isinstance(rb_api._decode_query("[]"), rb_api.RingBufferQueryV2)

    query = rb_api.RingBufferQueryV2(
        pagination=rb_api.RingBufferPaginationV2(limit=9999, offset=9999),
    )
    encoded = rb_api._encode_query(query)
    assert '"pagination"' in encoded

    capped = rb_api._cap_filterset_query(query)
    assert capped.pagination.limit == 2000
    assert capped.pagination.offset == 5000


def test_csv_helpers_map_entry_fields():
    entry = rb_api.RingBufferEntryOut(
        id=11,
        ts="2026-01-01T00:00:00.000Z",
        datapoint_id="dp-1",
        name=None,
        topic="dp/dp-1/value",
        old_value={"alt": 1},
        new_value={"neu": 2},
        source_adapter="api",
        quality="good",
        metadata_version=3,
        metadata={"tag": "küche"},
    )

    assert rb_api._csv_json({"x": "ü"}) == '{"x":"ü"}'
    row = rb_api._entry_to_csv_row(entry)
    assert row["id"] == "11"
    assert row["name"] == ""
    assert row["metadata_version"] == "3"
    assert row["metadata_json"] == '{"tag":"küche"}'


@pytest.mark.asyncio
async def test_query_v2_entries_success_and_overrides(monkeypatch):
    registry = _RegistryStub([_mk_dp("dp-1", "Wohnzimmer Temp")])
    rb = _RingbufferStub(rows=[_mk_row(22, "dp-1")])

    monkeypatch.setattr("obs.core.registry.get_registry", lambda: registry)
    monkeypatch.setattr(rb_api, "get_ringbuffer", lambda: rb)

    body = rb_api.RingBufferQueryV2(
        filters=rb_api.RingBufferFiltersV2(q="wohnzimmer"),
        sort=rb_api.RingBufferSortV2(field="ts", order="asc"),
        pagination=rb_api.RingBufferPaginationV2(limit=10, offset=2),
    )

    rows = await rb_api._query_v2_entries(body, limit_override=7, offset_override=1)
    assert len(rows) == 1
    assert rows[0].name == "Wohnzimmer Temp"
    assert rb.last_kwargs is not None
    assert rb.last_kwargs["limit"] == 7
    assert rb.last_kwargs["offset"] == 1
    assert rb.last_kwargs["dp_ids_by_name"] == ["dp-1"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filters", "expected_msg"),
    [
        (rb_api.RingBufferFiltersV2(adapters=rb_api.RingBufferAdapterFilterV2(any_of=["  "])), "filters.adapters.any_of"),
        (rb_api.RingBufferFiltersV2(datapoints=rb_api.RingBufferDatapointFilterV2(ids=["  "])), "filters.datapoints.ids"),
        (rb_api.RingBufferFiltersV2(values=[]), "filters.values"),
        (rb_api.RingBufferFiltersV2(metadata=rb_api.RingBufferMetadataFilterV2()), "filters.metadata"),
    ],
)
async def test_query_v2_entries_validation_guards(monkeypatch, filters, expected_msg):
    registry = _RegistryStub([_mk_dp()])
    rb = _RingbufferStub(rows=[])
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: registry)
    monkeypatch.setattr(rb_api, "get_ringbuffer", lambda: rb)

    with pytest.raises(HTTPException) as exc_info:
        await rb_api._query_v2_entries(rb_api.RingBufferQueryV2(filters=filters))

    assert exc_info.value.status_code == 422
    assert expected_msg in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_query_v2_entries_converts_value_error_to_http_422(monkeypatch):
    registry = _RegistryStub([_mk_dp()])
    rb = _RingbufferStub(exc=ValueError("invalid filter window"))
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: registry)
    monkeypatch.setattr(rb_api, "get_ringbuffer", lambda: rb)

    with pytest.raises(HTTPException) as exc_info:
        await rb_api._query_v2_entries(rb_api.RingBufferQueryV2())

    assert exc_info.value.status_code == 422
    assert "invalid filter window" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_fetch_filterset_returns_none_or_full_structure():
    db = _FetchDbStub()

    missing = await rb_api._fetch_filterset(db, "missing")
    assert missing is None

    fetched = await rb_api._fetch_filterset(db, "fs-1")
    assert fetched is not None
    assert fetched.id == "fs-1"
    assert fetched.groups[0].id == "g-1"
    assert fetched.groups[0].rules[0].id == "r-1"


@pytest.mark.asyncio
async def test_insert_filterset_persists_groups_rules_and_returns_created(monkeypatch):
    db = _InsertDbStub()
    created = _mk_filterset_out("fs-new")

    async def _fake_fetch(_db, _filterset_id):
        return created

    monkeypatch.setattr(rb_api, "_fetch_filterset", _fake_fetch)

    payload = rb_api.RingBufferFiltersetCreate(
        name="FS new",
        is_default=True,
        groups=[
            rb_api.RingBufferFiltersetGroupCreate(
                name="G",
                rules=[rb_api.RingBufferFiltersetRuleCreate(name="R")],
            )
        ],
    )

    result = await rb_api._insert_filterset(db, payload=payload)
    assert result == created
    assert db.committed is True
    assert any("INSERT INTO ringbuffer_filtersets" in query for query, _ in db.executes)
    assert any("INSERT INTO ringbuffer_filterset_groups" in query for query, _ in db.executes)
    assert any("INSERT INTO ringbuffer_filterset_rules" in query for query, _ in db.executes)
    assert any("UPDATE ringbuffer_filtersets SET is_default=0" in query for query, _ in db.executes)


@pytest.mark.asyncio
async def test_insert_filterset_raises_when_refetch_fails(monkeypatch):
    db = _InsertDbStub()

    async def _fake_fetch(_db, _filterset_id):
        return None

    monkeypatch.setattr(rb_api, "_fetch_filterset", _fake_fetch)

    with pytest.raises(RuntimeError, match="failed to create filterset"):
        await rb_api._insert_filterset(db, payload=rb_api.RingBufferFiltersetCreate(name="FS"))


@pytest.mark.asyncio
async def test_filterset_route_guards_and_rule_limit(monkeypatch):
    class _DbDefaultMissing:
        async def fetchone(self, _query, _params=()):
            return None

    db = _DbDefaultMissing()

    async def _fetch_none(_db, _id):
        return None

    monkeypatch.setattr(rb_api, "_fetch_filterset", _fetch_none)

    with pytest.raises(HTTPException) as exc_default:
        await rb_api.get_default_ringbuffer_filterset(db=db)
    assert exc_default.value.status_code == 404

    with pytest.raises(HTTPException) as exc_get:
        await rb_api.get_ringbuffer_filterset("missing", db=db)
    assert exc_get.value.status_code == 404

    with pytest.raises(HTTPException) as exc_query:
        await rb_api.query_ringbuffer_filterset("missing", db=db)
    assert exc_query.value.status_code == 404

    groups = [
        rb_api.RingBufferFiltersetGroupOut(
            id="g",
            name="g",
            is_active=True,
            group_order=0,
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
            rules=[
                rb_api.RingBufferFiltersetRuleOut(
                    id=f"r-{idx}",
                    name=f"r-{idx}",
                    is_active=True,
                    rule_order=idx,
                    query=rb_api.RingBufferQueryV2(),
                    created_at="2026-01-01T00:00:00Z",
                    updated_at="2026-01-01T00:00:00Z",
                )
                for idx in range(51)
            ],
        )
    ]

    async def _fetch_many(_db, _id):
        return _mk_filterset_out("fs-many", is_active=True, groups=groups)

    monkeypatch.setattr(rb_api, "_fetch_filterset", _fetch_many)
    with pytest.raises(HTTPException) as exc_too_many:
        await rb_api.query_ringbuffer_filterset("fs-many", db=db)
    assert exc_too_many.value.status_code == 422
    assert "too many active rules" in str(exc_too_many.value.detail)
