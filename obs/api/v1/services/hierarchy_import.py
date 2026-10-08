"""Reusable ETS hierarchy import service."""

from __future__ import annotations

import json
import uuid as uuid_mod
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pydantic import BaseModel, field_validator

from obs.adapters.knx.group_address import DEFAULT_GROUP_ADDRESS_STYLE, format_ga, normalize_ga, try_normalize_ga
from obs.api.v1.services.hierarchy_lifecycle import collect_hierarchy_tree_node_ids, delete_hierarchy_grants
from obs.db.database import Database

_GA_SCOPE_CHUNK_SIZE = 500
_COMMAND, _STATUS = 0, 1  # how a binding reaches an address; the command address wins


class EtsImportRequest(BaseModel):
    tree_name: str
    mode: str  # "groups" | "mid" | "flat" | "buildings" | "trades"
    auto_link: bool = True  # automatically link DataPoints via GA addresses
    replace_existing: bool = False  # replace existing auto-created ETS trees for this mode
    group_addresses: list[str] | None = None  # optional scope for current .knxproj import

    @field_validator("group_addresses")
    @classmethod
    def _internal_group_addresses(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else [normalize_ga(address) for address in value]


class ImportResult(BaseModel):
    tree_id: str
    tree_name: str
    nodes_created: int
    links_created: int = 0
    trees_replaced: int = 0
    # KNX datapoints with an address in scope that got no place in the tree (#1266)
    datapoints_unplaced: int = 0
    # Addresses in scope whose datapoints were all linked although there are several (#1266)
    addresses_shared: int = 0
    message: str


@dataclass
class _Links:
    """Datapoint links of one tree, each with the address it was made through (#1266).

    A datapoint reaching one node through several addresses is linked once, through
    its command address (``group_address``) before a status address, then the
    lowest address.
    """

    best: dict[tuple[str, str], tuple[int, str]] = field(default_factory=dict)
    addresses: set[str] = field(default_factory=set)

    def add(self, node_id: str, datapoint_id: str, kind: int, address: str) -> None:
        self.addresses.add(address)
        key = (node_id, datapoint_id)
        if key not in self.best or (kind, address) < self.best[key]:
            self.best[key] = (kind, address)

    def datapoints(self) -> set[str]:
        return {datapoint_id for _, datapoint_id in self.best}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return str(uuid_mod.uuid4())


def _ets_import_description(mode: str) -> str:
    return f"ets_import:{mode}"


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[i : i + size] for i in range(0, len(values), size)]


async def _replace_existing_ets_trees(db: Database, mode: str) -> int:
    """Delete auto-created ETS hierarchy trees for one mode, leaving manual trees untouched."""
    source = _ets_import_description(mode)
    async with db.transaction():
        rows = await db.fetchall(
            "SELECT id FROM hierarchy_trees WHERE source=?",
            (source,),
        )
        tree_ids = [row["id"] for row in rows]
        if not tree_ids:
            return 0

        node_ids = await collect_hierarchy_tree_node_ids(db, tree_ids)
        await delete_hierarchy_grants(db, node_ids)
        placeholders = ",".join("?" * len(tree_ids))
        await db.execute(
            f"DELETE FROM hierarchy_trees WHERE id IN ({placeholders})",
            tree_ids,
        )
    return len(tree_ids)


async def replace_existing_ets_trees(db: Database, mode: str) -> int:
    return await _replace_existing_ets_trees(db, mode)


async def _knx_datapoints_by_address(db: Database) -> dict[str, dict[str, int]]:
    """Address (internal) → {datapoint id: how its KNX binding reaches it}.

    Both the command (``group_address``) and the status address
    (``state_group_address``) of a binding count; stored texts are normalized, a
    text that is no group address is skipped.
    """
    rows = await db.fetchall(
        """SELECT ab.datapoint_id, ab.config
           FROM adapter_bindings ab
           JOIN datapoints dp ON dp.id = ab.datapoint_id
           WHERE UPPER(ab.adapter_type) = 'KNX'"""
    )
    by_address: dict[str, dict[str, int]] = {}
    for row in rows:
        config = json.loads(row["config"])  # NOT NULL and valid JSON, enforced by the schema
        if not isinstance(config, dict):
            continue
        for kind, key in ((_COMMAND, "group_address"), (_STATUS, "state_group_address")):
            address = try_normalize_ga(config.get(key))
            if address is None:
                continue
            reached = by_address.setdefault(address, {})
            reached[row["datapoint_id"]] = min(kind, reached.get(row["datapoint_id"], kind))
    return by_address


