"""RingBuffer API — Phase 5

GET  /api/v1/ringbuffer?q=&adapter=&from=&limit=    gefilterte Einträge
GET  /api/v1/ringbuffer/stats                        Statistik
POST /api/v1/ringbuffer/config                       Speicher umschalten
"""

from __future__ import annotations

from typing import Literal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from obs.api.auth import get_current_user
from obs.ringbuffer.ringbuffer import get_ringbuffer

router = APIRouter(tags=["ringbuffer"])


# ---------------------------------------------------------------------------
# Response models
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


class RingBufferFiltersV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = ""
    time: RingBufferTimeFilterV2 | None = None
    adapters: RingBufferAdapterFilterV2 | None = None
    datapoints: RingBufferDatapointFilterV2 | None = None


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
# Routes
# ---------------------------------------------------------------------------


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

    # Build name→id lookup and find dp_ids matching q by name
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
        )
        for e in entries
    ]


@router.post("/query", response_model=list[RingBufferEntryOut])
async def query_ringbuffer_v2(
    body: RingBufferQueryV2,
    _user: str = Depends(get_current_user),
) -> list[RingBufferEntryOut]:
    from obs.core.registry import get_registry

    registry = get_registry()
    name_map: dict[str, str] = {str(dp.id): dp.name for dp in registry.all()}

    q = body.filters.q.strip()
    dp_ids_by_name: list[str] = []
    if q:
        q_lower = q.lower()
        dp_ids_by_name = [str(dp.id) for dp in registry.all() if q_lower in dp.name.lower()]

    adapters = [value.strip() for value in (body.filters.adapters.any_of if body.filters.adapters else []) if value.strip()]
    datapoints = [
        value.strip()
        for value in (body.filters.datapoints.ids if body.filters.datapoints else [])
        if value.strip()
    ]
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

    time_filter = body.filters.time
    rb = get_ringbuffer()
    try:
        entries = await rb.query_v2(
            q=q,
            adapter_any_of=adapters or None,
            datapoint_ids=datapoints or None,
            from_ts=time_filter.from_ts if time_filter else None,
            to_ts=time_filter.to_ts if time_filter else None,
            from_relative_seconds=time_filter.from_relative_seconds if time_filter else None,
            to_relative_seconds=time_filter.to_relative_seconds if time_filter else None,
            limit=body.pagination.limit,
            offset=body.pagination.offset,
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
        )
        for e in entries
    ]


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
    """Switch runtime ringbuffer configuration."""
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
