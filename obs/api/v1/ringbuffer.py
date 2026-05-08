"""RingBuffer API."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from obs.api.auth import get_admin_user
from obs.api.auth import get_current_user
from obs.db.database import Database, get_db
from obs.ringbuffer.ringbuffer import get_ringbuffer

router = APIRouter(tags=["ringbuffer"])

_FILTERSET_QUERY_LIMIT_CAP = 2000
_FILTERSET_QUERY_OFFSET_CAP = 5000
_FILTERSET_ACTIVE_RULES_CAP = 50


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Query models
# ---------------------------------------------------------------------------


class RingBufferEntryOut(BaseModel):
    id: int
    ts: str
    datapoint_id: str
    name: str | None
    topic: str
    old_value: Any
    new_value: Any
    source_adapter: str
    quality: str
    metadata_version: int
    metadata: dict[str, Any]


class RingBufferStats(BaseModel):
    total: int
    oldest_ts: str | None
    newest_ts: str | None
    storage: str
    max_entries: int
    max_file_size_bytes: int | None
    max_age: int | None
    file_size_bytes: int


class RingBufferConfig(BaseModel):
    storage: str = "file"
    max_entries: int = 10000
    max_file_size_bytes: int | None = Field(default=None, ge=1)
    max_age: int | None = Field(default=None, ge=0)


class RingBufferTimeFilterV2(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_ts: str | None = Field(default=None, alias="from")
    to_ts: str | None = Field(default=None, alias="to")
    from_relative_seconds: int | None = None
    to_relative_seconds: int | None = None


class RingBufferAdapterFilterV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    any_of: list[str] = Field(default_factory=list)


class RingBufferDatapointFilterV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(default_factory=list)


class RingBufferValueFilterV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operator: Literal["eq", "ne", "gt", "gte", "lt", "lte", "between", "contains", "regex"]
    value: Any | None = None
    lower: Any | None = None
    upper: Any | None = None
    pattern: str | None = None
    ignore_case: bool = False


class RingBufferMetadataFilterV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tags_any_of: list[str] = Field(default_factory=list)
    adapter_types_any_of: list[str] = Field(default_factory=list)
    adapter_instance_ids_any_of: list[str] = Field(default_factory=list)
    group_addresses_any_of: list[str] = Field(default_factory=list)
    topics_any_of: list[str] = Field(default_factory=list)
    entity_ids_any_of: list[str] = Field(default_factory=list)
    register_types_any_of: list[str] = Field(default_factory=list)
    register_addresses_any_of: list[str] = Field(default_factory=list)


class RingBufferFiltersV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = ""
    time: RingBufferTimeFilterV2 | None = None
    adapters: RingBufferAdapterFilterV2 | None = None
    datapoints: RingBufferDatapointFilterV2 | None = None
    values: list[RingBufferValueFilterV2] | None = None
    metadata: RingBufferMetadataFilterV2 | None = None


class RingBufferSortV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Literal["id", "ts"] = "id"
    order: Literal["asc", "desc"] = "desc"


class RingBufferPaginationV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=100, ge=1, le=10000)
    offset: int = Field(default=0, ge=0)


class RingBufferQueryV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filters: RingBufferFiltersV2 = Field(default_factory=RingBufferFiltersV2)
    sort: RingBufferSortV2 = Field(default_factory=RingBufferSortV2)
    pagination: RingBufferPaginationV2 = Field(default_factory=RingBufferPaginationV2)


# ---------------------------------------------------------------------------
# Filterset models
# ---------------------------------------------------------------------------


class RingBufferFiltersetRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    is_active: bool = True
    rule_order: int = 0
    query: RingBufferQueryV2 = Field(default_factory=RingBufferQueryV2)


class RingBufferFiltersetGroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    is_active: bool = True
    group_order: int = 0
    rules: list[RingBufferFiltersetRuleCreate] = Field(default_factory=list)


class RingBufferFiltersetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str = ""
    dsl_version: int = Field(default=2, ge=1)
    is_active: bool = True
    is_default: bool = False
    query: RingBufferQueryV2 = Field(default_factory=RingBufferQueryV2)
    groups: list[RingBufferFiltersetGroupCreate] = Field(default_factory=list)


class RingBufferFiltersetRuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    name: str | None = None
    is_active: bool | None = None
    rule_order: int | None = None
    query: RingBufferQueryV2 | None = None


class RingBufferFiltersetGroupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    name: str | None = None
    is_active: bool | None = None
    group_order: int | None = None
    rules: list[RingBufferFiltersetRuleUpdate] | None = None


class RingBufferFiltersetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    dsl_version: int | None = Field(default=None, ge=1)
    is_active: bool | None = None
    is_default: bool | None = None
    query: RingBufferQueryV2 | None = None
    groups: list[RingBufferFiltersetGroupUpdate] | None = None


class RingBufferFiltersetCloneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class RingBufferFiltersetRuleOut(BaseModel):
    id: str
    name: str
    is_active: bool
    rule_order: int
    query: RingBufferQueryV2
    created_at: str
    updated_at: str


class RingBufferFiltersetGroupOut(BaseModel):
    id: str
    name: str
    is_active: bool
    group_order: int
    created_at: str
    updated_at: str
    rules: list[RingBufferFiltersetRuleOut]


class RingBufferFiltersetOut(BaseModel):
    id: str
    name: str
    description: str
    dsl_version: int
    is_active: bool
    is_default: bool
    query: RingBufferQueryV2
    created_at: str
    updated_at: str
    groups: list[RingBufferFiltersetGroupOut]


def _decode_query(raw: str | None) -> RingBufferQueryV2:
    payload: Any = {}
    if raw:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}
    if not isinstance(payload, dict):
        payload = {}
    try:
        return RingBufferQueryV2.model_validate(payload)
    except Exception:
        return RingBufferQueryV2()


def _encode_query(query: RingBufferQueryV2) -> str:
    return json.dumps(query.model_dump(by_alias=True), separators=(",", ":"))


def _cap_filterset_query(query: RingBufferQueryV2) -> RingBufferQueryV2:
    capped_limit = min(query.pagination.limit, _FILTERSET_QUERY_LIMIT_CAP)
    capped_offset = min(query.pagination.offset, _FILTERSET_QUERY_OFFSET_CAP)
    if capped_limit == query.pagination.limit and capped_offset == query.pagination.offset:
        return query
    return query.model_copy(
        update={
            "pagination": query.pagination.model_copy(
                update={
                    "limit": capped_limit,
                    "offset": capped_offset,
                }
            )
        }
    )


async def _query_v2_entries(
    body: RingBufferQueryV2,
    *,
    limit_override: int | None = None,
    offset_override: int | None = None,
) -> list[RingBufferEntryOut]:
    from obs.core.registry import get_registry

    registry = get_registry()
    registry_entries = list(registry.all())
    name_map: dict[str, str] = {str(dp.id): dp.name for dp in registry_entries}

    q = body.filters.q.strip()
    dp_ids_by_name: list[str] = []
    if q:
        q_lower = q.lower()
        dp_ids_by_name = [str(dp.id) for dp in registry_entries if q_lower in dp.name.lower()]

    adapters = [value.strip() for value in (body.filters.adapters.any_of if body.filters.adapters else []) if value.strip()]
    datapoints = [value.strip() for value in (body.filters.datapoints.ids if body.filters.datapoints else []) if value.strip()]
    value_filters = [value_filter.model_dump() for value_filter in (body.filters.values or [])]
    metadata_filter = body.filters.metadata
    metadata_tags = [value.strip() for value in (metadata_filter.tags_any_of if metadata_filter else []) if value.strip()]
    metadata_adapter_types = [value.strip() for value in (metadata_filter.adapter_types_any_of if metadata_filter else []) if value.strip()]
    metadata_adapter_instances = [
        value.strip() for value in (metadata_filter.adapter_instance_ids_any_of if metadata_filter else []) if value.strip()
    ]
    metadata_group_addresses = [value.strip() for value in (metadata_filter.group_addresses_any_of if metadata_filter else []) if value.strip()]
    metadata_topics = [value.strip() for value in (metadata_filter.topics_any_of if metadata_filter else []) if value.strip()]
    metadata_entity_ids = [value.strip() for value in (metadata_filter.entity_ids_any_of if metadata_filter else []) if value.strip()]
    metadata_register_types = [value.strip() for value in (metadata_filter.register_types_any_of if metadata_filter else []) if value.strip()]
    metadata_register_addresses = [value.strip() for value in (metadata_filter.register_addresses_any_of if metadata_filter else []) if value.strip()]

    if body.filters.adapters and not adapters:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "filters.adapters.any_of must contain at least one adapter",
        )
    if body.filters.datapoints and not datapoints:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "filters.datapoints.ids must contain at least one datapoint id",
        )
    if body.filters.values is not None and not value_filters:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "filters.values must contain at least one value filter rule",
        )
    if metadata_filter and not any(
        (
            metadata_tags,
            metadata_adapter_types,
            metadata_adapter_instances,
            metadata_group_addresses,
            metadata_topics,
            metadata_entity_ids,
            metadata_register_types,
            metadata_register_addresses,
        )
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "filters.metadata must contain at least one metadata filter rule",
        )

    time_filter = body.filters.time
    datapoint_types = {str(dp.id): dp.data_type for dp in registry_entries}
    rb = get_ringbuffer()
    try:
        entries = await rb.query_v2(
            q=q,
            adapter_any_of=adapters or None,
            datapoint_ids=datapoints or None,
            value_filters=value_filters or None,
            metadata_tags_any_of=metadata_tags or None,
            metadata_adapter_types_any_of=metadata_adapter_types or None,
            metadata_adapter_instance_ids_any_of=metadata_adapter_instances or None,
            metadata_group_addresses_any_of=metadata_group_addresses or None,
            metadata_topics_any_of=metadata_topics or None,
            metadata_entity_ids_any_of=metadata_entity_ids or None,
            metadata_register_types_any_of=metadata_register_types or None,
            metadata_register_addresses_any_of=metadata_register_addresses or None,
            datapoint_types=datapoint_types,
            from_ts=time_filter.from_ts if time_filter else None,
            to_ts=time_filter.to_ts if time_filter else None,
            from_relative_seconds=time_filter.from_relative_seconds if time_filter else None,
            to_relative_seconds=time_filter.to_relative_seconds if time_filter else None,
            limit=limit_override if limit_override is not None else body.pagination.limit,
            offset=offset_override if offset_override is not None else body.pagination.offset,
            sort_field=body.sort.field,
            sort_order=body.sort.order,
            dp_ids_by_name=dp_ids_by_name or None,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    return [
        RingBufferEntryOut(
            id=e.id,
            ts=e.ts,
            datapoint_id=e.datapoint_id,
            name=name_map.get(e.datapoint_id),
            topic=e.topic,
            old_value=e.old_value,
            new_value=e.new_value,
            source_adapter=e.source_adapter,
            quality=e.quality,
            metadata_version=e.metadata_version,
            metadata=e.metadata,
        )
        for e in entries
    ]


async def _fetch_filterset(db: Database, filterset_id: str) -> RingBufferFiltersetOut | None:
    row = await db.fetchone("SELECT * FROM ringbuffer_filtersets WHERE id=?", (filterset_id,))
    if not row:
        return None

    group_rows = await db.fetchall(
        "SELECT * FROM ringbuffer_filterset_groups WHERE filterset_id=? ORDER BY group_order, created_at, id",
        (filterset_id,),
    )
    groups: list[RingBufferFiltersetGroupOut] = []
    for group_row in group_rows:
        rule_rows = await db.fetchall(
            "SELECT * FROM ringbuffer_filterset_rules WHERE group_id=? ORDER BY rule_order, created_at, id",
            (group_row["id"],),
        )
        rules = [
            RingBufferFiltersetRuleOut(
                id=rule_row["id"],
                name=rule_row["name"],
                is_active=bool(rule_row["is_active"]),
                rule_order=int(rule_row["rule_order"]),
                query=_decode_query(rule_row["query_json"]),
                created_at=rule_row["created_at"],
                updated_at=rule_row["updated_at"],
            )
            for rule_row in rule_rows
        ]
        groups.append(
            RingBufferFiltersetGroupOut(
                id=group_row["id"],
                name=group_row["name"],
                is_active=bool(group_row["is_active"]),
                group_order=int(group_row["group_order"]),
                created_at=group_row["created_at"],
                updated_at=group_row["updated_at"],
                rules=rules,
            )
        )

    return RingBufferFiltersetOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        dsl_version=int(row["dsl_version"]),
        is_active=bool(row["is_active"]),
        is_default=bool(row["is_default"]),
        query=_decode_query(row["query_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        groups=groups,
    )


async def _insert_filterset(
    db: Database,
    *,
    payload: RingBufferFiltersetCreate,
) -> RingBufferFiltersetOut:
    now = _now_iso()
    filterset_id = _new_id()
    if payload.is_default:
        await db.execute("UPDATE ringbuffer_filtersets SET is_default=0")

    await db.execute(
        """INSERT INTO ringbuffer_filtersets
           (id, name, description, dsl_version, is_active, is_default, query_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            filterset_id,
            payload.name,
            payload.description,
            payload.dsl_version,
            int(payload.is_active),
            int(payload.is_default),
            _encode_query(payload.query),
            now,
            now,
        ),
    )

    for group_payload in payload.groups:
        group_id = _new_id()
        await db.execute(
            """INSERT INTO ringbuffer_filterset_groups
               (id, filterset_id, name, is_active, group_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                group_id,
                filterset_id,
                group_payload.name,
                int(group_payload.is_active),
                int(group_payload.group_order),
                now,
                now,
            ),
        )
        for rule_payload in group_payload.rules:
            await db.execute(
                """INSERT INTO ringbuffer_filterset_rules
                   (id, group_id, name, is_active, rule_order, query_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    _new_id(),
                    group_id,
                    rule_payload.name,
                    int(rule_payload.is_active),
                    int(rule_payload.rule_order),
                    _encode_query(rule_payload.query),
                    now,
                    now,
                ),
            )

    await db.commit()
    created = await _fetch_filterset(db, filterset_id)
    if not created:
        raise RuntimeError("failed to create filterset")
    return created