async def _group_address_rows(db: Database, scope: list[str] | None) -> list:
    columns = "address, name, description, main_group_name, mid_group_name, group_ranges"
    if scope is None:
        return await db.fetchall(f"SELECT {columns} FROM knx_group_addresses ORDER BY address")
    rows = []
    for chunk in _chunks(list(dict.fromkeys(scope)), _GA_SCOPE_CHUNK_SIZE):
        placeholders = ",".join("?" * len(chunk))
        rows.extend(await db.fetchall(f"SELECT {columns} FROM knx_group_addresses WHERE address IN ({placeholders})", chunk))
    return sorted(rows, key=lambda row: row["address"])


def _range_chain(row, style: str) -> list[tuple[tuple, str, int]]:
    """(identity, label, order) of the group ranges containing ``row``'s address, outermost first.

    From the ETS ranges recorded by the ``.knxproj`` import (#1266), so two-level
    and free projects keep their own layout. Rows imported before #1266 have none
    recorded (NULL): they fall back to the stored main/middle group names, as
    before, until the next import.
    """
    if row["group_ranges"] is None:
        main, mid, _ = str(row["address"]).split("/")
        return [
            (("main", main), str(row["main_group_name"] or "").strip() or f"Hauptgruppe {main}", int(main)),
            (("mid", main, mid), str(row["mid_group_name"] or "").strip() or f"Mittelgruppe {mid}", int(mid)),
        ]
    chain = []
    identity: tuple = ()
    for group_range in json.loads(row["group_ranges"]):
        start, end = int(group_range["start"]), int(group_range["end"])
        identity = (*identity, (start, end))
        label = str(group_range.get("name") or "").strip()
        if not label:
            label = f"{format_ga(normalize_ga(str(start)), style)} – {format_ga(normalize_ga(str(end)), style)}"
        chain.append((identity, label, start))
    return chain


