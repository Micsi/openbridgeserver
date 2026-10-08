"""Search API — Phase 4 / Issue #182

GET /api/v1/search?q=&tag=&type=&adapter=&quality=&sort=name&order=asc&page=0&size=50

Server-side filtered search over DataPoints.
  q       — substring match on name OR UUID OR any binding config field (case-insensitive)
  tag     — exact tag match
  type    — data_type match (e.g. FLOAT)
  adapter — comma-separated adapter_type list (OR logic), at least one binding required
  quality — runtime quality filter: good | bad | uncertain
  device  — comma-separated KNX device physical addresses (OR logic), datapoints on their group addresses
  knx_linked — true: KNX group address linked to a device; false: KNX group addresses, none linked
               (GET /api/v1/search/knx-device-data says whether any device data is visible)
  sort    — sort column: name | data_type | created_at | updated_at  (default: name)
  order   — sort direction: asc | desc                               (default: asc)
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from obs.adapters.knx.group_address import try_normalize_ga
from obs.api.auth import Principal, get_current_principal
from obs.api.authz import AuthzAction, AuthzTarget, authorize
from obs.api.authz_service import filter_authorized_datapoints, load_role_grants, resolve_hierarchy_targets
from obs.api.v1.datapoints import _SORT_KEYS, DataPointOut, HierarchyNodeRef, NodePathSegment, _enrich
from obs.api.v1.knxproj import _authorized_knx_device_scope, _authorized_knx_group_addresses, _principal_from_dependency
from obs.api.v1.services.knx_traceability import _extract_knx_ga_roles, group_addresses_by_device
from obs.core.registry import get_registry
from obs.db.database import Database, get_db

router = APIRouter(tags=["search"])


class SearchPage(BaseModel):
    items: list[DataPointOut]
    total: int
    page: int
    size: int
    pages: int
    query: dict


class KnxDeviceDataOut(BaseModel):
    # True when a group address is linked to a KNX device the caller may see (#1266):
    # without device data, ``knx_linked=true`` can only ever match nothing.
    knx_device_data: bool


async def _filter_authorized_hierarchy_rows(
    db: Database,
    principal: Principal,
    rows: list,
) -> list:
    if principal.type == "user" and principal.is_admin:
        return rows

    node_ids = [row["node_id"] for row in rows]
    targets_by_node = {target.node_id: target for target in await resolve_hierarchy_targets(db, node_ids)}
    grants = await load_role_grants(db, principal)
    return [
        row
        for row in rows
        if (target := targets_by_node.get(row["node_id"]))
        and authorize(principal=principal, action=AuthzAction.READ, targets=[target], grants=grants).allowed
    ]


async def _add_hierarchy(items: list[DataPointOut], db: Database, principal: Principal | None = None) -> None:
    """Batch-query hierarchy node links and inject into items in-place.

    Also computes each node's ancestor path (root → leaf, excluding tree name)
    so the frontend can disambiguate same-named leaves under different parents
    (e.g. "Gebäude › EG › Küche" vs "Gebäude › OG › Küche") — see #433.
    """
    if not items:
        return
    dp_ids = [str(item.id) for item in items]
    placeholders = ",".join("?" * len(dp_ids))
    rows = await db.fetchall(
        f"""SELECT hdl.datapoint_id, hdl.group_address, hn.id AS node_id, hn.name AS node_name,
                   ht.id AS tree_id, ht.name AS tree_name, ht.display_depth
            FROM hierarchy_datapoint_links hdl
            JOIN hierarchy_nodes hn ON hn.id = hdl.node_id
            JOIN hierarchy_trees ht ON ht.id = hn.tree_id
            WHERE hdl.datapoint_id IN ({placeholders})
            ORDER BY ht.name, hn.name""",
        dp_ids,
    )
    if principal is not None:
        rows = await _filter_authorized_hierarchy_rows(db, principal, rows)
    # Build ancestor paths for all linked nodes via recursive CTE (upstream
    # PR #462) — produces the richer node_path schema (objects with stable
    # node_id + node_name per segment) that the epic switched to during the
    # merge. The epic's earlier in-memory walker over a full hierarchy_nodes
    # SELECT is dropped: the CTE scales with the actual matched node set
    # instead of the whole tree.
    node_ids = list({r["node_id"] for r in rows})
    node_paths: dict[str, list[NodePathSegment]] = {}
    if node_ids:
        ph2 = ",".join("?" * len(node_ids))
        path_rows = await db.fetchall(
            f"""WITH RECURSIVE anc(leaf_id, cur_id, cur_name, cur_parent, depth) AS (
                SELECT id, id, name, parent_id, 0 FROM hierarchy_nodes WHERE id IN ({ph2})
                UNION ALL
                SELECT a.leaf_id, hn2.id, hn2.name, hn2.parent_id, a.depth + 1
                FROM anc a JOIN hierarchy_nodes hn2 ON hn2.id = a.cur_parent
                WHERE a.cur_parent IS NOT NULL
            )
            SELECT leaf_id, cur_id, cur_name FROM anc WHERE depth > 0
            ORDER BY leaf_id, depth DESC""",
            node_ids,
        )
        for r in path_rows:
            node_paths.setdefault(r["leaf_id"], []).append(NodePathSegment(node_id=r["cur_id"], node_name=r["cur_name"]))

    by_dp: dict[str, list[HierarchyNodeRef]] = {}
    for r in rows:
        by_dp.setdefault(r["datapoint_id"], []).append(
            HierarchyNodeRef(
                node_id=r["node_id"],
                node_name=r["node_name"],
                tree_id=r["tree_id"],
                tree_name=r["tree_name"],
                node_path=node_paths.get(r["node_id"], []),
                display_depth=r["display_depth"] if r["display_depth"] is not None else 0,
                group_address=r["group_address"],
            )
        )
    for item in items:
        item.hierarchy_nodes = by_dp.get(str(item.id), [])


async def _visible_bindings(db: Database, principal: Principal, rows: list) -> list:
    """Keep the binding rows on adapter instances the caller may read, like ``GET /datapoints/{id}/bindings``."""
    if principal.type == "user" and principal.is_admin:
        return rows
    grants = await load_role_grants(db, principal, node_type="adapter_instance")
    return [
        row
        for row in rows
        if row["adapter_instance_id"] is None
        or authorize(
            principal=principal,
            action=AuthzAction.READ,
            targets=[AuthzTarget(node_type="adapter_instance", node_id=row["adapter_instance_id"], min_role="guest")],
            grants=grants,
        ).allowed
    ]


async def _knx_group_addresses_by_datapoint(db: Database) -> dict[str, set[str]]:
    """Datapoint id → command and status group addresses of its KNX bindings.

    The addresses are taken from a binding the way the device view does (``_extract_knx_ga_roles``),
    from every KNX binding as there: who may see which address is decided by the device view's
    scope (``_authorized_knx_group_addresses``), not by instance grants.
    """
    rows = await db.fetchall("SELECT datapoint_id, config FROM adapter_bindings WHERE UPPER(adapter_type) = 'KNX'")
    by_dp: dict[str, set[str]] = {}
    for row in rows:
        # adapter_bindings.config is valid JSON (CHECK json_valid).
        addresses = {address for _, address in _extract_knx_ga_roles(json.loads(row["config"]))}
        if addresses:
            by_dp.setdefault(row["datapoint_id"], set()).update(addresses)
    return by_dp


async def _filter_by_knx_devices(
    db: Database,
    principal: Principal,
    results: list,
    device_list: list[str],
    knx_linked: bool | None,
) -> list:
    """Keep the datapoints on the given devices and/or with(out) a device-linked group address (#1266).

    A datapoint belongs to a device when one of its KNX bindings carries, as command or status
    address, a group address a communication object of the device links. For non-admins a linked
    address counts only where the device view shows it to them (``_authorized_knx_group_addresses``:
    an enabled binding of a readable datapoint carries it), so filters, ``/knx-device-data`` and
    the device view share one notion of rights. ``results`` must already have passed the read
    check: it is reused as known readable.
    """
    by_device = await group_addresses_by_device(db)
    addresses_by_dp = await _knx_group_addresses_by_datapoint(db)
    if not (principal.type == "user" and principal.is_admin):
        result_ids = {str(dp.id) for dp in results}
        linked = set().union(*by_device.values())
        relevant = set().union(*(addresses_by_dp.get(dp_id, set()) for dp_id in result_ids)) & linked
        allowed = await _authorized_knx_group_addresses(db, principal, sorted(relevant), known_readable=result_ids)
        by_device = {pa: addresses & allowed for pa, addresses in by_device.items()}
    if device_list:
        wanted = set().union(*(by_device.get(pa, set()) for pa in device_list))
        results = [dp for dp in results if addresses_by_dp.get(str(dp.id), set()) & wanted]
    if knx_linked is not None:
        linked = set().union(*by_device.values())
        results = [dp for dp in results if str(dp.id) in addresses_by_dp and bool(addresses_by_dp[str(dp.id)] & linked) == knx_linked]
    return results


async def _add_command_group_address(items: list[DataPointOut], db: Database, principal: Principal) -> None:
    """Set each item's ``group_address``: the command group address of its KNX binding (#1266).

    The datapoint picker shows it where same-named rows would otherwise look alike.
    With several KNX bindings a writing one (DEST/BOTH) wins over a reading one
    (SOURCE), then the oldest (``created_at``, then ``id``). A binding whose stored
    address is no group address is skipped; the address is returned in the internal
    notation. Non-admins only get addresses of bindings on adapter instances they may
    read, like ``GET /api/v1/datapoints/{id}/bindings``.

    The address a hierarchy link was made through (``hierarchy_nodes[].group_address``)
    passes the same filter: it stays only while a binding the caller may see carries
    it as command or status address, so it never reveals more than the bindings do.
    """
    if not items:
        return
    dp_ids = [str(item.id) for item in items]
    placeholders = ",".join("?" * len(dp_ids))
    rows = await db.fetchall(
        f"""SELECT datapoint_id, adapter_instance_id,
                   JSON_EXTRACT(config, '$.group_address') AS group_address,
                   JSON_EXTRACT(config, '$.state_group_address') AS state_group_address
            FROM adapter_bindings
            WHERE UPPER(adapter_type) = 'KNX' AND datapoint_id IN ({placeholders})
            ORDER BY CASE WHEN direction IN ('DEST', 'BOTH') THEN 0 ELSE 1 END, created_at, id""",
        dp_ids,
    )
    rows = await _visible_bindings(db, principal, rows)
    by_dp: dict[str, str] = {}
    visible: dict[str, set[str | None]] = {}
    for row in rows:
        address = try_normalize_ga(row["group_address"])
        visible.setdefault(row["datapoint_id"], set()).update((address, try_normalize_ga(row["state_group_address"])))
        if address and row["datapoint_id"] not in by_dp:
            by_dp[row["datapoint_id"]] = address
    for item in items:
        item.group_address = by_dp.get(str(item.id))
        for ref in item.hierarchy_nodes:
            if ref.group_address not in visible.get(str(item.id), set()):
                ref.group_address = None


@router.get("/", response_model=SearchPage)
async def search(
    q: str = Query("", description="Substring match on name, UUID, or binding config fields"),
    tag: str = Query("", description="Comma-separated tag list — OR logic (e.g. 'heating,lighting')"),
    type: str = Query("", description="data_type match"),
    adapter: str = Query(
        "",
        description="Comma-separated adapter_type list — OR logic (e.g. 'KNX,MQTT')",
    ),
    quality: str = Query("", description="Runtime quality filter: good | bad | uncertain"),
    node_id: str = Query("", description="Comma-separated node IDs — OR logic"),
    tree_id: str = Query("", description="Comma-separated tree IDs — matches any node in these trees"),
    device: Annotated[
        str,
        Query(description="Comma-separated KNX device physical addresses — OR logic; datapoints bound to a group address of the device"),
    ] = "",
    knx_linked: Annotated[
        bool | None,
        Query(description="true: KNX group address linked to a device; false: KNX group addresses, none linked to a device"),
    ] = None,
    sort: str = Query("name", pattern="^(name|data_type|created_at|updated_at)$"),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    page: int = Query(0, ge=0),
    size: int = Query(50, ge=1, le=500),
    _user: Principal | str = Depends(get_current_principal),
    db: Database = Depends(lambda: get_db()),
) -> SearchPage:
    principal = _user if isinstance(_user, Principal) else Principal(subject=_user, type="user", is_admin=_user == "admin")
    reg = get_registry()
    results = reg.all()

    # 1. type filter (cheap, in-memory)
    if type:
        results = [dp for dp in results if dp.data_type == type]

    # 2. tag filter (cheap, in-memory) — comma-separated, OR logic
    if tag:
        tag_list = [t.strip() for t in tag.split(",") if t.strip()]
        results = [dp for dp in results if any(t in dp.tags for t in tag_list)]

    # 3. adapter filter (one DB query) — comma-separated, OR logic
    if adapter:
        adapter_list = [a.strip() for a in adapter.split(",") if a.strip()]
        if adapter_list:
            placeholders = ",".join("?" * len(adapter_list))
            rows = await db.fetchall(
                f"SELECT DISTINCT datapoint_id FROM adapter_bindings WHERE adapter_type IN ({placeholders})",
                adapter_list,
            )
            matched_ids = {r["datapoint_id"] for r in rows}
            results = [dp for dp in results if str(dp.id) in matched_ids]

    # 4. q filter: all-token match on name, UUID, or binding config text (one DB query)
    #
    # The query is split into whitespace-separated tokens.  A DataPoint matches
    # if every token appears in the name  — OR  every token appears in the UUID
    # — OR every token appears in the concatenated binding config text.
    # This lets "u04 temperatur" find "U04 Präsenzmelder 01 Temperatur" even
    # though the words are not adjacent.
    if q:
        tokens = q.lower().split()

        # Pre-fetch all binding configs in one query to avoid N+1 DB hits.
        config_rows = await db.fetchall("SELECT datapoint_id, config FROM adapter_bindings")
        # Concatenate all config JSON strings per datapoint_id for substring search.
        binding_texts: dict[str, str] = {}
        for row in config_rows:
            dp_id_str = row["datapoint_id"]
            binding_texts[dp_id_str] = binding_texts.get(dp_id_str, "") + " " + (row["config"] or "").lower()

        def _matches(dp) -> bool:
            name_text = dp.name.lower()
            uuid_text = str(dp.id).lower()
            config_text = binding_texts.get(str(dp.id), "")
            return all(t in name_text for t in tokens) or all(t in uuid_text for t in tokens) or all(t in config_text for t in tokens)

        results = [dp for dp in results if _matches(dp)]

    # 5a. node_id filter — includes selected nodes AND all their descendants
    if node_id:
        node_id_list = [n.strip() for n in node_id.split(",") if n.strip()]
        if node_id_list:
            placeholders = ",".join("?" * len(node_id_list))
            rows = await db.fetchall(
                f"""WITH RECURSIVE desc(id) AS (
                    SELECT id FROM hierarchy_nodes WHERE id IN ({placeholders})
                    UNION ALL
                    SELECT hn.id FROM hierarchy_nodes hn JOIN desc d ON hn.parent_id = d.id
                )
                SELECT DISTINCT hdl.datapoint_id, hdl.node_id
                FROM hierarchy_datapoint_links hdl
                JOIN desc d ON hdl.node_id = d.id""",
                node_id_list,
            )
            rows = await _filter_authorized_hierarchy_rows(db, principal, rows)
            matched_ids = {r["datapoint_id"] for r in rows}
            results = [dp for dp in results if str(dp.id) in matched_ids]

    # 5b. tree_id filter (all nodes in these trees — OR logic)
    if tree_id:
        tree_id_list = [t.strip() for t in tree_id.split(",") if t.strip()]
        if tree_id_list:
            placeholders = ",".join("?" * len(tree_id_list))
            rows = await db.fetchall(
                f"""SELECT DISTINCT hdl.datapoint_id, hdl.node_id
                    FROM hierarchy_datapoint_links hdl
                    JOIN hierarchy_nodes hn ON hn.id = hdl.node_id
                    WHERE hn.tree_id IN ({placeholders})""",
                tree_id_list,
            )
            rows = await _filter_authorized_hierarchy_rows(db, principal, rows)
            matched_ids = {r["datapoint_id"] for r in rows}
            results = [dp for dp in results if str(dp.id) in matched_ids]

    # 6. quality filter (runtime, must come after cheaper filters)
    if quality:

        def _quality_of(dp) -> str:
            state = reg.get_value(dp.id)
            # DataPoints that have never received a value have no ValueState →
            # treat them as "uncertain", consistent with the /value endpoint.
            return state.quality if state else "uncertain"

        results = [dp for dp in results if _quality_of(dp) == quality]

    # 7. AuthZ read scope filter
    if results and not (principal.type == "user" and principal.is_admin):
        authorized_ids = set(
            await filter_authorized_datapoints(
                db,
                principal,
                [str(dp.id) for dp in results],
                action=AuthzAction.READ,
            )
        )
        results = [dp for dp in results if str(dp.id) in authorized_ids]

    # 7b. KNX device filters (#1266) – after the read check, which they build on
    device_list = [d.strip() for d in device.split(",") if d.strip()]
    if device_list or knx_linked is not None:
        results = await _filter_by_knx_devices(db, principal, results, device_list, knx_linked)

    # 8. Sort
    results = sorted(results, key=_SORT_KEYS[sort], reverse=(order == "desc"))

    # 9. Paginate
    total = len(results)
    offset = page * size
    items = [_enrich(dp) for dp in results[offset : offset + size]]

    # 10. Enrich with hierarchy node assignments (single batch query)
    await _add_hierarchy(items, db, principal)
    await _add_command_group_address(items, db, principal)

    return SearchPage(
        items=items,
        total=total,
        page=page,
        size=size,
        pages=max(1, (total + size - 1) // size),
        query={
            "q": q,
            "tag": tag,
            "type": type,
            "adapter": adapter,
            "quality": quality,
            "node_id": node_id,
            "tree_id": tree_id,
            "device": device,
            "knx_linked": knx_linked,
            "sort": sort,
            "order": order,
        },
    )


@router.get("/knx-device-data", response_model=KnxDeviceDataOut)
async def knx_device_data(
    _user: Principal | str = Depends(get_current_principal),
    db: Database = Depends(lambda: get_db()),
) -> KnxDeviceDataOut:
    """Whether the imported project links group addresses to KNX devices the caller may see (#1266).

    A project imported without devices (or a caller the device view shows no device) has none,
    so ``knx_linked=true`` would hide every datapoint: the picker switches that filter off.
    """
    principal = _principal_from_dependency(_user)
    if principal.type == "user" and principal.is_admin:
        return KnxDeviceDataOut(knx_device_data=bool(await group_addresses_by_device(db)))
    allowed_device_ids, _ = await _authorized_knx_device_scope(db, principal)
    return KnxDeviceDataOut(knx_device_data=bool(allowed_device_ids))