@router.get("/", response_model=list[RingBufferEntryOut])
async def query_ringbuffer(
    q: str = Query("", description="Substring in datapoint name, id or source_adapter"),
    adapter: str = Query("", description="Exact source_adapter match"),
    from_ts: str = Query("", alias="from", description="ISO-8601 timestamp (exclusive lower bound)"),
    limit: int = Query(100, ge=1, le=10000),
    _user: str = Depends(get_current_user),
) -> list[RingBufferEntryOut]:
    from obs.core.registry import get_registry

    registry = get_registry()
    name_map: dict[str, str] = {str(dp.id): dp.name for dp in registry.all()}
    dp_ids_by_name: list[str] = []
    if q:
        q_lower = q.lower()
        dp_ids_by_name = [str(dp.id) for dp in registry.all() if q_lower in dp.name.lower()]

    rb = get_ringbuffer()
    entries = await rb.query(
        q=q,
        adapter=adapter,
        from_ts=from_ts,
        limit=limit,
        dp_ids=dp_ids_by_name or None,
    )
    return [
        RingBufferEntryOut(
            id=e.id,
            ts=e.ts,
            datapoint_id=e.datapoint_id,
            name=name_map.get(e.datapoint_id),
            topic=e.topic,
            old_value=e.old_value,
            new_value=e.new_value,
            source_adapter=e.source_adapter,
            quality=e.quality,
            metadata_version=e.metadata_version,
            metadata=e.metadata,
        )
        for e in entries
    ]