async def create_ets_hierarchy(db: Database, request: EtsImportRequest) -> ImportResult:
    """Create a hierarchy tree from already imported ETS data."""
    if request.mode not in ("groups", "mid", "flat", "buildings", "trades"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "mode muss 'groups', 'mid', 'flat', 'buildings' oder 'trades' sein",
        )

    now = _now()
    tree_id = _new_id()
    nodes_created = 0

    # Batch all node inserts; commit once at the end for performance.
    inserts: list[tuple] = []
    links = _Links()
    device_link_sentinels: set[tuple[str, str]] = set()
    # Addresses whose datapoints belong into this tree, for counting what got no place.
    scope_addresses: set[str] = set()

    def _q_insert(nid: str, parent_id: str | None, name: str, desc: str, order: int) -> None:
        inserts.append((nid, tree_id, parent_id, name, desc, order, None, now, now))

    datapoints_by_address = await _knx_datapoints_by_address(db) if request.auto_link else {}

    if request.mode in ("groups", "mid", "flat"):
        rows = await _group_address_rows(db, request.group_addresses)
        if not rows:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Keine ETS-Gruppenadressen importiert. Bitte zuerst eine .knxproj importieren.",
            )
        style_row = await db.fetchone("SELECT group_address_style FROM knx_project WHERE id = 1")
        style = style_row["group_address_style"] if style_row else DEFAULT_GROUP_ADDRESS_STYLE

        # The tree follows the ETS group ranges (#1266): "groups" hangs a node per
        # address under its innermost range, "mid" links the datapoint to that range
        # itself, "flat" keeps only the outermost range. An address outside every
        # range gets its own node at the top.
        range_nodes: dict[tuple, str] = {}
        for row in rows:
            address = str(row["address"])
            if try_normalize_ga(address) != address:
                continue  # a legacy text that is no group address (V56 leaves those alone)
            scope_addresses.add(address)
            chain = _range_chain(row, style)
            if request.mode == "flat":
                chain = chain[:1]
            parent = None
            for identity, label, order in chain:
                if identity not in range_nodes:
                    range_nodes[identity] = _new_id()
                    _q_insert(range_nodes[identity], parent, label, "", order)
                    nodes_created += 1
                parent = range_nodes[identity]
            if request.mode == "mid" and parent is not None:
                target = parent
            else:
                target = _new_id()
                _q_insert(target, parent, str(row["name"]).strip() or address, str(row["description"] or ""), 0)
                nodes_created += 1
            for datapoint_id, kind in datapoints_by_address.get(address, {}).items():
                links.add(target, datapoint_id, kind, address)

    elif request.mode == "buildings":
        loc_rows = await db.fetchall("SELECT id, parent_id, name, space_type, sort_order FROM knx_locations ORDER BY sort_order")
        if not loc_rows:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Keine Gebäude-Daten importiert. Bitte zuerst eine .knxproj importieren.",
            )

        loc_to_node: dict[str, str] = {}
        for loc in loc_rows:
            nid = _new_id()
            parent_nid = loc_to_node.get(loc["parent_id"]) if loc["parent_id"] else None
            _q_insert(nid, parent_nid, loc["name"] or loc["id"], loc["space_type"] or "", loc["sort_order"])
            loc_to_node[loc["id"]] = nid
            nodes_created += 1

        if request.auto_link:
            # Room › ETS function › datapoint (#1266): projects that name their
            # addresses generically ("Schalten") tell them apart through the function.
            scope_addresses = await _scope_addresses(db, request.group_addresses)
            fn_rows = await db.fetchall(
                """SELECT f.id, f.space_id, f.name, f.usage_text, l.ga_address
                   FROM knx_functions f
                   JOIN knx_function_ga_links l ON l.function_id = f.id
                   ORDER BY f.name, f.id"""
            )
            function_nodes: dict[str, str] = {}
            for fr in fn_rows:
                space_node = loc_to_node.get(fr["space_id"])
                if not space_node or fr["ga_address"] not in scope_addresses:
                    continue
                if fr["id"] not in function_nodes:
                    function_nodes[fr["id"]] = _new_id()
                    _q_insert(function_nodes[fr["id"]], space_node, fr["name"] or fr["id"], fr["usage_text"] or "", len(function_nodes))
                    nodes_created += 1
                for datapoint_id, kind in datapoints_by_address.get(fr["ga_address"], {}).items():
                    links.add(function_nodes[fr["id"]], datapoint_id, kind, fr["ga_address"])

        device_rows = await db.fetchall("SELECT space_id, device_id FROM knx_space_device_links")
        for row in device_rows:
            node_id = loc_to_node.get(row["space_id"])
            if not node_id:
                continue
            device_link_sentinels.add((node_id, row["device_id"]))

        inferred_device_rows = await db.fetchall(
            """SELECT co.device_id, MIN(f.space_id) AS space_id
               FROM knx_comm_objects co
               JOIN knx_co_ga_links cgl ON cgl.comm_object_id = co.id
               JOIN knx_function_ga_links fgl ON fgl.ga_address = cgl.ga_address
               JOIN knx_functions f ON f.id = fgl.function_id
               WHERE f.space_id IS NOT NULL AND f.space_id != ''
               GROUP BY co.device_id
               HAVING COUNT(DISTINCT f.space_id) = 1"""
        )
        for row in inferred_device_rows:
            node_id = loc_to_node.get(row["space_id"])
            if not node_id:
                continue
            device_link_sentinels.add((node_id, row["device_id"]))

    else:  # "trades"
        trade_rows = await db.fetchall("SELECT id, name, parent_id, sort_order FROM knx_trades ORDER BY sort_order")
        if not trade_rows:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Keine Gewerke-Daten importiert. Bitte zuerst eine .knxproj importieren (die Datei muss einen <Trades>-Abschnitt enthalten).",
            )

        fn_count_row = await db.fetchone("SELECT COUNT(*) AS cnt FROM knx_functions WHERE trade_id IS NOT NULL")
        has_fn_links = fn_count_row and (fn_count_row["cnt"] or 0) > 0
        if request.auto_link:
            scope_addresses = await _scope_addresses(db, request.group_addresses)

        trade_id_to_nid: dict[str, str] = {}
        for trade in trade_rows:
            parent_trade_id = trade["parent_id"]
            parent_nid = trade_id_to_nid.get(parent_trade_id) if parent_trade_id else None
            trade_nid = _new_id()
            _q_insert(trade_nid, parent_nid, trade["name"] or trade["id"], "", trade["sort_order"])
            trade_id_to_nid[trade["id"]] = trade_nid
            nodes_created += 1

            if not has_fn_links:
                continue

            fn_rows = await db.fetchall(
                "SELECT id, name, usage_text FROM knx_functions WHERE trade_id = ? ORDER BY name",
                (trade["id"],),
            )
            for fn in fn_rows:
                fn_nid = _new_id()
                fn_label = fn["name"] or fn["id"]
                fn_desc = fn["usage_text"] or ""
                _q_insert(fn_nid, trade_nid, fn_label, fn_desc, nodes_created)
                nodes_created += 1

                if not request.auto_link:
                    continue

                ga_rows = await db.fetchall(
                    "SELECT ga_address FROM knx_function_ga_links WHERE function_id = ?",
                    (fn["id"],),
                )
                for ga_row in ga_rows:
                    if ga_row["ga_address"] not in scope_addresses:
                        continue
                    for datapoint_id, kind in datapoints_by_address.get(ga_row["ga_address"], {}).items():
                        links.add(fn_nid, datapoint_id, kind, ga_row["ga_address"])

    links_created = len(links.best)
    in_scope = {datapoint_id for address in scope_addresses for datapoint_id in datapoints_by_address.get(address, {})}
    datapoints_unplaced = len(in_scope - links.datapoints())
    addresses_shared = sum(1 for address in links.addresses if len(datapoints_by_address[address]) > 1)

    trees_replaced = 0
    if request.replace_existing:
        trees_replaced = await _replace_existing_ets_trees(db, request.mode)

    await db.execute_and_commit(
        "INSERT INTO hierarchy_trees (id, name, description, source, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (tree_id, request.tree_name, _ets_import_description(request.mode), _ets_import_description(request.mode), now, now),
    )
    # Every tree gets an implicit, hidden root node so a Logic graph can be
    # linked directly "to the tree" without a visible child folder (#1217
    # follow-up) — see _migration_v54_hierarchy_tree_root_nodes.
    await db.execute_and_commit(
        """INSERT INTO hierarchy_nodes
               (id, tree_id, parent_id, name, description, node_order, icon, is_tree_root, created_at, updated_at)
           VALUES (?,?,NULL,?,'',-1,NULL,1,?,?)""",
        (_new_id(), tree_id, request.tree_name, now, now),
    )

    if inserts:
        await db.executemany(
            """INSERT INTO hierarchy_nodes
               (id, tree_id, parent_id, name, description, node_order, icon, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            inserts,
        )

    if links.best:
        await db.executemany(
            "INSERT OR IGNORE INTO hierarchy_datapoint_links (id, node_id, datapoint_id, group_address, created_at) VALUES (?,?,?,?,?)",
            [(_new_id(), node_id, datapoint_id, address, now) for (node_id, datapoint_id), (_, address) in links.best.items()],
        )

    if device_link_sentinels:
        await db.executemany(
            "INSERT OR IGNORE INTO hierarchy_device_links (id, node_id, device_id, created_at) VALUES (?,?,?,?)",
            [(_new_id(), node_id, device_id, now) for node_id, device_id in device_link_sentinels],
        )

    await db.commit()

    return ImportResult(
        tree_id=tree_id,
        tree_name=request.tree_name,
        nodes_created=nodes_created,
        links_created=links_created,
        trees_replaced=trees_replaced,
        datapoints_unplaced=datapoints_unplaced,
        addresses_shared=addresses_shared,
        message=f"Hierarchiebaum '{request.tree_name}' mit {nodes_created} Knoten erstellt"
        + (f" ({trees_replaced} bestehende ETS-Hierarchien ersetzt)" if trees_replaced else "")
        + (f", {links_created} DataPoints automatisch verknüpft" if links_created else "")
        + (f", {addresses_shared} Gruppenadressen mit mehreren Datenpunkten (alle verknüpft)" if addresses_shared else "")
        + (f", {datapoints_unplaced} Datenpunkte ohne Platz in diesem Baum" if datapoints_unplaced else ""),
    )


async def _scope_addresses(db: Database, scope: list[str] | None) -> set[str]:
    """Addresses whose datapoints belong into a building or trade tree: the import's, else all known."""
    if scope is not None:
        return set(scope)
    return {row["address"] for row in await db.fetchall("SELECT address FROM knx_group_addresses")}
