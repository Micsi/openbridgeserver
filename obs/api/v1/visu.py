"""Visu API — /api/v1/visu/...

Endpoints:
  GET    /visu/tree                      → Gesamtbaum (flach)
  GET    /visu/nodes/{id}                → Einzelner Knoten
  POST   /visu/nodes                     → Knoten erstellen
  POST   /visu/nodes/import              → Teilbaum importieren
  PATCH  /visu/nodes/{id}                → Knoten bearbeiten
  DELETE /visu/nodes/{id}                → Knoten löschen
  GET    /visu/nodes/{id}/breadcrumb     → Breadcrumb-Pfad
  GET    /visu/nodes/{id}/children       → Direkte Kinder
  POST   /visu/nodes/{id}/copy           → Knoten kopieren
  PUT    /visu/nodes/{id}/move           → Knoten verschieben
  GET    /visu/nodes/{id}/export         → Teilbaum als JSON exportieren
  POST   /visu/nodes/{id}/auth           → PIN-Authentifizierung

  GET    /visu/pages/{id}                → page_config lesen
  PUT    /visu/pages/{id}                → page_config speichern

  GET    /visu/nodes/{id}/versions       → Verlauf einer Seite (M5 C6, E12)
  GET    /visu/nodes/{id}/versions/{rev} → ein früherer Stand als PageConfig

Zum Verlauf gibt es bewusst **keinen** Schreib-Endpunkt: Wiederherstellen ist das
Lesen eines alten Standes und ein gewöhnliches ``PUT /visu/pages/{id}`` damit.
Auf ``page_config`` schreiben im Editor bereits zwei Stellen unabhängig
voneinander (Micsi/openbridgeserver#187); ein eigener Restore-Pfad wäre die
nächste Stelle, an der „der letzte gewinnt" entsteht - und er käme an
``_validate_page_kind_config`` und der Zugriffsprüfung vorbei.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from obs.api.auth import Principal, get_admin_user, get_current_principal, limiter
from obs.api.authz import AuthzAction, authorize
from obs.api.authz_service import (
    authorize_visu_page,
    filter_authorized_datapoints,
    load_role_grants,
    resolve_visu_page_targets,
)
from obs.api.capabilities import ConfigCapability, audit_config_capability_use, require_config_capability
from obs.api.v1.application_audit import audit_application_contract, write_application_success
from obs.api.v1.datapoint_config import collect_datapoint_ids_from_config, is_uuid_str
from obs.api.v1.sessions import create_session, validate_session
from obs.db.database import Database, get_db
from obs.models.visu import (
    CopyNodeRequest,
    MoveNodeRequest,
    PageConfig,
    PageKind,
    PinAuthRequest,
    PinAuthResponse,
    PopupConfig,
    VisuImportRequest,
    VisuNode,
    VisuNodeCreate,
    VisuNodeSummary,
    VisuNodeUpdate,
    VisuNodeUsersUpdate,
    VisuPageVersion,
    WidgetInstance,
    WidgetRefInstance,
)

router = APIRouter(tags=["visu"])
_visu_bearer = HTTPBearer(auto_error=False)
_visu_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_UNSET = object()

# ── Hilfsfunktionen ───────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _row_to_node(row, *, access: str | None = None) -> VisuNode:
    """SQLite-Row → VisuNode Pydantic-Modell.

    Erwartet die **volle** Zeile (alle Leser holen ``SELECT vn.*``). Ein stiller
    Default für ``kind`` wäre kein Schutz: ein künftiger schmaler SELECT bekäme
    dann eine falsche Antwort statt eines Fehlers.
    """
    pc_raw = row["page_config"]
    pc = json.loads(pc_raw) if pc_raw else None
    return VisuNode(
        id=row["id"],
        parent_id=row["parent_id"],
        name=row["name"],
        type=row["type"],
        kind=row["kind"],
        order=row["node_order"],
        icon=row["icon"],
        access=access,
        access_pin=None,  # PIN-Hash niemals in der API zurückgeben
        page_config=PageConfig(**pc) if pc else None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_summary(
    row,
    *,
    access: str | None = None,
    parent_id: str | None | object = _UNSET,
    has_pin: bool | None = None,
) -> VisuNodeSummary:
    """SQLite row to the deliberately redacted navigation DTO."""
    return VisuNodeSummary(
        id=row["id"],
        parent_id=row["parent_id"] if parent_id is _UNSET else parent_id,
        name=row["name"],
        type=row["type"],
        kind=row["kind"],
        order=row["node_order"],
        icon=row["icon"],
        access=access,
        has_pin=has_pin,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _may_see_pin_state(principal: Principal | None) -> bool:
    """Wem die Antwort ``has_pin`` überhaupt ausweist.

    Nur einem angemeldeten Admin - also genau dem, der das Editorwerkzeug
    bedient und die fehlende PIN auch setzen kann. Für jeden anderen bleibt das
    Feld ``None``: der Baum ist die Navigationsantwort und geht auch anonym
    hinaus, und wie eine geschützte Seite ausgestattet ist, ist keine
    Navigationsangabe. Der Zugriffsschutz hängt nicht daran (eine Seite ohne
    PIN-Zeile ist fehlerschließend zu, mit Angabe wie ohne) - es ist die
    Zurückhaltung, nicht der Riegel.
    """
    return principal is not None and principal.type == "user" and principal.is_admin


async def _nodes_with_pin(db: Database) -> set[str]:
    rows = await db.fetchall("SELECT node_id FROM authz_visu_page_credentials")
    return {row["node_id"] for row in rows}


async def _get_node_or_404(db: Database, node_id: str) -> VisuNode:
    row = await db.fetchone(
        """SELECT vn.*, avp.access_mode
           FROM visu_nodes AS vn
           LEFT JOIN authz_visu_page_policies AS avp ON avp.node_id = vn.id
           WHERE vn.id = ?""",
        (node_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Knoten nicht gefunden")
    access = row["access_mode"] if "access_mode" in row.keys() else None  # noqa: SIM118 -- sqlite Row membership checks values
    return _row_to_node(row, access=access)


async def _resolve_access(db: Database, node_id: str) -> str:
    """Traversiert die parent_id-Kette und gibt das effektive Access-Level zurück."""
    current_id: str | None = node_id
    while current_id:
        row = await db.fetchone(
            """SELECT vn.parent_id, avp.access_mode
               FROM visu_nodes AS vn
               LEFT JOIN authz_visu_page_policies AS avp ON avp.node_id = vn.id
               WHERE vn.id = ?""",
            (current_id,),
        )
        if not row:
            break
        access_mode = row["access_mode"] if "access_mode" in row.keys() else row["access"]  # noqa: SIM118 -- sqlite Row membership checks values
        if access_mode is not None:
            return access_mode
        current_id = row["parent_id"]
    return "public"  # Fallback: kein Knoten hat explizites Access → public


async def _resolve_access_with_node(db: Database, node_id: str) -> tuple[str, str | None]:
    """Gibt (access_level, defining_node_id) zurück — defining_node_id ist der Knoten,
    der das Access-Level explizit setzt (für visu_node_users-Lookup).
    """
    current_id: str | None = node_id
    while current_id:
        row = await db.fetchone(
            """SELECT vn.parent_id, avp.access_mode
               FROM visu_nodes AS vn
               LEFT JOIN authz_visu_page_policies AS avp ON avp.node_id = vn.id
               WHERE vn.id = ?""",
            (current_id,),
        )
        if not row:
            break
        access_mode = row["access_mode"] if "access_mode" in row.keys() else row["access"]  # noqa: SIM118 -- sqlite Row membership checks values
        if access_mode is not None:
            return access_mode, current_id
        current_id = row["parent_id"]
    return "public", None


async def _resolve_access_with_node_overrides(
    db: Database,
    node_id: str,
    *,
    access_overrides: dict[str, str | None] | None = None,
    parent_overrides: dict[str, str | None] | None = None,
) -> tuple[str, str | None]:
    current_id: str | None = node_id
    seen: set[str] = set()
    while current_id and current_id not in seen:
        seen.add(current_id)
        row = await db.fetchone(
            """SELECT vn.parent_id, avp.access_mode
               FROM visu_nodes AS vn
               LEFT JOIN authz_visu_page_policies AS avp ON avp.node_id = vn.id
               WHERE vn.id = ?""",
            (current_id,),
        )
        if not row:
            break
        stored_access = row["access_mode"] if "access_mode" in row.keys() else row["access"]  # noqa: SIM118 -- sqlite Row membership checks values
        access = access_overrides[current_id] if access_overrides and current_id in access_overrides else stored_access
        if access is not None:
            return access, current_id
        current_id = parent_overrides[current_id] if parent_overrides and current_id in parent_overrides else row["parent_id"]
    return "public", None


async def _check_user_access(db: Database, node_id: str, username: str) -> bool:
    """Gibt True zurück, wenn der Benutzer für den angegebenen 'user'-Knoten
    autorisiert ist (Admin oder explizit zugewiesen).
    """
    user_row = await db.fetchone("SELECT is_admin FROM users WHERE username = ?", (username,))
    if not user_row:
        return False
    if bool(user_row["is_admin"]):
        return True
    return await authorize_visu_page(
        db,
        Principal(subject=username, type="user", is_admin=False),
        node_id,
        action=AuthzAction.READ,
        strict=True,
    )


async def _optional_visu_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_visu_bearer),
    api_key: str | None = Depends(_visu_api_key_header),
    db: Database = Depends(get_db),
) -> Principal | None:
    if credentials is None and api_key is None:
        return None
    try:
        return await get_current_principal(credentials=credentials, api_key=api_key, db=db)
    except HTTPException:
        return None


def _principal_from_dependency(value: Principal | str | None) -> Principal | None:
    if value is None or isinstance(value, Principal):
        return value
    if not isinstance(value, str):
        return None
    return Principal(
        subject=value,
        type="api_key" if value.startswith("api_key:") else "user",
        is_admin=value == "admin",
    )


def _principal_from_mutation_dependency(value: Principal | str | object) -> Principal:
    if isinstance(value, Principal):
        return value
    # Direct callers historically pass the return value of get_admin_user as a
    # string. Runtime requests now receive a Principal from get_current_principal.
    subject = value if isinstance(value, str) else "admin"
    return Principal(subject=subject, type="user", is_admin=True)


async def _can_discover_node(db: Database, node_id: str, principal: Principal | None) -> bool:
    access, _ = await _resolve_access_with_node(db, node_id)
    if access != "user":
        return True
    if principal is None:
        return False
    if principal.type != "user":
        return False
    if principal.is_admin:
        return True
    return await authorize_visu_page(db, principal, node_id, action=AuthzAction.READ)


async def _require_discoverable_node(db: Database, node_id: str, principal: Principal | None) -> VisuNode:
    node = await _get_node_or_404(db, node_id)
    if not await _can_discover_node(db, node_id, principal):
        raise HTTPException(status_code=404, detail="Knoten nicht gefunden")
    return node


async def _mask_concealed_includes(db: Database, config: PageConfig, principal: Principal | None) -> PageConfig:
    """Entfernt Include-Ziele, die für ``principal`` auf Navigationsebene verdeckt
    sind, bevor die Konfiguration den Client erreicht (Micsi/openbridgeserver#176).

    ``PageConfig.includes`` wurde bisher roh ausgeliefert - unabhängig davon, ob
    der lesende Principal das Ziel selbst sehen darf. Zusammen mit den
    unterschiedlichen Signalen von ``GET /visu/pages/{id}`` (403/401 „existiert,
    aber verdeckt" vs. 404 „existiert nicht", CONTRIBUTING-visu-m5.md §2.1)
    entstand daraus ein Existenzorakel: wer die Quellseite lesen darf, erfährt
    die ID eines ihm sonst verborgenen Ziels und kann dessen Existenz per Probe
    bestätigen.

    Maskiert wird exakt dieselbe Menge, die auch `/visu/tree`/`/nodes/{id}`
    verdeckt (`_can_discover_node`: nur `user`-geschützte Ziele ohne
    Berechtigung). PIN-geschützte (`protected`) und verwaiste Ziele bleiben
    stehen: PIN ist ausdrücklich **keine** Verdeckung, sondern eine auflösbare
    Aufforderung, und ein verwaister Eintrag ist über das gewöhnliche
    404-Signal beim Laden schon ununterscheidbar von „existiert nicht" - beides
    zu maskieren würde Teil B/C1 die Grundlage entziehen, PIN-Ziele als
    „gesperrt" anzuzeigen bzw. verwaiste Ziele wie in §2.1 zugesichert still
    wegzulassen.
    """
    if not config.includes:
        return config
    visible = [target_id for target_id in config.includes if await _can_discover_node(db, target_id, principal)]
    if visible == config.includes:
        return config
    return config.model_copy(update={"includes": visible})


async def _was_visible_before(db: Database, principal: Principal, target_id: str, threshold: datetime) -> bool:
    """War ``target_id`` für ``principal`` schon sichtbar, bevor die gerade zu
    überschreibende Fassung der Quellseite gespeichert wurde (Micsi/openbridgeserver#176,
    Runde 3, Befund 1)?

    Beantwortet die Wettlauf-Frage zwischen Lesen und Speichern: wechselt die
    Sichtbarkeit eines Include-Ziels für den Principal von verdeckt auf
    sichtbar, NACHDEM er die (noch maskierte) Konfiguration gelesen, aber
    BEVOR er sie gespeichert hat, darf `_restore_concealed_includes` das
    fehlende Ziel nicht als „er sieht es ja jetzt, also war die Entfernung
    bewusst" werten - er hat es nie gesehen, die aktuelle Sichtbarkeit sagt
    nichts über den Stand bei seinem Lesen aus. Reines
    Jetzt-Zeitpunkt-`_can_discover_node` kann diese beiden Fälle nicht
    unterscheiden.

    Für `access != 'user'`-Ziele oder Admin-Principals gibt es keinen Wettlauf:
    die Sichtbarkeit ist strukturell (nie verdeckt) bzw. dauerhaft - `True`.
    Für `user`-geschützte Ziele wird geprüft, ob bereits vor ``threshold`` ein
    aktiver Allow-Grant auf genau diesem Knoten bestand. Das ist eine bewusst
    einfache Näherung des zentralen Authz-Entscheiders (`authorize_visu_page`):
    Vererbung über Vorfahren und Deny-Overrides werden hier nicht nachgebildet,
    um die zentrale Engine nicht zu duplizieren. Ein Ausbleiben eines Treffers
    heißt deshalb nicht zwingend „erst kürzlich sichtbar geworden" - im Zweifel
    wird zugunsten des Datenerhalts entschieden (wiederhergestellt statt
    endgültig gelöscht), nie umgekehrt.
    """
    if principal.type != "user":
        return False
    if principal.is_admin:
        return True
    access, _ = await _resolve_access_with_node(db, target_id)
    if access != "user":
        return True
    row = await db.fetchone(
        """SELECT MIN(created_at) AS earliest FROM authz_node_roles
           WHERE principal_type = 'user' AND principal_id = ?
             AND node_type = 'visu_page' AND node_id = ? AND effect = 'allow'""",
        (principal.subject, target_id),
    )
    earliest = row["earliest"] if row is not None else None
    if not earliest:
        return False
    return datetime.fromisoformat(str(earliest)) <= threshold


async def _restore_concealed_includes(
    db: Database,
    stored_includes: list[str],
    incoming_includes: list[str],
    principal: Principal | None,
    *,
    stored_at: datetime,
) -> tuple[list[str], frozenset[str]]:
    """Verhindert stillen Datenverlust durch die Maskierung aus `_mask_concealed_includes`
    (Micsi/openbridgeserver#176, Runde 2, Befund 1; Runde 3, Befund 1).

    Ein Principal ohne Sicht auf ein Include-Ziel bekommt es beim Lesen nicht zu
    sehen (maskiert) - schickt er die so gelesene Konfiguration unverändert
    zurück, fehlt der verdeckte Eintrag in der eingehenden Nutzlast, ohne dass
    der Principal je entschieden hätte, ihn zu entfernen. Ohne Gegenmaßnahme
    würde ``save_page`` genau diese verkürzte Liste speichern und das Include
    still löschen - schlimmer als das Orakel, das die Maskierung schließt.

    Deshalb: ein bereits gespeicherter Eintrag, der beim Speichern fehlt, wird
    nur dann wirklich entfernt, wenn der schreibende Principal ihn schon vor
    dieser Fassung sehen konnte (er hat sich dann nachweislich informiert
    dagegen entschieden, siehe `_was_visible_before`). War er für ihn verdeckt
    oder ist seine Sichtbarkeit erst zwischen Lesen und Schreiben entstanden,
    bleibt er stehen - der Principal kann ihn über diesen Weg also weder
    erfahren (der Rückgabewert von ``save_page`` ist 204 ohne Body, und ein
    erneutes Lesen zeigt ihn erst nach einem frischen, informierten Lesen)
    noch verändern. Reihenfolge: gespeicherte Einträge (gehalten oder
    wiederhergestellt) zuerst in ihrer alten Reihenfolge, danach neue Einträge
    in der eingereichten Reihenfolge.

    Gibt zusätzlich die Menge der tatsächlich wiederhergestellten IDs zurück -
    Einträge, die der schreibende Principal in dieser Anfrage NICHT eingereicht
    hat, sondern die allein durch diese Funktion erhalten blieben. `save_page`
    nimmt genau diese Menge von der Zyklusprüfung aus (Runde 3, Befund 2): der
    Autor hat sie nie gesehen und kann weder ihren Inhalt noch einen darüber
    laufenden Zyklus beheben. Eine dem Autor eigentlich verdeckte ID, die er
    trotzdem selbst (z. B. aus einem alten Export) einreicht, zählt nicht dazu
    - sie ist in `incoming_includes` vorhanden und läuft weiterhin über die
    volle Prüfung aus #177/#178.
    """
    if not stored_includes:
        return incoming_includes, frozenset()
    incoming_set = set(incoming_includes)
    stored_set = set(stored_includes)
    merged: list[str] = []
    restored: set[str] = set()
    for target_id in stored_includes:
        if target_id in incoming_set:
            merged.append(target_id)
            continue
        if not await _can_discover_node(db, target_id, principal):
            merged.append(target_id)
            restored.add(target_id)
            continue
        if principal is None or not await _was_visible_before(db, principal, target_id, stored_at):
            merged.append(target_id)
            restored.add(target_id)
            continue
        # sichtbar, und nachweislich schon vor dieser Fassung sichtbar: die
        # bewusste Entfernung durch einen informierten Principal wird respektiert.
    merged.extend(target_id for target_id in incoming_includes if target_id not in stored_set)
    return merged, frozenset(restored)


async def _node_response_for_principal(db: Database, node_id: str, principal: Principal | None) -> VisuNode:
    """Lädt den Knoten frisch für eine HTTP-Antwort und maskiert seine
    `page_config.includes` für ``principal`` (Micsi/openbridgeserver#176, Runde 2,
    Befund 2).

    **Der einzige Rückgabeweg für einen VisuNode nach einer Mutation.**
    `copy_node`, `update_node` (PATCH) und `move_node` laden den soeben
    geänderten Knoten bisher über das rohe ``_get_node_or_404`` und lieferten
    `page_config.includes` damit ungefiltert aus - derselbe Leerlauf wie bei
    `get_page` vor Runde 1, nur an drei weiteren Stellen. Ein neuer Endpunkt, der
    einen VisuNode nach einer Mutation zurückgibt, bekommt die Maskierung
    automatisch, wenn er diese Funktion statt ``_get_node_or_404`` aufruft -
    die Maskierungslogik selbst lebt weiterhin nur in
    ``_mask_concealed_includes``.

    Bewusst **nicht** für ``_require_discoverable_node`` und den internen
    Ziel-Lookup in ``_validate_page_kind_config`` verwendet: die brauchen den
    ungefilterten Stand (siehe deren Docstrings).
    """
    node = await _get_node_or_404(db, node_id)
    if node.page_config is None:
        return node
    masked = await _mask_concealed_includes(db, node.page_config, principal)
    if masked is node.page_config:
        return node
    return node.model_copy(update={"page_config": masked})


async def _visu_subtree_ids(db: Database, node_id: str) -> list[str]:
    rows = await db.fetchall(
        """WITH RECURSIVE subtree(id) AS (
               SELECT id FROM visu_nodes WHERE id = ?
            UNION
               SELECT child.id FROM visu_nodes AS child JOIN subtree ON child.parent_id = subtree.id
           )
           SELECT id FROM subtree""",
        (node_id,),
    )
    return [row["id"] for row in rows]


async def _require_visu_generate(db: Database, principal: Principal, node_ids: list[str]) -> None:
    if principal.type == "user" and principal.is_admin:
        return
    targets = await resolve_visu_page_targets(db, node_ids)
    grants = await load_role_grants(db, principal, node_type="visu_page")
    decision = authorize(
        principal=principal,
        action=AuthzAction.GENERATE,
        targets=targets,
        grants=grants,
    )
    if not decision.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")


async def _require_visu_creation_parent(db: Database, principal: Principal, parent_id: str | None) -> None:
    """Authorize creation below an existing Visu parent without granting root authority."""
    if principal.type != "user":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")
    if parent_id is None:
        if not principal.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")
        return
    await _require_discoverable_node(db, parent_id, principal)
    await _require_visu_generate(db, principal, [parent_id])


def _source_page_readonly(access: str) -> bool:
    """Widgets einer readonly-Quellseite bleiben gesperrt, wo immer sie erscheinen.

    Einzige Ableitungsregel für ``GET /widget-ref/{page_id}`` (einzelnes eingebettetes
    Widget) und für das Laden einer Include-Quelle über ``GET /pages/{id}`` (R15).
    """
    return access == "readonly"


def _validate_node_kind(node_type: str, kind: str) -> None:
    """Nur Seiten tragen einen Seitentyp; ein Ordner bleibt 'normal'."""
    if node_type != "PAGE" and kind != "normal":
        raise HTTPException(status_code=400, detail="Seitentyp ist nur für Seiten (PAGE) zulässig")


async def _assert_no_include_cycle(db: Database, node_id: str, includes: list[str]) -> None:
    """Folgt der Include-Kette und lehnt jeden Weg zurück auf node_id ab (auch mehrstufig)."""
    pending = list(includes)
    seen: set[str] = set()
    while pending:
        current = pending.pop()
        if current == node_id:
            raise HTTPException(status_code=400, detail="Include-Zyklus: die Seite inkludiert sich mittelbar selbst")
        if current in seen:
            continue
        seen.add(current)
        row = await db.fetchone("SELECT page_config FROM visu_nodes WHERE id = ?", (current,))
        if row is None or not row["page_config"]:
            continue
        pending.extend(str(target) for target in json.loads(row["page_config"]).get("includes") or [])


async def _assert_not_included_elsewhere(db: Database, node_id: str) -> None:
    """Ein Popup darf nie Include-Ziel sein, also auch nicht nachträglich eines werden."""
    row = await db.fetchone(
        """SELECT vn.id
           FROM visu_nodes AS vn
           WHERE json_valid(vn.page_config)
             AND EXISTS (
               SELECT 1 FROM json_each(vn.page_config, '$.includes') WHERE json_each.value = ?
           )
           LIMIT 1""",
        (node_id,),
    )
    if row is not None:
        raise HTTPException(status_code=400, detail="Eine inkludierte Seite kann kein Popup werden")


async def _apply_kind_change(db: Database, node: VisuNode, kind: PageKind) -> None:
    """Prüft einen Seitentyp-Wechsel gegen die bereits gespeicherte Konfiguration."""
    _validate_node_kind(node.type, kind)
    if kind == "popup":
        await _assert_not_included_elsewhere(db, node.id)
    stored = node.page_config or PageConfig()
    # Nur der Seitentyp ändert sich; die gespeicherten Include-Einträge sind alt
    # und dürfen den Wechsel nicht an einem verwaisten Ziel scheitern lassen.
    await _validate_page_kind_config(db, node.id, kind, stored, previous_includes=stored.includes)


async def _validate_page_kind_config(
    db: Database,
    node_id: str,
    kind: str,
    config: PageConfig,
    *,
    previous_includes: Iterable[str] = (),
    restored_include_ids: frozenset[str] = frozenset(),
) -> None:
    """Setzt das Seitentyp-Modell durch, bevor eine Konfiguration gespeichert wird.

    R12: eine globale Inkludeseite inkludiert selbst nichts (eine Ebene).
    R9:  ein Popup bekommt keine Includes (auch keine globalen, das entscheidet die Komposition).
    Ziele existieren, sind Seiten und sind nie selbst ein Popup; keine Selbst-Includes/Zyklen.

    ``previous_includes`` sind die bereits gespeicherten Einträge desselben Knotens.
    Für sie entfällt die Ziel-Prüfung gegen die Datenbank, damit ein gespeicherter
    Eintrag eine Seite nie dauerhaft unspeicherbar macht (R17 – V1 schickt die
    geladene Konfiguration unverändert zurück und hat keine Include-UI).

    Belegbar entstehen solche Einträge nur **außerhalb** dieses Schreibpfads:
    Zeilen aus Restore/Migration oder direktem DB-Zugriff, Zeilen die
    ``_drop_include_references`` wegen seines ``json_valid``-Filters nicht erreicht,
    und das Wettrennen zwischen dem Lesen der Zeile im Aufrufer und einem parallel
    laufenden ``delete_node``.
    Ausdrücklich **kein** Grund ist Verdeckung: der Ziel-Lookup unten liest
    ``visu_nodes`` ohne jede authz-Filterung, ein verdecktes Ziel wird also wie ein
    sichtbares geprüft (Test: ``test_a_concealed_include_target_is_checked_without_authz_filtering``).
    Ebenso wenig der Import: er validiert nach dem Einfügen streng und lehnt tote
    Ziele ab. Neue und geänderte Einträge bleiben streng geprüft.

    Die Zyklusprüfung selbst kennt **keine** ``previous_includes``-Ausnahme: sie
    läuft immer über die volle Liste, auch für unveränderte, bereits gespeicherte
    Einträge (#177/#178, siehe ``test_177_a_cycle_set_raw_in_the_db_still_fails_an_unchanged_round_trip``)
    - ein Autor, der einen Eintrag unverändert zurückschickt, hatte ihn gesehen
    und hätte ihn entfernen können. ``restored_include_ids`` ist die einzige,
    bewusst engere Ausnahme davon (Runde 3, Befund 2): IDs, die
    ``_restore_concealed_includes`` dem Autor untergeschoben hat, weil sie für
    ihn beim Schreiben nicht sichtbar waren - er hat sie nie eingereicht, kann
    weder ihren Inhalt noch einen darüber laufenden Zyklus sehen oder beheben,
    und darf deshalb nicht an ihnen scheitern. Nur diese IDs werden als
    Startpunkt der Traversierung ausgenommen; erreicht ein neuer oder direkt
    eingereichter Eintrag über sie doch wieder ``node_id``, schlägt die Prüfung
    weiterhin an (die Traversierung selbst filtert nicht).
    """
    if config.popup is not None and kind != "popup":
        raise HTTPException(status_code=400, detail="Popup-Konfiguration ist nur für Seitentyp 'popup' zulässig")
    if not config.includes:
        return
    if kind == "globalInclude":
        raise HTTPException(status_code=400, detail="Eine globale Inkludeseite kann selbst keine Seiten inkludieren")
    if kind == "popup":
        raise HTTPException(status_code=400, detail="Eine Popup-Seite kann keine Seiten inkludieren")
    unchanged = set(previous_includes)
    for target_id in config.includes:
        if target_id == node_id:
            raise HTTPException(status_code=400, detail="Eine Seite kann sich nicht selbst inkludieren")
        if target_id in unchanged:
            continue
        row = await db.fetchone("SELECT type, kind FROM visu_nodes WHERE id = ?", (target_id,))
        if row is None:
            raise HTTPException(status_code=400, detail="Include-Ziel existiert nicht")
        if row["type"] != "PAGE":
            raise HTTPException(status_code=400, detail="Include-Ziel ist keine Seite")
        if row["kind"] == "popup":
            raise HTTPException(status_code=400, detail="Eine Popup-Seite kann nicht inkludiert werden")
    cycle_roots = [target_id for target_id in config.includes if target_id not in restored_include_ids]
    await _assert_no_include_cycle(db, node_id, cycle_roots)


async def _drop_include_references(
    db: Database,
    removed_ids: Iterable[str],
    principal: Principal | None = None,
) -> None:
    """Entfernt Verweise auf gelöschte Seiten aus den ``includes`` anderer Seiten.

    Bewusste Wahl: beim Löschen wird **aufgeräumt** statt die toten Verweise stehen
    zu lassen. Sonst trüge der Baum Karteileichen, die im Editor als leere Include-
    Zeile erscheinen und beim Import wieder mitwandern. Die Duldung verwaister
    Alt-Einträge in ``_validate_page_kind_config`` bleibt trotzdem nötig: dieses
    Aufräumen erreicht nicht jede Zeile (``json_valid``-Filter unten) und nicht
    jeden Entstehungsweg (Restore, Migration, direkter DB-Zugriff).
    Die rohe JSON-Struktur wird bearbeitet, damit unbekannte Felder einer V1- oder
    Fremd-Konfiguration erhalten bleiben (R17). Aufgeräumt wird über den ganzen
    Baum, auch auf Seiten ohne Schreibrecht des Löschenden: es ist dieselbe
    Integritäts-Nachsorge wie das kaskadierende Löschen der Nachkommen, kein
    inhaltlicher Eingriff (der Verweis zeigte danach ohnehin ins Leere).

    **DIES IST EIN SCHREIBWEG AUF ``page_config``, und er hält seinen Stand fest**
    (M5 C6 R2, E12). Er ist der einzige, der eine Seite ändert, ohne dass ihr
    Autor etwas getan hätte - und genau deshalb muss er mitschreiben: ohne
    Version wäre der oberste Verlaufseintrag der betroffenen Seiten weder der
    ausgelieferte Stand (entgegen der Zusage von ``get_page_versions``) noch
    überhaupt wiederherstellbar. Der gestrichene Include-Eintrag stünde beim
    ``PUT`` nicht mehr in der gespeicherten Liste, gälte damit als NEU
    hinzugefügt und fiele in die strenge Zielprüfung (§2.1) - 400
    „Include-Ziel existiert nicht". Der Aufrufer (``delete_node``) hält die
    Transaktion; Stand und Version gelten zusammen oder gar nicht.

    Nur wirklich geänderte Zeilen werden geschrieben: die Abfrage unten trifft
    eine Seite auch dann, wenn ihr Verweis in einem anderen Feld als
    ``includes`` steht - eine unveränderte Liste bekäme sonst eine Version ohne
    Änderung.
    """
    # `removed_ids` ist der Teilbaum der gelöschten Seite und enthält sie immer selbst;
    # eine leere Liste ist ausgeschlossen (wie schon beim DELETE der Rollen darüber).
    removed = [str(node_id) for node_id in removed_ids]
    placeholders = ",".join("?" for _ in removed)
    rows = await db.fetchall(
        f"""SELECT vn.id, vn.page_config
            FROM visu_nodes AS vn
            WHERE json_valid(vn.page_config)
              AND EXISTS (
                SELECT 1 FROM json_each(vn.page_config, '$.includes')
                WHERE json_each.value IN ({placeholders})
              )""",
        removed,
    )
    dropped = set(removed)
    for row in rows:
        stored = json.loads(row["page_config"])
        includes = [str(target) for target in stored.get("includes") or []]
        kept = [target for target in includes if target not in dropped]
        if kept == includes:
            continue
        stored["includes"] = kept
        stored_json = json.dumps(stored)
        await db.conn.execute(
            "UPDATE visu_nodes SET page_config = ?, updated_at = ? WHERE id = ?",
            (stored_json, _now_iso(), row["id"]),
        )
        await _record_page_version(db, row["id"], stored_json, principal)


def _collect_page_datapoint_ids(config: PageConfig) -> list[str]:
    datapoint_ids: set[str] = set()
    for widget in config.widgets:
        if widget.datapoint_id and is_uuid_str(widget.datapoint_id):
            datapoint_ids.add(widget.datapoint_id)
        if widget.status_datapoint_id and is_uuid_str(widget.status_datapoint_id):
            datapoint_ids.add(widget.status_datapoint_id)
        collect_datapoint_ids_from_config(widget.config, datapoint_ids)
    return sorted(datapoint_ids)


async def _check_page_datapoint_policy(
    db: Database,
    principal: Principal | None,
    datapoint_ids: list[str],
    action: AuthzAction,
    *,
    allow_empty: bool = True,
) -> None:
    if principal is None or (principal.type == "user" and principal.is_admin):
        return
    if not datapoint_ids:
        if allow_empty:
            return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")

    allowed_ids = set(await filter_authorized_datapoints(db, principal, datapoint_ids, action=action))
    if not set(datapoint_ids).issubset(allowed_ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")


async def _check_page_read_access(
    db: Database,
    node_id: str,
    principal: Principal | None,
    config: PageConfig,
    *,
    session_token: str | None = None,
) -> str:
    """Apply the page-config read policy shared by page reads and exports.

    Gibt das aufgelöste Zugriffs-Level zurück, damit Aufrufer es nicht ein
    zweites Mal über die Elternkette auflösen müssen.
    """
    access, defining_node_id = await _resolve_access_with_node(db, node_id)
    if principal is None:
        if access == "user":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Anmeldung erforderlich",
            )
        if access == "protected":
            validate_id = defining_node_id or node_id
            if not session_token or not validate_session(session_token, validate_id):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="PIN-Authentifizierung erforderlich",
                )
    elif access == "user" and (principal.type != "user" or not await _check_user_access(db, node_id, principal.subject)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")

    if access == "user":
        await _check_page_datapoint_policy(db, principal, _collect_page_datapoint_ids(config), AuthzAction.READ)
    return access


async def _target_usernames_for_node(
    db: Database,
    defining_node_id: str,
    *,
    usernames: list[str] | None = None,
) -> list[str]:
    if usernames is not None:
        return sorted(set(usernames))
    rows = await db.fetchall(
        """SELECT principal_id
           FROM authz_node_roles
           WHERE principal_type = 'user' AND node_type = 'visu_page'
             AND node_id = ? AND effect = 'allow'
           ORDER BY principal_id""",
        (defining_node_id,),
    )
    return [row["principal_id"] for row in rows]


async def _check_user_page_target_datapoint_policy(
    db: Database,
    defining_node_id: str,
    config: PageConfig,
    *,
    usernames: list[str] | None = None,
) -> None:
    datapoint_ids = _collect_page_datapoint_ids(config)
    if not datapoint_ids:
        return

    for username in await _target_usernames_for_node(db, defining_node_id, usernames=usernames):
        user_row = await db.fetchone("SELECT is_admin FROM users WHERE username = ?", (username,))
        principal = Principal(subject=username, type="user", is_admin=bool(user_row and user_row["is_admin"]))
        allowed_ids = set(await filter_authorized_datapoints(db, principal, datapoint_ids, action=AuthzAction.READ))
        missing_ids = sorted(set(datapoint_ids) - allowed_ids)
        if missing_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "visu_target_audience_datapoints_denied",
                    "username": username,
                    "datapoint_ids": missing_ids,
                },
            )


async def _check_user_target_pages_datapoint_policy(
    db: Database,
    defining_node_id: str,
    *,
    usernames: list[str],
) -> None:
    rows = await db.fetchall("SELECT * FROM visu_nodes WHERE type = 'PAGE'")
    for row in rows:
        page_id = row["id"]
        access, access_node_id = await _resolve_access_with_node(db, page_id)
        if access != "user" or access_node_id != defining_node_id:
            continue
        node = _row_to_node(row)
        await _check_user_page_target_datapoint_policy(
            db,
            defining_node_id,
            node.page_config or PageConfig(),
            usernames=usernames,
        )


async def _check_user_target_pages_datapoint_policy_after_access_change(
    db: Database,
    *,
    access_overrides: dict[str, str | None] | None = None,
    parent_overrides: dict[str, str | None] | None = None,
    usernames_overrides: dict[str, list[str]] | None = None,
) -> None:
    rows = await db.fetchall("SELECT * FROM visu_nodes WHERE type = 'PAGE'")
    for row in rows:
        page_id = row["id"]
        current_access, current_access_node_id = await _resolve_access_with_node(db, page_id)
        access, access_node_id = await _resolve_access_with_node_overrides(
            db,
            page_id,
            access_overrides=access_overrides,
            parent_overrides=parent_overrides,
        )
        target_group_changed = access_node_id is not None and usernames_overrides is not None and access_node_id in usernames_overrides
        if (access, access_node_id) == (current_access, current_access_node_id) and not target_group_changed:
            continue
        if access != "user" or access_node_id is None:
            continue
        node = _row_to_node(row)
        await _check_user_page_target_datapoint_policy(
            db,
            access_node_id,
            node.page_config or PageConfig(),
            usernames=usernames_overrides.get(access_node_id) if usernames_overrides and access_node_id in usernames_overrides else None,
        )


async def _validate_target_usernames(db: Database, usernames: list[str]) -> list[str]:
    requested = sorted(set(usernames))
    valid: list[str] = []
    invalid: list[str] = []
    for username in requested:
        row = await db.fetchone("SELECT is_admin FROM users WHERE username = ?", (username,))
        if row is None or bool(row["is_admin"]):
            invalid.append(username)
        else:
            valid.append(username)
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "visu_target_audience_invalid_users", "usernames": invalid},
        )
    return valid


async def _replace_target_users(db: Database, node_id: str, usernames: list[str]) -> None:
    """Replace only the simple target-audience grants; preserve advanced grants."""
    await db.conn.execute(
        """DELETE FROM authz_node_roles
           WHERE principal_type='user' AND node_type='visu_page' AND node_id=?
             AND role='guest' AND effect='allow'""",
        (node_id,),
    )
    if usernames:
        await db.conn.executemany(
            """INSERT INTO authz_node_roles
                   (principal_type, principal_id, node_type, node_id, role, effect)
               VALUES ('user', ?, 'visu_page', ?, 'guest', 'allow')
               ON CONFLICT(principal_type, principal_id, node_type, node_id) DO NOTHING""",
            [(username, node_id) for username in usernames],
        )


async def _check_inherited_user_page_target_datapoint_policy(
    db: Database,
    *,
    parent_id: str | None,
    access: str | None,
    config: PageConfig,
) -> None:
    if access is not None or parent_id is None:
        return
    inherited_access, defining_node_id = await _resolve_access_with_node(db, parent_id)
    if inherited_access == "user" and defining_node_id is not None:
        await _check_user_page_target_datapoint_policy(db, defining_node_id, config)


async def _imported_user_access_defining_node(
    db: Database,
    node_id: str,
    *,
    nodes_by_id: dict[str, Any],
    id_map: dict[str, str],
    target_parent_id: str | None,
) -> str | None:
    current = nodes_by_id[node_id]
    while current is not None:
        if current.access is not None:
            return id_map[current.id] if current.access == "user" else None
        parent_id = current.parent_id
        current = nodes_by_id.get(parent_id or "")

    if target_parent_id is None:
        return None
    inherited_access, defining_node_id = await _resolve_access_with_node(db, target_parent_id)
    return defining_node_id if inherited_access == "user" else None


async def _check_page_write_access(db: Database, node_id: str, principal: Principal | None) -> None:
    if principal is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")
    if principal.type == "user" and principal.is_admin:
        return
    access, _ = await _resolve_access_with_node(db, node_id)
    if access in ("readonly", "protected"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")
    if access == "user" and (principal.type != "user" or not await _check_user_access(db, node_id, principal.subject)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")


# ── Seitenversionen (M5 C6, E12) ──────────────────────────────────────────────

#: Wie viele Stände eine Seite behält. Der Verlauf ist eine Bedienhilfe, kein
#: Archiv: ohne Deckel wüchse die Tabelle mit jedem Speichern, und der V1-Editor
#: speichert eine Seite bei jeder Änderung. Fällt eine Zeile heraus, dann die
#: älteste - der Weg zurück reicht damit immer über die letzten
#: ``PAGE_VERSION_CAP`` Stände.
PAGE_VERSION_CAP = 50


async def _record_page_version(
    db: Database,
    node_id: str,
    page_config_json: str,
    principal: Principal | None,
) -> int | None:
    """Hält den gerade geschriebenen Stand einer Seite fest (E12).

    Aufgerufen von JEDEM Weg dieses Moduls, der ``visu_nodes.page_config``
    schreibt - und ausschließlich innerhalb der Transaktion des Aufrufers, damit
    Stand und Version zusammen gelten oder zusammen zurückgerollt werden. Eine
    Version, die einen Schreibvorgang überlebt, der selbst gescheitert ist, wäre
    schlimmer als keine.

    Die Wege, vollständig aufgezählt (jeder ist unten belegt):

    1. anlegen (``create_node``), 2. speichern (``save_page`` - dort läuft auch
    jedes Wiederherstellen durch), 3. importieren (``import_nodes``),
    4. kopieren (``copy_node``), 5. das Aufräumen toter Include-Verweise beim
    Löschen (``_drop_include_references``).

    **Der sechste Weg, ausdrücklich:** das Einspielen einer ganzen Konfiguration
    (``obs/api/v1/config.py``, ``POST /config/import``) schreibt ``page_config``
    ebenfalls. Es schreibt KEINE Version - es ist kein Autorenschritt, sondern
    das Ersetzen des gesamten Bestandes, und es hält keine gemeinsame
    Transaktion, in der eine Version mit dem Stand zusammen gelten könnte. Es
    RÄUMT die vorhandenen Versionen einer Seite aber ab, wo es deren Stand
    tatsächlich ändert: sonst wäre die oberste Zeile danach nicht mehr der
    ausgelieferte Stand, und ihr Wiederherstellen nähme das Eingespielte still
    zurück. Die ausführliche Begründung steht dort.

    **Gleich bleibt gleich.** Ist der Stand mit dem obersten identisch, entsteht
    keine Zeile: der Canvas sichert die Reihenfolge sofort (E2) und V1 schickt
    eine geladene Konfiguration unverändert zurück - ohne diese Regel füllte sich
    der Verlauf mit Zwillingen, und der Autor fände den gesuchten Stand nicht
    mehr. Rückgabe ``None`` heißt genau das: nichts festzuhalten.
    """
    newest = await db.fetchone(
        "SELECT revision, page_config FROM visu_page_versions WHERE node_id = ? ORDER BY revision DESC LIMIT 1",
        (node_id,),
    )
    if newest is not None and newest["page_config"] == page_config_json:
        return None
    revision = (newest["revision"] + 1) if newest is not None else 1
    await db.conn.execute(
        """INSERT INTO visu_page_versions (node_id, revision, page_config, created_at, created_by)
           VALUES (?, ?, ?, ?, ?)""",
        (node_id, revision, page_config_json, _now_iso(), principal.subject if principal is not None else None),
    )
    if revision > PAGE_VERSION_CAP:
        await db.conn.execute(
            "DELETE FROM visu_page_versions WHERE node_id = ? AND revision <= ?",
            (node_id, revision - PAGE_VERSION_CAP),
        )
    return revision


async def _require_page_history_access(
    db: Database,
    node_id: str,
    user: Principal | str | None,
) -> Principal:
    """Wer den Verlauf sehen darf, und wer nicht einmal von der Seite erfährt.

    Drei Stufen, in dieser Reihenfolge:

    1. **Kein Principal → 401.** Der Verlauf gehört dem Autorenwerkzeug, nicht der
       ausgelieferten Visu; anonym gibt es ihn nicht.
    2. **Nicht auffindbar → 404.** Dieselbe Verdeckung wie überall auf der
       Navigationsebene (§2.1): eine ``user``-geschützte Seite, die dieser
       Principal nicht lesen darf, existiert für ihn nicht - auch nicht als
       Verlauf.
    3. **Kein Schreibrecht → 403.** Der Verlauf ist Autoren-Material und zeigt
       Stände, die heute nicht mehr ausgeliefert werden. Er hängt deshalb an
       ``GENERATE``, also an demselben Recht wie ``PUT /visu/pages/{id}`` - wer
       eine Seite nicht schreiben darf, hat auch für ihre Vorgeschichte keinen
       Grund.
    """
    principal = _principal_from_dependency(user)
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Anmeldung erforderlich")
    node = await _require_discoverable_node(db, node_id, principal)
    if node.type != "PAGE":
        raise HTTPException(status_code=400, detail="Knoten ist keine Seite")
    await _require_visu_generate(db, principal, [node_id])
    return principal


# ── Tree ──────────────────────────────────────────────────────────────────────


@router.get("/tree", response_model=list[VisuNodeSummary])
async def get_tree(
    db: Database = Depends(get_db),
    user: Principal | str | None = Depends(_optional_visu_principal),
):
    """Gesamtbaum als flache Liste (Frontend baut Baum via parent_id)."""
    principal = _principal_from_dependency(user)
    rows = await db.fetchall(
        """SELECT vn.*, avp.access_mode
           FROM visu_nodes AS vn
           LEFT JOIN authz_visu_page_policies AS avp ON avp.node_id = vn.id
           ORDER BY vn.node_order ASC""",
    )
    visible_rows = [row for row in rows if await _can_discover_node(db, row["id"], principal)]
    visible_ids = {row["id"] for row in visible_rows}
    # Eine Abfrage fuer den ganzen Baum, nicht eine je Zeile - und nur, wenn die
    # Antwort die Angabe ueberhaupt ausweist.
    with_pin = await _nodes_with_pin(db) if _may_see_pin_state(principal) else None
    return [
        _row_to_summary(
            row,
            access=row["access_mode"] if "access_mode" in row.keys() else None,  # noqa: SIM118 -- sqlite Row membership checks values
            parent_id=row["parent_id"] if row["parent_id"] in visible_ids else None,
            has_pin=None if with_pin is None else row["id"] in with_pin,
        )
        for row in visible_rows
    ]


# ── Einzelner Knoten ──────────────────────────────────────────────────────────


#: Was in einer Header-Aufzaehlung stehen darf. Die Feldnamen kommen aus einer
#: FREMDEN Datei; ohne diese Enge stuende dort, was der Absender hineinschreibt -
#: bis hin zu einem Zeilenumbruch, der den Header spaltet.
_HEADER_TOKEN = re.compile(r"[^A-Za-z0-9_.\[\]-]+")

#: Wie viele Feldnamen der Header hoechstens nennt. Wer mehr verliert, hat kein
#: Feld-Problem, sondern eine Datei aus einer ganz anderen Welt.
_DROPPED_FIELDS_CAP = 20


def _header_list(values: list[str]) -> str:
    """Die ersten ``_DROPPED_FIELDS_CAP`` Namen, jeder auf 64 Zeichen beschnitten.

    Wie viele Namen dabei WEGFALLEN, sagt der Aufrufer in einem eigenen Header
    (``X-Visu-Import-Dropped-Fields-Omitted``). Ohne diese Zahl saehe eine
    abgeschnittene Aufzaehlung genauso aus wie eine vollstaendige - der Autor
    haette 20 von 42 Namen vor sich und keinen Anlass, nach den uebrigen 22 zu
    suchen. Die Zahl steht getrennt und nicht als Pseudo-Feldname in der Liste:
    diese Liste enthaelt Feldnamen, sonst nichts.
    """
    return ",".join(_HEADER_TOKEN.sub("_", value)[:64] for value in values[:_DROPPED_FIELDS_CAP])


def _unknown_config_fields(raw: Any) -> list[str]:
    """Welche Felder einer eingelesenen ``page_config`` dieses OBS nicht kennt.

    **Warum das ueberhaupt gemeldet wird (E18, Gegenfall 2).** Der Export liest
    roh und traegt jedes Feld mit, auch eines aus einer neueren OBS-Version. Der
    Import geht durch ``PageConfig.model_validate``, und Pydantic verwirft
    Unbekanntes wortlos. Eine Seite aus einer neueren Version verlor beim
    Einlesen also still Felder - am ``GET`` faellt das nie auf (der liest
    ebenfalls durchs Modell), erst in der Datei-Kette.

    **Warum gemeldet und nicht aufgehoben.** Das Feld hier durchzureichen waere
    eine Zusage, die sofort bricht: ``save_page`` schreibt
    ``config.model_dump_json()``, der erste Handgriff des Autors an dieser Seite
    loeschte es also doch - nur zu einem Zeitpunkt, den niemand mehr mit dem
    Import verbindet. Und ein Feld, das diese Instanz weder versteht noch
    validiert, in ihrer Datenbank zu tragen, ist genau dort gefaehrlich, wo es
    am ehesten vorkommt: bei einem kuenftigen Zugriffs- oder Bindungsfeld. Der
    Verlust ist damit eine GRENZE dieses Endpunkts - eine benannte, die der
    Autor beim Import liest, statt sie beim naechsten Export zu entdecken.

    Gesehen werden die drei Ebenen, auf denen ein Export ueberhaupt Felder
    traegt: die Seite selbst, jedes Widget und der Popup-Deskriptor. Tiefer
    (``widget.config``) ist es ein freies Objekt, das das Modell ohnehin
    unveraendert durchreicht - dort geht nichts verloren.
    """
    if not isinstance(raw, dict):
        return []
    unknown = {key for key in raw if key not in PageConfig.model_fields}
    for widget in raw.get("widgets") or []:
        if isinstance(widget, dict):
            unknown |= {f"widgets[].{key}" for key in widget if key not in WidgetInstance.model_fields}
    popup = raw.get("popup")
    if isinstance(popup, dict):
        unknown |= {f"popup.{key}" for key in popup if key not in PopupConfig.model_fields}
    return sorted(unknown)


@router.post("/nodes/import", response_model=VisuNode, status_code=status.HTTP_201_CREATED)
@audit_application_contract("POST", "/api/v1/visu/nodes/import", principal_param="_user")
async def import_nodes(
    body: VisuImportRequest,
    response: Response = None,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    """Importiert einen exportierten Visu-Teilbaum und hängt ihn an target_parent_id.

    **Zwei Dinge kommen nicht mit, und beide sagt der Import laut** (M5 C6,
    E18). Sie stehen als Antwort-Header da, in derselben Bauart wie
    ``X-Source-Page-Readonly`` (§2.1) - der Editor liest sie und stellt sie dem
    Autor neben die Erfolgsmeldung:

    * ``X-Visu-Import-Dropped-Fields`` - Felder, die diese OBS-Version nicht
      kennt und deshalb nicht uebernimmt (siehe ``_unknown_config_fields``).
      Die Aufzaehlung ist gedeckelt (``_DROPPED_FIELDS_CAP``); wo sie kuerzt,
      steht daneben ``X-Visu-Import-Dropped-Fields-Omitted`` mit der Anzahl der
      NICHT genannten Namen. Ohne diese Zahl waere eine gekuerzte Liste von
      einer vollstaendigen nicht zu unterscheiden.
    * ``X-Visu-Import-Protected-Without-Pin`` - wie viele eingelesene Seiten
      PIN-geschuetzt sind, aber OHNE PIN ankommen. Der Export laesst
      ``access_pin`` bewusst weg (ein Geheimnis gehoert nicht in eine Datei,
      die weitergereicht wird); die Policy wird trotzdem angelegt, denn sie
      wegzulassen waere eine stille HERABSTUFUNG des Zugriffsschutzes. Die
      importierte Seite ist damit fehlerschliessend zu: ``POST
      /visu/nodes/{id}/auth`` antwortet ohne Credential-Zeile mit 403, niemand
      kommt hinein, bis der Autor in den Eigenschaften eine neue PIN setzt.
      Genau das muss er erfahren - eine Seite, die stillschweigend fuer alle
      verschlossen ist, sieht im Baum aus wie jede andere.

    Jeder dieser Header fehlt, wenn es nichts zu melden gibt; ein leerer Wert
    waere eine Meldung ueber nichts, und eine Kuerzungsangabe ohne Kuerzung
    waere eine Warnung ueber nichts.
    """
    if body.obs_export != "visu_subtree":
        raise HTTPException(status_code=400, detail="Ungültiges Export-Format (erwartet 'visu_subtree')")
    if not body.nodes:
        raise HTTPException(status_code=400, detail="Keine Knoten im Export")

    now = _now_iso()
    # Neue IDs für alle Knoten generieren
    id_map = {n.id: str(uuid.uuid4()) for n in body.nodes}
    nodes_by_id = {n.id: n for n in body.nodes}
    root_node = body.nodes[0]
    root_new_id = id_map[root_node.id]

    dropped_fields: set[str] = set()
    protected_without_pin = 0
    prepared_nodes: list[tuple[Any, str, str | None, str, PageConfig]] = []
    for node in body.nodes:
        dropped_fields.update(_unknown_config_fields(node.page_config))
        if node.access == "protected":
            protected_without_pin += 1
        new_id = id_map[node.id]
        if node.id == root_node.id:
            new_parent_id = body.target_parent_id
        else:
            new_parent_id = id_map.get(node.parent_id or "") or body.target_parent_id

        # Widget-UUIDs neu generieren, ohne das validierte Request-Modell zu mutieren.
        pc = json.loads(json.dumps(node.page_config)) if node.page_config else None
        if pc and "widgets" in pc:
            for widget in pc["widgets"]:
                widget["id"] = str(uuid.uuid4())
        if pc and pc.get("includes"):
            # Include-Ziele innerhalb des Exports folgen den neuen IDs; Ziele
            # außerhalb bleiben stehen und treffen im Ziel-Server dieselbe Seite.
            pc["includes"] = [id_map.get(str(target), str(target)) for target in pc["includes"]]
        page_config = PageConfig.model_validate(pc or {})
        prepared_nodes.append((node, new_id, new_parent_id, page_config.model_dump_json(), page_config))

    principal = _principal_from_mutation_dependency(_user)
    async with db.transaction():
        await _require_visu_creation_parent(db, principal, body.target_parent_id)
        for node, _new_id, _new_parent_id, _pc_json, page_config in prepared_nodes:
            _validate_node_kind(node.type, node.kind)
            if node.type != "PAGE" and page_config.includes:
                # Ein Nicht-Seiten-Knoten hat keine Include-Semantik, aber
                # `_assert_not_included_elsewhere` scannt **alle** Zeilen: eine
                # importierte LOCATION mit `includes` würde der genannten Seite
                # dauerhaft den Wechsel zu `popup` verwehren. Ablehnen statt still
                # verwerfen – wie beim Seitentyp auf Nicht-Seiten und beim toten
                # Include-Ziel bleibt der Import die Stelle, die Unsinn zurückweist,
                # statt ihn stillschweigend zu reparieren.
                raise HTTPException(status_code=400, detail="Include-Konfiguration ist nur für Seiten (PAGE) zulässig")
            if node.type == "PAGE":
                await _check_page_datapoint_policy(
                    db,
                    principal,
                    _collect_page_datapoint_ids(page_config),
                    AuthzAction.GENERATE,
                )
                defining_node_id = await _imported_user_access_defining_node(
                    db,
                    node.id,
                    nodes_by_id=nodes_by_id,
                    id_map=id_map,
                    target_parent_id=body.target_parent_id,
                )
                if defining_node_id is not None:
                    await _check_user_page_target_datapoint_policy(db, defining_node_id, page_config)

        for node, new_id, new_parent_id, pc_json, _page_config in prepared_nodes:
            await db.conn.execute(
                """INSERT INTO visu_nodes
                       (id, parent_id, name, type, kind, node_order, icon,
                        page_config, created_at, updated_at, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    new_id,
                    new_parent_id,
                    node.name,
                    node.type,
                    node.kind,
                    node.node_order,
                    node.icon,
                    pc_json,
                    now,
                    now,
                    principal.subject if node.type == "PAGE" else None,
                ),
            )
            if node.access is not None:
                await db.conn.execute(
                    "INSERT INTO authz_visu_page_policies (node_id, access_mode) VALUES (?, ?)",
                    (new_id, node.access),
                )
        for node, new_id, _new_parent_id, pc_json, page_config in prepared_nodes:
            if node.type == "PAGE":
                # Erst nach allen INSERTs: Include-Ziele im Import sind jetzt auflösbar.
                await _validate_page_kind_config(db, new_id, node.kind, page_config)
                # E12/E18: die importierte Seite ist eine eigene Seite. Sie erbt
                # nicht den Verlauf ihrer Vorlage (den kennt diese Instanz gar
                # nicht), sondern beginnt mit dem eingelesenen Stand.
                await _record_page_version(db, new_id, pc_json, principal)
        await write_application_success(
            db,
            None,
            principal,
            "POST",
            "/api/v1/visu/nodes/import",
            resource_id=root_new_id,
            details={"node_count": len(prepared_nodes), "operation": "import"},
            commit=False,
        )
    if response is not None:
        if dropped_fields:
            response.headers["X-Visu-Import-Dropped-Fields"] = _header_list(sorted(dropped_fields))
            if len(dropped_fields) > _DROPPED_FIELDS_CAP:
                response.headers["X-Visu-Import-Dropped-Fields-Omitted"] = str(
                    len(dropped_fields) - _DROPPED_FIELDS_CAP,
                )
        if protected_without_pin:
            response.headers["X-Visu-Import-Protected-Without-Pin"] = str(protected_without_pin)
    return await _get_node_or_404(db, root_new_id)


@router.get("/nodes/{node_id}", response_model=VisuNodeSummary)
async def get_node(
    node_id: str,
    db: Database = Depends(get_db),
    user: Principal | str | None = Depends(_optional_visu_principal),
):
    principal = _principal_from_dependency(user)
    node = await _require_discoverable_node(db, node_id, principal)
    parent_id = node.parent_id
    if parent_id is not None and not await _can_discover_node(db, parent_id, principal):
        parent_id = None
    has_pin: bool | None = None
    if _may_see_pin_state(principal):
        has_pin = (await db.fetchone("SELECT 1 FROM authz_visu_page_credentials WHERE node_id = ?", (node_id,))) is not None
    return VisuNodeSummary(
        id=node.id,
        parent_id=parent_id,
        name=node.name,
        type=node.type,
        kind=node.kind,
        order=node.order,
        icon=node.icon,
        access=node.access,
        has_pin=has_pin,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


@router.post("/nodes", response_model=VisuNode, status_code=status.HTTP_201_CREATED)
@audit_application_contract("POST", "/api/v1/visu/nodes", principal_param="_user")
async def create_node(
    body: VisuNodeCreate,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    principal = _principal_from_mutation_dependency(_user)
    now = _now_iso()
    node_id = str(uuid.uuid4())

    default_page_config = PageConfig()
    async with db.transaction():
        await _require_visu_creation_parent(db, principal, body.parent_id)
        _validate_node_kind(body.type, body.kind)
        pin_hash: str | None = None
        if body.access == "protected" and body.access_pin:
            pin_hash = bcrypt.hashpw(body.access_pin.encode(), bcrypt.gensalt()).decode()
        if body.type == "PAGE":
            await _check_inherited_user_page_target_datapoint_policy(
                db,
                parent_id=body.parent_id,
                access=body.access,
                config=default_page_config,
            )
        await db.conn.execute(
            """
            INSERT INTO visu_nodes
                (id, parent_id, name, type, kind, node_order, icon, page_config,
                 created_at, updated_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                node_id,
                body.parent_id,
                body.name,
                body.type,
                body.kind,
                body.order,
                body.icon,
                default_page_config.model_dump_json(),
                now,
                now,
                principal.subject if body.type == "PAGE" else None,
            ),
        )
        if body.access is not None:
            await db.conn.execute(
                "INSERT INTO authz_visu_page_policies (node_id, access_mode) VALUES (?, ?)",
                (node_id, body.access),
            )
        if pin_hash is not None:
            await db.conn.execute(
                "INSERT INTO authz_visu_page_credentials (node_id, pin_hash) VALUES (?, ?)",
                (node_id, pin_hash),
            )
        if body.type == "PAGE":
            # Der Anfangsstand ist der erste Punkt, auf den ein „Wiederherstellen"
            # zurückführen kann (E12). Ein Ordner hat keine Konfiguration und
            # deshalb auch keine Geschichte.
            await _record_page_version(db, node_id, default_page_config.model_dump_json(), principal)
        await write_application_success(db, None, principal, "POST", "/api/v1/visu/nodes", resource_id=node_id, commit=False)
    return await _get_node_or_404(db, node_id)


@router.patch("/nodes/{node_id}", response_model=VisuNode)
@audit_application_contract("PATCH", "/api/v1/visu/nodes/{node_id}", principal_param="_user", resource_param="node_id")
async def update_node(
    node_id: str,
    body: VisuNodeUpdate,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    principal = _principal_from_mutation_dependency(_user)
    access_supplied = "access" in body.model_fields_set
    usernames_supplied = "usernames" in body.model_fields_set

    async with db.transaction():
        node = await _require_discoverable_node(db, node_id, principal)
        await _require_visu_generate(db, principal, await _visu_subtree_ids(db, node_id))
        requested_access = body.access if access_supplied else node.access
        target_usernames: list[str] | None = None
        if usernames_supplied:
            target_usernames = await _validate_target_usernames(db, body.usernames or [])
            if requested_access != "user" and target_usernames:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "visu_target_audience_requires_user_access"},
                )
        elif access_supplied and requested_access != "user":
            target_usernames = []

        access_overrides = {node_id: requested_access} if access_supplied else None
        usernames_overrides = {node_id: target_usernames} if target_usernames is not None else None
        if access_supplied or target_usernames is not None:
            await _check_user_target_pages_datapoint_policy_after_access_change(
                db,
                access_overrides=access_overrides,
                usernames_overrides=usernames_overrides,
            )

        updates: list[str] = []
        values: list = []
        if body.name is not None:
            updates.append("name = ?")
            values.append(body.name)
        if body.kind is not None:
            await _apply_kind_change(db, node, body.kind)
            updates.append("kind = ?")
            values.append(body.kind)
        if body.order is not None:
            updates.append("node_order = ?")
            values.append(body.order)
        if "icon" in body.model_fields_set:
            updates.append("icon = ?")
            values.append(body.icon)

        pin_hash: str | None = None
        if body.access_pin is not None:
            if requested_access != "protected":
                raise HTTPException(status_code=400, detail="PIN ist nur für geschützte Knoten zulässig")
            pin_hash = bcrypt.hashpw(body.access_pin.encode(), bcrypt.gensalt()).decode()

        if updates:
            updates.append("updated_at = ?")
            values.extend((_now_iso(), node_id))
            await db.conn.execute(f"UPDATE visu_nodes SET {', '.join(updates)} WHERE id = ?", values)

        if access_supplied:
            if requested_access is None:
                await db.conn.execute("DELETE FROM authz_visu_page_policies WHERE node_id = ?", (node_id,))
            else:
                await db.conn.execute(
                    """INSERT INTO authz_visu_page_policies (node_id, access_mode, updated_at)
                       VALUES (?, ?, ?)
                       ON CONFLICT(node_id) DO UPDATE
                    SET access_mode=excluded.access_mode, updated_at=excluded.updated_at""",
                    (node_id, requested_access, _now_iso()),
                )
            if requested_access != "protected":
                await db.conn.execute("DELETE FROM authz_visu_page_credentials WHERE node_id = ?", (node_id,))

        if pin_hash is not None:
            await db.conn.execute(
                """INSERT INTO authz_visu_page_credentials (node_id, pin_hash, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(node_id) DO UPDATE SET pin_hash=excluded.pin_hash, updated_at=excluded.updated_at""",
                (node_id, pin_hash, _now_iso()),
            )
        if target_usernames is not None:
            await _replace_target_users(db, node_id, target_usernames)
        await write_application_success(db, None, principal, "PATCH", "/api/v1/visu/nodes/{node_id}", resource_id=node_id, commit=False)

    return await _node_response_for_principal(db, node_id, principal)


@router.delete("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
@audit_application_contract("DELETE", "/api/v1/visu/nodes/{node_id}", principal_param="_user", resource_param="node_id")
async def delete_node(
    node_id: str,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    principal = _principal_from_mutation_dependency(_user)
    async with db.transaction():
        await _require_discoverable_node(db, node_id, principal)
        subtree_ids = await _visu_subtree_ids(db, node_id)
        await _require_visu_generate(db, principal, subtree_ids)
        placeholders = ",".join("?" for _ in subtree_ids)
        await db.conn.execute(
            f"DELETE FROM authz_node_roles WHERE node_type='visu_page' AND node_id IN ({placeholders})",
            subtree_ids,
        )
        # ON DELETE CASCADE removes descendants, policies and credentials.
        await db.conn.execute("DELETE FROM visu_nodes WHERE id = ?", (node_id,))
        await _drop_include_references(db, subtree_ids, principal)
        await write_application_success(db, None, principal, "DELETE", "/api/v1/visu/nodes/{node_id}", resource_id=node_id, commit=False)


# ── Breadcrumb ────────────────────────────────────────────────────────────────


@router.get("/nodes/{node_id}/breadcrumb", response_model=list[VisuNodeSummary])
async def get_breadcrumb(
    node_id: str,
    db: Database = Depends(get_db),
    user: Principal | str | None = Depends(_optional_visu_principal),
):
    principal = _principal_from_dependency(user)
    if not await _can_discover_node(db, node_id, principal):
        raise HTTPException(status_code=404, detail="Visu-Knoten nicht gefunden")
    rows = []
    current_id: str | None = node_id
    while current_id:
        row = await db.fetchone(
            """SELECT vn.*, avp.access_mode
               FROM visu_nodes AS vn
               LEFT JOIN authz_visu_page_policies AS avp ON avp.node_id = vn.id
               WHERE vn.id = ?""",
            (current_id,),
        )
        if not row:
            break
        if await _can_discover_node(db, row["id"], principal):
            rows.insert(0, row)
        current_id = row["parent_id"]
    visible_ids = {row["id"] for row in rows}
    return [
        _row_to_summary(
            row,
            access=row["access_mode"] if "access_mode" in row.keys() else None,  # noqa: SIM118 -- sqlite Row membership checks values
            parent_id=row["parent_id"] if row["parent_id"] in visible_ids else None,
        )
        for row in rows
    ]


# ── Kinder ────────────────────────────────────────────────────────────────────


@router.get("/nodes/{node_id}/children", response_model=list[VisuNodeSummary])
async def get_children(
    node_id: str,
    db: Database = Depends(get_db),
    user: Principal | str | None = Depends(_optional_visu_principal),
):
    principal = _principal_from_dependency(user)
    if not await _can_discover_node(db, node_id, principal):
        raise HTTPException(status_code=404, detail="Visu-Knoten nicht gefunden")
    rows = await db.fetchall(
        """SELECT vn.*, avp.access_mode
           FROM visu_nodes AS vn
           LEFT JOIN authz_visu_page_policies AS avp ON avp.node_id = vn.id
           WHERE vn.parent_id = ?
           ORDER BY vn.node_order ASC""",
        (node_id,),
    )
    return [
        _row_to_summary(row, access=row["access_mode"] if "access_mode" in row.keys() else None)  # noqa: SIM118 -- sqlite Row membership checks values
        for row in rows
        if await _can_discover_node(db, row["id"], principal)
    ]


# ── Kopieren ──────────────────────────────────────────────────────────────────


@router.post("/nodes/{node_id}/copy", response_model=VisuNode, status_code=201)
@audit_application_contract("POST", "/api/v1/visu/nodes/{node_id}/copy", principal_param="_user", resource_param="node_id")
async def copy_node(
    node_id: str,
    body: CopyNodeRequest,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    principal = _principal_from_mutation_dependency(_user)
    now = _now_iso()
    new_id = str(uuid.uuid4())

    async with db.transaction():
        await _require_visu_creation_parent(db, principal, body.target_parent_id)
        source = await _require_discoverable_node(db, node_id, principal)

        # page_config: neue Widget-UUIDs generieren
        pc = source.page_config
        if pc:
            new_widgets = [widget.model_copy(update={"id": str(uuid.uuid4())}) for widget in pc.widgets]
            new_pc = pc.model_copy(update={"widgets": new_widgets})
        else:
            new_pc = PageConfig()
        # #178: dieselbe Validierung wie Speichern/Import, statt page_config
        # unbesehen zu übernehmen. Ein Nicht-Seiten-Knoten mit `includes` (nur
        # über Restore/Migration/direkten DB-Zugriff möglich, seit #166 weder
        # speicher- noch importierbar) würde sonst stillschweigend vervielfacht -
        # dieselbe Ablehnung wie im Import, keine stille Reparatur.
        _validate_node_kind(source.type, source.kind)
        if source.type != "PAGE" and new_pc.includes:
            raise HTTPException(status_code=400, detail="Include-Konfiguration ist nur für Seiten (PAGE) zulässig")
        if source.type == "PAGE":
            # `previous_includes` = die Einträge der Quelle: dieselbe Ausnahme wie
            # bei einem unveränderten Speichern (§2.1), damit eine gültig
            # gespeicherte, inzwischen verwaiste Quelle nicht strenger scheitert
            # als das Original. Selbst-Include/Zyklus/Struktur-Regeln laufen
            # trotzdem über die volle Liste.
            await _validate_page_kind_config(
                db,
                new_id,
                source.kind,
                new_pc,
                previous_includes=(pc.includes if pc else []),
            )
            await _check_page_datapoint_policy(
                db,
                principal,
                _collect_page_datapoint_ids(new_pc),
                AuthzAction.GENERATE,
            )
            await _check_inherited_user_page_target_datapoint_policy(
                db,
                parent_id=body.target_parent_id,
                access=source.access,
                config=new_pc,
            )

        await db.conn.execute(
            """
            INSERT INTO visu_nodes
                (id, parent_id, name, type, kind, node_order, icon,
                 page_config, created_at, updated_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                body.target_parent_id,
                body.new_name,
                source.type,
                source.kind,
                source.order,
                source.icon,
                new_pc.model_dump_json(),
                now,
                now,
                principal.subject if source.type == "PAGE" else None,
            ),
        )
        if source.access is not None:
            await db.conn.execute(
                "INSERT INTO authz_visu_page_policies (node_id, access_mode) VALUES (?, ?)",
                (new_id, source.access),
            )
        if source.type == "PAGE":
            # Die Kopie ist eine eigene Seite und beginnt ihre eigene Geschichte
            # beim Stand, mit dem sie entstanden ist (E12).
            await _record_page_version(db, new_id, new_pc.model_dump_json(), principal)
        await write_application_success(
            db,
            None,
            principal,
            "POST",
            "/api/v1/visu/nodes/{node_id}/copy",
            resource_id=new_id,
            details={"node_count": 1, "operation": "copy", "source_node_id": node_id},
            commit=False,
        )
    return await _node_response_for_principal(db, new_id, principal)


# ── Exportieren ──────────────────────────────────────────────────────────────

#: Was in der ASCII-Rueckfallform eines Dateinamens stehen darf. Bewusst eng:
#: der Rueckfall landet in einem ``filename="…"`` und darf weder das
#: Anfuehrungszeichen noch ein Semikolon enthalten, sonst zerfaellt der Header.
_FILENAME_ASCII = re.compile(r"[^A-Za-z0-9._-]+")
#: Mehrere Ersatzzeichen hintereinander zu einem zusammenziehen - ein
#: ``Krit___Emoji`` waere ein Dateiname, der die Luecke vorfuehrt statt sie zu
#: schliessen.
_FILENAME_RUNS = re.compile(r"_{2,}")


def _export_content_disposition(name: str) -> str:
    """Der Download-Header eines Exports - beide Formen, wie RFC 6266 es vorsieht.

    **Warum ueberhaupt zwei.** Ein HTTP-Header ist nach RFC 7230 auf Zeichen
    beschraenkt, die sich als latin-1 schreiben lassen; Starlette kodiert genau
    so. Ein Seitenname wie ``Krit 😀 Emoji`` sprengte deshalb den ganzen
    Endpunkt (``UnicodeEncodeError``, HTTP 500) - und ein Emoji im Seitennamen
    ist in einer Visu kein Sonderfall. RFC 5987 loest das seit Langem: der
    ASCII-Rueckfall steht in ``filename=``, der wahre Name prozentkodiert in
    ``filename*=UTF-8''…``. Jeder heutige Browser nimmt den zweiten, aeltere
    Empfaenger den ersten.

    **Was der Rueckfall leistet, und was nicht.** Er ist auf die Zeichen
    beschraenkt, die in einem ``filename="…"`` stehen duerfen, und er ist nie
    leer: bleibt nichts Druckbares uebrig (ein Name nur aus Emoji), steht dort
    ein fester Ersatz statt einer leeren Zeichenkette.

    Eine LAENGE deckelt hier nichts, und das ist Absicht. Gemessen: ein
    Seitenname aus 300 Zeichen ergibt einen Dateinamen von 310 Zeichen und einen
    Header von 662 Byte - jenseits der 255 Byte, die die meisten Dateisysteme
    fuer einen Namen annehmen. Der Browser faengt das ab (er kuerzt beim
    Speichern selbst, und der Nutzer sieht den Namen im Dialog), waehrend ein
    Deckel hier das Gegenteil anrichtete: zwei Seiten, deren lange Namen sich
    erst spaet unterscheiden, bekaemen denselben abgeschnittenen Dateinamen, und
    der zweite Export ueberschriebe wortlos den ersten. Ein langer Name ist
    laestig, ein falscher waere gefaehrlich.
    """
    filename = f"{name.replace(' ', '_').replace('/', '_')}_visu.json"
    fallback = _FILENAME_RUNS.sub("_", _FILENAME_ASCII.sub("_", filename)).strip("._-")
    if fallback in ("", "visu.json") or not fallback.endswith(".json"):
        fallback = "visu_export.json"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


@router.get("/nodes/{node_id}/export")
async def export_node(
    node_id: str,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
) -> JSONResponse:
    """Exportiert den Knoten und alle Nachfolger rekursiv als JSON (ohne access_pin)."""
    principal = _principal_from_dependency(_user)

    async def collect(nid: str) -> list[dict]:
        if not await _can_discover_node(db, nid, principal):
            return []
        row = await db.fetchone("SELECT * FROM visu_nodes WHERE id = ?", (nid,))
        if not row:
            return []
        page_config = json.loads(row["page_config"]) if row["page_config"] else None
        if row["type"] == "PAGE":
            config = PageConfig.model_validate(page_config or {})
            await _check_page_read_access(db, nid, principal, config)
            # #176 Runde 2: derselbe Leerlauf wie bei `get_page` - nur `includes`
            # wird ersetzt, alle unbekannten Rohfelder bleiben stehen (Export ist
            # sonst bewusst roh, §2.1).
            masked = await _mask_concealed_includes(db, config, principal)
            if masked.includes != config.includes and page_config is not None:
                page_config = {**page_config, "includes": masked.includes}
        policy = await db.fetchone("SELECT access_mode FROM authz_visu_page_policies WHERE node_id = ?", (nid,))
        result = [
            {
                "id": row["id"],
                "parent_id": row["parent_id"],
                "name": row["name"],
                "type": row["type"],
                "kind": row["kind"],
                "node_order": row["node_order"],
                "icon": row["icon"],
                "access": policy["access_mode"] if policy else None,
                "page_config": page_config,
            },
        ]
        children = await db.fetchall("SELECT id FROM visu_nodes WHERE parent_id = ? ORDER BY node_order", (nid,))
        for child in children:
            result.extend(await collect(child["id"]))
        return result

    nodes = await collect(node_id)
    if not nodes:
        raise HTTPException(status_code=404, detail="Knoten nicht gefunden")

    export_data = {
        "obs_export": "visu_subtree",
        "version": 1,
        "exported_at": datetime.now(UTC).isoformat(),
        "nodes": nodes,
    }
    return JSONResponse(
        content=export_data,
        headers={"Content-Disposition": _export_content_disposition(nodes[0]["name"])},
    )


# ── Verschieben ───────────────────────────────────────────────────────────────


@router.put("/nodes/{node_id}/move", response_model=VisuNode)
@audit_application_contract("PUT", "/api/v1/visu/nodes/{node_id}/move", principal_param="_user", resource_param="node_id")
async def move_node(
    node_id: str,
    body: MoveNodeRequest,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    principal = _principal_from_mutation_dependency(_user)
    async with db.transaction():
        await _require_discoverable_node(db, node_id, principal)
        target_ids = await _visu_subtree_ids(db, node_id)
        if body.new_parent_id is not None:
            await _require_discoverable_node(db, body.new_parent_id, principal)
            target_ids.append(body.new_parent_id)
        await _require_visu_generate(db, principal, target_ids)
        await _check_user_target_pages_datapoint_policy_after_access_change(
            db,
            parent_overrides={node_id: body.new_parent_id},
        )
        await db.conn.execute(
            "UPDATE visu_nodes SET parent_id = ?, node_order = ?, updated_at = ? WHERE id = ?",
            (body.new_parent_id, body.order, _now_iso(), node_id),
        )
        await write_application_success(db, None, principal, "PUT", "/api/v1/visu/nodes/{node_id}/move", resource_id=node_id, commit=False)
    return await _node_response_for_principal(db, node_id, principal)


# ── PIN-Authentifizierung ─────────────────────────────────────────────────────


@router.post("/nodes/{node_id}/auth", response_model=PinAuthResponse)
@limiter.limit("10/minute")
@audit_application_contract("POST", "/api/v1/visu/nodes/{node_id}/auth", principal_param=None, resource_param="node_id")
async def pin_auth(
    node_id: str,
    body: PinAuthRequest,
    request: Request,
    db: Database = Depends(get_db),
):
    node = await db.fetchone("SELECT 1 FROM visu_nodes WHERE id = ?", (node_id,))
    if not node:
        raise HTTPException(status_code=404, detail="Knoten nicht gefunden")
    access, defining_node_id = await _resolve_access_with_node(db, node_id)
    if access != "protected" or defining_node_id is None:
        raise HTTPException(status_code=400, detail="Knoten ist nicht PIN-gesichert")
    credential = await db.fetchone(
        "SELECT pin_hash FROM authz_visu_page_credentials WHERE node_id = ?",
        (defining_node_id,),
    )
    if not credential:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")
    if not bcrypt.checkpw(body.pin.encode(), credential["pin_hash"].encode()):
        raise HTTPException(status_code=401, detail="Falscher PIN")
    token = create_session(defining_node_id, expires_in=3600)
    await write_application_success(
        db,
        request,
        None,
        "POST",
        "/api/v1/visu/nodes/{node_id}/auth",
        resource_id=node_id,
        commit=True,
    )
    return PinAuthResponse(session_token=token, expires_in=3600)


# ── Page-Config ───────────────────────────────────────────────────────────────


@router.get("/pages/{node_id}", response_model=PageConfig)
async def get_page(
    node_id: str,
    request: Request,
    # FastAPI injiziert die Response immer; der None-Default hält die Funktion
    # für direkte Aufrufe ohne HTTP-Schicht benutzbar (``Response | None`` lehnt
    # FastAPI als Feldtyp ab).
    response: Response = None,
    db: Database = Depends(get_db),
    user: Principal | str | None = Depends(_optional_visu_principal),
):
    principal = _principal_from_dependency(user)
    node = await _get_node_or_404(db, node_id)
    if node.type != "PAGE":
        raise HTTPException(status_code=400, detail="Knoten ist keine Seite")

    config = node.page_config or PageConfig()
    access = await _check_page_read_access(
        db,
        node_id,
        principal,
        config,
        session_token=request.headers.get("X-Session-Token"),
    )
    config = await _mask_concealed_includes(db, config, principal)
    if response is not None:
        # Include-Quellen kommen über genau diesen Weg; der Host sperrt ihre
        # Widgets nach derselben Regel wie bei /widget-ref (R15). Der Body
        # (PageConfig) trägt kein Zugriffs-Level und der Baum liefert `access`
        # nur roh mit gekappter Elternkette, deshalb diese Naht als Header.
        # Dokumentiert in CONTRIBUTING-visu-m5.md §2.1.
        response.headers["X-Source-Page-Readonly"] = "true" if _source_page_readonly(access) else "false"
    return config


class WritableBatchOut(BaseModel):
    """Per-datapoint writability verdict for the datapoints placed on a page."""

    writable: dict[str, bool]


@router.post("/nodes/{node_id}/writable", response_model=WritableBatchOut)
async def get_writable_datapoints(
    node_id: str,
    request: Request,
    db: Database = Depends(get_db),
    user: Principal | str | None = Depends(_optional_visu_principal),
) -> WritableBatchOut:
    """Report, per datapoint placed on a visu page, whether the current caller
    may write it.

    The verdict is computed with the *exact same* authorization the real write
    path (`POST /api/v1/datapoints/{id}/value`) enforces — the shared
    `_authorize_datapoint_write` helper — so a widget can decide up front which
    controls to render interactive without ever diverging from what an actual
    write attempt would allow. Access is page-scoped like the value route: no
    user JWT is required; readonly pages yield all-false, `central_plant`
    datapoints stay false without a matching grant, and reading the map itself
    requires the same page read access as loading the page.
    """
    principal = _principal_from_dependency(user)
    node = await _get_node_or_404(db, node_id)
    if node.type != "PAGE":
        raise HTTPException(status_code=400, detail="Knoten ist keine Seite")

    config = node.page_config or PageConfig()
    session_token = request.headers.get("X-Session-Token")
    await _check_page_read_access(db, node_id, principal, config, session_token=session_token)

    from obs.api.v1.datapoints import _authorize_datapoint_write
    from obs.core.registry import get_registry

    reg = get_registry()
    writable: dict[str, bool] = {}
    for dp_id_str in _collect_page_datapoint_ids(config):
        dp = reg.get(uuid.UUID(dp_id_str))
        if dp is None:
            writable[dp_id_str] = False
            continue
        try:
            await _authorize_datapoint_write(
                db,
                dp,
                uuid.UUID(dp_id_str),
                user,
                page_id=node_id,
                session_token=session_token,
            )
        except HTTPException:
            writable[dp_id_str] = False
        else:
            writable[dp_id_str] = True
    return WritableBatchOut(writable=writable)


@router.get("/widget-ref/{page_id}", response_model=list[WidgetRefInstance])
async def get_widget_ref(
    page_id: str,
    request: Request,
    db: Database = Depends(get_db),
    user: Principal | str | None = Depends(_optional_visu_principal),
):
    """Gibt alle Widget-Instanzen einer Seite zurück.
    Wird von WidgetRef-Widgets verwendet, die einzelne Widgets aus einer anderen
    Seite einbetten. Zugriff richtet sich nach dem Access-Level der Quell-Seite.
    """
    principal = _principal_from_dependency(user)
    node = await _get_node_or_404(db, page_id)
    if node.type != "PAGE":
        raise HTTPException(status_code=400, detail="Knoten ist keine Seite")

    access, defining_node_id = await _resolve_access_with_node(db, page_id)
    if principal is None:
        if access == "user":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Anmeldung erforderlich",
            )
        elif access == "protected":
            session_token = request.headers.get("X-Session-Token")
            validate_id = defining_node_id or page_id
            if not session_token or not validate_session(session_token, validate_id):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="PIN-Authentifizierung erforderlich",
                )
    else:
        if access == "user" and (principal.type != "user" or not await _check_user_access(db, page_id, principal.subject)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Zugriff verweigert")

    pc = node.page_config or PageConfig()
    if access == "user":
        await _check_page_datapoint_policy(db, principal, _collect_page_datapoint_ids(pc), AuthzAction.READ)
    return [
        WidgetRefInstance.model_validate(
            {
                **widget.model_dump(),
                "source_page_readonly": _source_page_readonly(access),
            }
        )
        for widget in pc.widgets
    ]


@router.put("/pages/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
@audit_application_contract("PUT", "/api/v1/visu/pages/{node_id}", principal_param="_user", resource_param="node_id")
async def save_page(
    node_id: str,
    config: PageConfig,
    request: Request,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    principal = _principal_from_mutation_dependency(_user)
    node = await _require_discoverable_node(db, node_id, principal)
    if node.type != "PAGE":
        raise HTTPException(status_code=400, detail="Knoten ist keine Seite")

    # #176 Runde 2/3: ein Include, das für diesen Principal verdeckt ist (er hat
    # es beim Lesen also nie gesehen) - oder dessen Sichtbarkeit erst zwischen
    # Lesen und Schreiben entstand -, darf ein unveränderter Round-Trip nicht
    # stillschweigend löschen - siehe `_restore_concealed_includes`.
    restored_includes, restored_include_ids = await _restore_concealed_includes(
        db,
        (node.page_config.includes if node.page_config else []),
        config.includes,
        principal,
        stored_at=node.updated_at,
    )
    if restored_includes != config.includes:
        config = config.model_copy(update={"includes": restored_includes})

    used_capability = False
    try:
        if principal.type == "api_key":
            used_capability = await require_config_capability(
                db,
                principal,
                ConfigCapability.VISU_PAGE_CONFIG_WRITE,
                target_type="visu_page",
                target_id=node_id,
                request=request,
            )
        # An API key's exact page-config capability is the resource authority for
        # that page. Human principals still need an explicit GENERATE grant.
        if not used_capability:
            await _require_visu_generate(db, principal, [node_id])
        await _check_page_datapoint_policy(
            db,
            principal,
            sorted(set(_collect_page_datapoint_ids(node.page_config or PageConfig())) | set(_collect_page_datapoint_ids(config))),
            AuthzAction.GENERATE,
        )
        if principal.type == "api_key":
            await _check_page_write_access(db, node_id, principal)
    except HTTPException:
        if used_capability:
            await audit_config_capability_use(
                db,
                principal,
                ConfigCapability.VISU_PAGE_CONFIG_WRITE,
                target_type="visu_page",
                target_id=node_id,
                allowed=False,
                request=request,
            )
        raise

    await _validate_page_kind_config(
        db,
        node_id,
        node.kind,
        config,
        previous_includes=(node.page_config.includes if node.page_config else []),
        restored_include_ids=restored_include_ids,
    )

    access, defining_node_id = await _resolve_access_with_node(db, node_id)
    if access == "user" and defining_node_id is not None:
        await _check_user_page_target_datapoint_policy(db, defining_node_id, config)

    stored_json = config.model_dump_json()
    async with db.transaction():
        await db.conn.execute(
            "UPDATE visu_nodes SET page_config = ?, updated_at = ? WHERE id = ?",
            (stored_json, _now_iso(), node_id),
        )
        # E12: derselbe Stand, der eben in die Spalte ging, wird festgehalten -
        # in derselben Transaktion, damit es keinen Verlaufseintrag zu einem
        # Schreibvorgang gibt, der zurückgerollt wurde. Ein Wiederherstellen
        # läuft ebenfalls hier durch: es ist ein gewöhnliches Speichern.
        await _record_page_version(db, node_id, stored_json, principal)
        await write_application_success(db, request, principal, "PUT", "/api/v1/visu/pages/{node_id}", resource_id=node_id, commit=False)
    from obs.api.v1.websocket import invalidate_datapoint_scopes

    invalidate_datapoint_scopes()
    if used_capability:
        await audit_config_capability_use(
            db,
            principal,
            ConfigCapability.VISU_PAGE_CONFIG_WRITE,
            target_type="visu_page",
            target_id=node_id,
            allowed=True,
            request=request,
        )


# ── Seitenversionen lesen (M5 C6, E12) ────────────────────────────────────────


@router.get("/nodes/{node_id}/versions", response_model=list[VisuPageVersion])
async def get_page_versions(
    node_id: str,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    """Der Verlauf einer Seite, **neueste Version zuerst**.

    Die Ordnung ist Teil der Zusage, nicht Geschmack: der Editor listet von oben,
    Position 0 ist der ausgelieferte Stand und Position 1 der, auf den ein
    „Wiederherstellen" zurückführt.
    """
    await _require_page_history_access(db, node_id, _user)
    rows = await db.fetchall(
        """SELECT revision, created_at, created_by
           FROM visu_page_versions
           WHERE node_id = ?
           ORDER BY revision DESC""",
        (node_id,),
    )
    return [VisuPageVersion(revision=row["revision"], created_at=row["created_at"], created_by=row["created_by"]) for row in rows]


@router.get("/nodes/{node_id}/versions/{revision}", response_model=PageConfig)
async def get_page_version(
    node_id: str,
    revision: int,
    db: Database = Depends(get_db),
    _user: Principal | str = Depends(get_current_principal),
):
    """Ein früherer Stand, in genau der Form, die ``GET /visu/pages/{id}`` liefert.

    Damit ist „Wiederherstellen" ein Zweischritt ohne Umrechnung: diese Antwort
    an ``PUT /visu/pages/{id}`` zurückschicken. Gelesen wird durch die
    Modellschicht (``PageConfig.model_validate``), also mit denselben
    Normalisierungen wie beim Lesen der Seite selbst - sonst könnte der
    wiederhergestellte ``GET`` vom alten abweichen.
    """
    principal = await _require_page_history_access(db, node_id, _user)
    row = await db.fetchone(
        "SELECT page_config FROM visu_page_versions WHERE node_id = ? AND revision = ?",
        (node_id, revision),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Version nicht gefunden")
    config = PageConfig.model_validate(json.loads(row["page_config"]))
    # #176 Runde 2: der Verlauf trägt alte `page_config`-Stände roh - dieselbe
    # Maskierung wie beim aktuellen Stand (`get_page`), sonst leckt ein alter
    # Eintrag, den der Principal heute nicht mehr sehen dürfte.
    return await _mask_concealed_includes(db, config, principal)


# ── Benutzer-Zugang (user-Access) ─────────────────────────────────────────────


@router.get("/nodes/{node_id}/users", response_model=list[str])
async def get_node_users(
    node_id: str,
    db: Database = Depends(get_db),
    _admin=Depends(get_admin_user),
):
    """Gibt die Liste der explizit autorisierten Benutzernamen für diesen Knoten zurück.
    Admins haben immer Zugriff und tauchen hier nicht auf.
    """
    await _get_node_or_404(db, node_id)
    rows = await db.fetchall(
        """SELECT principal_id
           FROM authz_node_roles
           WHERE principal_type='user' AND node_type='visu_page' AND node_id=?
             AND role='guest' AND effect='allow'
           ORDER BY principal_id""",
        (node_id,),
    )
    return [r["principal_id"] for r in rows]


@router.put("/nodes/{node_id}/users", status_code=status.HTTP_204_NO_CONTENT)
@audit_application_contract("PUT", "/api/v1/visu/nodes/{node_id}/users", principal_param="_admin", resource_param="node_id")
async def set_node_users(
    node_id: str,
    body: VisuNodeUsersUpdate,
    db: Database = Depends(get_db),
    _admin: Principal | str = Depends(get_current_principal),
):
    """Setzt die autorisierten Benutzer für diesen Knoten (ersetzt die gesamte Liste).
    Nur gültige (existierende, nicht-Admin) Benutzernamen werden gespeichert.
    """
    principal = _principal_from_mutation_dependency(_admin)
    async with db.transaction():
        await _require_discoverable_node(db, node_id, principal)
        await _require_visu_generate(db, principal, await _visu_subtree_ids(db, node_id))
        valid = await _validate_target_usernames(db, body.usernames)
        await _check_user_target_pages_datapoint_policy(db, node_id, usernames=valid)
        await _replace_target_users(db, node_id, valid)
        await write_application_success(db, None, principal, "PUT", "/api/v1/visu/nodes/{node_id}/users", resource_id=node_id, commit=False)
    from obs.api.v1.websocket import invalidate_datapoint_scopes

    invalidate_datapoint_scopes()