@router.post("/query", response_model=list[RingBufferEntryOut])
async def query_ringbuffer_v2(
    body: RingBufferQueryV2,
    _user: str = Depends(get_current_user),
) -> list[RingBufferEntryOut]:
    return await _query_v2_entries(body)


@router.get("/filtersets", response_model=list[RingBufferFiltersetOut])
async def list_ringbuffer_filtersets(
    _user: str = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[RingBufferFiltersetOut]:
    rows = await db.fetchall(
        "SELECT id FROM ringbuffer_filtersets ORDER BY is_default DESC, created_at, id",
    )
    result: list[RingBufferFiltersetOut] = []
    for row in rows:
        current = await _fetch_filterset(db, row["id"])
        if current:
            result.append(current)
    return result


@router.post("/filtersets", response_model=RingBufferFiltersetOut, status_code=status.HTTP_201_CREATED)
async def create_ringbuffer_filterset(
    body: RingBufferFiltersetCreate,
    _admin: str = Depends(get_admin_user),
    db: Database = Depends(get_db),
) -> RingBufferFiltersetOut:
    return await _insert_filterset(db, payload=body)


@router.get("/filtersets/default", response_model=RingBufferFiltersetOut)
async def get_default_ringbuffer_filterset(
    _user: str = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> RingBufferFiltersetOut:
    row = await db.fetchone(
        "SELECT id FROM ringbuffer_filtersets WHERE is_default=1 ORDER BY updated_at DESC, id LIMIT 1",
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "default ringbuffer filterset not found")
    result = await _fetch_filterset(db, row["id"])
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "default ringbuffer filterset not found")
    return result


@router.get("/filtersets/{filterset_id}", response_model=RingBufferFiltersetOut)
async def get_ringbuffer_filterset(
    filterset_id: str,
    _user: str = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> RingBufferFiltersetOut:
    current = await _fetch_filterset(db, filterset_id)
    if not current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")
    return current


@router.put("/filtersets/{filterset_id}", response_model=RingBufferFiltersetOut)
async def update_ringbuffer_filterset(
    filterset_id: str,
    body: RingBufferFiltersetUpdate,
    _admin: str = Depends(get_admin_user),
    db: Database = Depends(get_db),
) -> RingBufferFiltersetOut:
    current = await _fetch_filterset(db, filterset_id)
    if not current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")

    now = _now_iso()
    name = body.name if body.name is not None else current.name
    description = body.description if body.description is not None else current.description
    dsl_version = body.dsl_version if body.dsl_version is not None else current.dsl_version
    is_active = body.is_active if body.is_active is not None else current.is_active
    is_default = body.is_default if body.is_default is not None else current.is_default
    query = body.query if body.query is not None else current.query

    if is_default:
        await db.execute("UPDATE ringbuffer_filtersets SET is_default=0")

    await db.execute(
        """UPDATE ringbuffer_filtersets
           SET name=?, description=?, dsl_version=?, is_active=?, is_default=?, query_json=?, updated_at=?
           WHERE id=?""",
        (
            name,
            description,
            dsl_version,
            int(is_active),
            int(is_default),
            _encode_query(query),
            now,
            filterset_id,
        ),
    )

    if body.groups is not None:
        await db.execute("DELETE FROM ringbuffer_filterset_groups WHERE filterset_id=?", (filterset_id,))
        for group_payload in body.groups:
            group_id = _new_id()
            group_name = group_payload.name if group_payload.name is not None else "Group"
            group_is_active = group_payload.is_active if group_payload.is_active is not None else True
            group_order = group_payload.group_order if group_payload.group_order is not None else 0
            await db.execute(
                """INSERT INTO ringbuffer_filterset_groups
                   (id, filterset_id, name, is_active, group_order, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    group_id,
                    filterset_id,
                    group_name,
                    int(group_is_active),
                    int(group_order),
                    now,
                    now,
                ),
            )
            for rule_payload in group_payload.rules or []:
                rule_name = rule_payload.name if rule_payload.name is not None else "Rule"
                rule_is_active = rule_payload.is_active if rule_payload.is_active is not None else True
                rule_order = rule_payload.rule_order if rule_payload.rule_order is not None else 0
                rule_query = rule_payload.query if rule_payload.query is not None else RingBufferQueryV2()
                await db.execute(
                    """INSERT INTO ringbuffer_filterset_rules
                       (id, group_id, name, is_active, rule_order, query_json, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        _new_id(),
                        group_id,
                        rule_name,
                        int(rule_is_active),
                        int(rule_order),
                        _encode_query(rule_query),
                        now,
                        now,
                    ),
                )

    await db.commit()
    updated = await _fetch_filterset(db, filterset_id)
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")
    return updated


@router.delete("/filtersets/{filterset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ringbuffer_filterset(
    filterset_id: str,
    _admin: str = Depends(get_admin_user),
    db: Database = Depends(get_db),
) -> None:
    row = await db.fetchone("SELECT id FROM ringbuffer_filtersets WHERE id=?", (filterset_id,))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")
    await db.execute_and_commit("DELETE FROM ringbuffer_filtersets WHERE id=?", (filterset_id,))


@router.post("/filtersets/{filterset_id}/clone", response_model=RingBufferFiltersetOut, status_code=status.HTTP_201_CREATED)
async def clone_ringbuffer_filterset(
    filterset_id: str,
    body: RingBufferFiltersetCloneRequest,
    _admin: str = Depends(get_admin_user),
    db: Database = Depends(get_db),
) -> RingBufferFiltersetOut:
    source = await _fetch_filterset(db, filterset_id)
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")

    clone_name = body.name if body.name else f"{source.name} (Copy)"
    clone_payload = RingBufferFiltersetCreate(
        name=clone_name,
        description=source.description,
        dsl_version=source.dsl_version,
        is_active=source.is_active,
        is_default=False,
        query=source.query,
        groups=[
            RingBufferFiltersetGroupCreate(
                name=group.name,
                is_active=group.is_active,
                group_order=group.group_order,
                rules=[
                    RingBufferFiltersetRuleCreate(
                        name=rule.name,
                        is_active=rule.is_active,
                        rule_order=rule.rule_order,
                        query=rule.query,
                    )
                    for rule in group.rules
                ],
            )
            for group in source.groups
        ],
    )
    return await _insert_filterset(db, payload=clone_payload)


@router.post("/filtersets/{filterset_id}/default", response_model=RingBufferFiltersetOut)
async def set_default_ringbuffer_filterset(
    filterset_id: str,
    _admin: str = Depends(get_admin_user),
    db: Database = Depends(get_db),
) -> RingBufferFiltersetOut:
    row = await db.fetchone("SELECT id FROM ringbuffer_filtersets WHERE id=?", (filterset_id,))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")
    now = _now_iso()
    await db.execute("UPDATE ringbuffer_filtersets SET is_default=0")
    await db.execute_and_commit(
        "UPDATE ringbuffer_filtersets SET is_default=1, updated_at=? WHERE id=?",
        (now, filterset_id),
    )
    result = await _fetch_filterset(db, filterset_id)
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")
    return result


@router.post("/filtersets/{filterset_id}/query", response_model=list[RingBufferEntryOut])
async def query_ringbuffer_filterset(
    filterset_id: str,
    _user: str = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[RingBufferEntryOut]:
    current = await _fetch_filterset(db, filterset_id)
    if not current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ringbuffer filterset not found")
    if not current.is_active:
        return []

    active_rules = [rule for group in current.groups if group.is_active for rule in group.rules if rule.is_active]
    if len(active_rules) > _FILTERSET_ACTIVE_RULES_CAP:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"too many active rules in filterset (max {_FILTERSET_ACTIVE_RULES_CAP})",
        )

    base_rows = await _query_v2_entries(_cap_filterset_query(current.query))
    allowed_ids = {row.id for row in base_rows}

    for rule in active_rules:
        rule_rows = await _query_v2_entries(_cap_filterset_query(rule.query))
        allowed_ids &= {row.id for row in rule_rows}
        if not allowed_ids:
            return []

    return [row for row in base_rows if row.id in allowed_ids]


@router.get("/stats", response_model=RingBufferStats)
async def ringbuffer_stats(
    _user: str = Depends(get_current_user),
) -> RingBufferStats:
    stats = await get_ringbuffer().stats()
    return RingBufferStats(**stats)


@router.post("/config", response_model=RingBufferStats)
async def configure_ringbuffer(
    body: RingBufferConfig,
    _user: str = Depends(get_current_user),
) -> RingBufferStats:
    if body.storage != "file":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "storage must be 'file' (memory and disk are no longer supported)",
        )

    rb = get_ringbuffer()
    reconfigure_kwargs: dict[str, Any] = {}
    if "max_file_size_bytes" in body.model_fields_set:
        reconfigure_kwargs["max_file_size_bytes"] = body.max_file_size_bytes
    if "max_age" in body.model_fields_set:
        reconfigure_kwargs["max_age"] = body.max_age
    await rb.reconfigure(body.storage, body.max_entries, **reconfigure_kwargs)
    stats = await rb.stats()
    return RingBufferStats(**stats)
