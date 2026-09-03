"""Seitentypen der Visu (M5, Issue #166) als ausführbare Regeltabelle.

Jeder Test trägt die Regel-Nummer aus `CONTRIBUTING-visu-m5.md` §1 im Namen.
Getestet wird gegen eine echte In-Memory-Datenbank, damit Migration, Spalte,
Validierung und Round-Trip zusammen belegt sind und nicht nur ein Mock.
"""

from __future__ import annotations

import json
import sqlite3
import typing
import uuid
from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

import aiosqlite
import pytest
from fastapi import FastAPI, HTTPException, Response
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from obs.api.auth import Principal
from obs.api.v1 import visu as visu_api
from obs.db.database import MIGRATIONS, Database, _migration_v53_visu_page_kind, get_db
from obs.models.visu import (
    PageConfig,
    PageKind,
    PopupConfig,
    VisuExportNode,
    VisuImportRequest,
    VisuNodeCreate,
    VisuNodeUpdate,
    WidgetInstance,
)

NOW = "2026-09-03T00:00:00+00:00"


@pytest.fixture
async def db() -> Database:
    database = Database(":memory:")
    await database.connect()
    try:
        yield database
    finally:
        await database.disconnect()


def _request() -> MagicMock:
    request = MagicMock()
    request.headers.get.return_value = None
    return request


@asynccontextmanager
async def _client(db: Database, *, principal: Principal | None) -> typing.AsyncIterator[AsyncClient]:
    """Echter HTTP-Pfad durch den Visu-Router, ohne die volle App zu starten.

    Nur so ist belegt, dass FastAPI die `Response` trotz ``= None``-Default
    injiziert und der Header wirklich beim Client ankommt.
    """
    app = FastAPI()
    app.include_router(visu_api.router, prefix="/api/v1/visu")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[visu_api._optional_visu_principal] = lambda: principal
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        yield client


def _widget() -> WidgetInstance:
    return WidgetInstance(id="w-1", name="Licht", type="light", x=0, y=0, w=2, h=2)


async def _insert_node(
    db: Database,
    node_id: str,
    *,
    kind: str = "normal",
    node_type: str = "PAGE",
    config: PageConfig | None = None,
    access: str | None = None,
    parent_id: str | None = None,
    raw_page_config: str | None = None,
) -> None:
    page_config = raw_page_config if raw_page_config is not None else (config or PageConfig()).model_dump_json()
    await db.execute_and_commit(
        """INSERT INTO visu_nodes
               (id, parent_id, name, type, kind, node_order, icon, page_config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)""",
        (node_id, parent_id, node_id, node_type, kind, page_config, NOW, NOW),
    )
    if access is not None:
        await db.execute_and_commit(
            "INSERT INTO authz_visu_page_policies (node_id, access_mode) VALUES (?, ?)",
            (node_id, access),
        )


async def _stored_kind(db: Database, node_id: str) -> str:
    row = await db.fetchone("SELECT kind FROM visu_nodes WHERE id = ?", (node_id,))
    return row["kind"]


async def _save(db: Database, node_id: str, config: PageConfig) -> None:
    await visu_api.save_page(node_id=node_id, config=config, request=None, db=db, _user="admin")


# ── R1: Seitentyp-Enum, Default und Round-Trip ────────────────────────────────


def test_r1_page_kind_has_exactly_the_three_edomi_types() -> None:
    assert set(typing.get_args(PageKind)) == {"normal", "popup", "globalInclude"}


def test_r1_unknown_kind_is_rejected_by_the_model() -> None:
    with pytest.raises(ValidationError):
        VisuNodeCreate(name="Banner", kind="banner")


@pytest.mark.asyncio
async def test_r1_created_page_defaults_to_normal_and_round_trips(db: Database) -> None:
    created = await visu_api.create_node(body=VisuNodeCreate(name="Wohnen"), db=db, _user="admin")

    assert created.kind == "normal"
    assert await _stored_kind(db, created.id) == "normal"
    assert (await visu_api.get_node(node_id=created.id, db=db, user="admin")).kind == "normal"


@pytest.mark.asyncio
async def test_r1_created_popup_round_trips_through_node_summary_and_tree(db: Database) -> None:
    created = await visu_api.create_node(body=VisuNodeCreate(name="Dimmer", kind="popup"), db=db, _user="admin")

    assert created.kind == "popup"
    assert await _stored_kind(db, created.id) == "popup"
    assert (await visu_api.get_node(node_id=created.id, db=db, user="admin")).kind == "popup"
    assert [node.kind for node in await visu_api.get_tree(db=db, user="admin")] == ["popup"]


@pytest.mark.asyncio
async def test_r1_kind_change_is_persisted(db: Database) -> None:
    await _insert_node(db, "seite")

    updated = await visu_api.update_node(
        node_id="seite",
        body=VisuNodeUpdate(kind="globalInclude"),
        db=db,
        _user="admin",
    )

    assert updated.kind == "globalInclude"
    assert await _stored_kind(db, "seite") == "globalInclude"


@pytest.mark.asyncio
async def test_r1_update_without_kind_keeps_the_stored_type(db: Database) -> None:
    await _insert_node(db, "popup-seite", kind="popup")

    updated = await visu_api.update_node(node_id="popup-seite", body=VisuNodeUpdate(name="Neu"), db=db, _user="admin")

    assert updated.kind == "popup"


def test_row_kind_falls_back_to_normal_for_rows_without_the_column() -> None:
    with_kind = {"kind": "popup"}
    without_kind = {"id": "x"}

    assert visu_api._row_kind(with_kind) == "popup"
    assert visu_api._row_kind(without_kind) == "normal"


# ── Seitentyp nur für Seiten ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_location_cannot_be_created_with_a_page_kind(db: Database) -> None:
    with pytest.raises(HTTPException) as exc:
        await visu_api.create_node(body=VisuNodeCreate(name="Ordner", type="LOCATION", kind="popup"), db=db, _user="admin")

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_location_may_be_created_as_normal(db: Database) -> None:
    created = await visu_api.create_node(body=VisuNodeCreate(name="Ordner", type="LOCATION"), db=db, _user="admin")

    assert created.type == "LOCATION"
    assert created.kind == "normal"


@pytest.mark.asyncio
async def test_location_cannot_be_switched_to_a_page_kind(db: Database) -> None:
    await _insert_node(db, "ordner", node_type="LOCATION")

    with pytest.raises(HTTPException) as exc:
        await visu_api.update_node(node_id="ordner", body=VisuNodeUpdate(kind="globalInclude"), db=db, _user="admin")

    assert exc.value.status_code == 400
    assert await _stored_kind(db, "ordner") == "normal"


# ── R2/R3/R4/R5/R6: Popup-Konfiguration ───────────────────────────────────────


@pytest.mark.asyncio
async def test_r2_r3_r4_r5_r6_popup_config_is_persisted_unchanged(db: Database) -> None:
    await _insert_node(db, "popup", kind="popup")
    popup = PopupConfig(
        x=120,
        y=64,
        w=480,
        h=320,
        auto_close_ms=5000,
        modal=True,
        animate=True,
        shadow=True,
        dim_backdrop=True,
    )

    await _save(db, "popup", PageConfig(widgets=[_widget()], popup=popup))

    stored = await visu_api.get_page(node_id="popup", request=_request(), db=db, user="admin")
    assert stored.popup == popup


@pytest.mark.asyncio
async def test_r2_missing_popup_coordinate_stays_none(db: Database) -> None:
    await _insert_node(db, "popup", kind="popup")

    await _save(db, "popup", PageConfig(popup=PopupConfig(x=200, w=300)))

    stored = await visu_api.get_page(node_id="popup", request=_request(), db=db, user="admin")
    assert stored.popup is not None
    assert stored.popup.x == 200
    assert stored.popup.y is None
    assert stored.popup.h is None


@pytest.mark.asyncio
async def test_r5_popup_defaults_are_all_off(db: Database) -> None:
    await _insert_node(db, "popup", kind="popup")

    await _save(db, "popup", PageConfig(popup=PopupConfig()))

    stored = await visu_api.get_page(node_id="popup", request=_request(), db=db, user="admin")
    assert stored.popup is not None
    assert (stored.popup.modal, stored.popup.animate, stored.popup.shadow, stored.popup.dim_backdrop) == (
        False,
        False,
        False,
        False,
    )
    assert stored.popup.auto_close_ms is None


@pytest.mark.asyncio
async def test_popup_config_on_a_normal_page_is_rejected(db: Database) -> None:
    await _insert_node(db, "normale-seite")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "normale-seite", PageConfig(popup=PopupConfig(modal=True)))

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_normal_page_without_popup_config_is_accepted(db: Database) -> None:
    await _insert_node(db, "normale-seite")

    await _save(db, "normale-seite", PageConfig(widgets=[_widget()]))

    stored = await visu_api.get_page(node_id="normale-seite", request=_request(), db=db, user="admin")
    assert stored.popup is None


@pytest.mark.asyncio
async def test_kind_change_away_from_popup_is_rejected_while_popup_config_remains(db: Database) -> None:
    await _insert_node(db, "popup", kind="popup", config=PageConfig(popup=PopupConfig(modal=True)))

    with pytest.raises(HTTPException) as exc:
        await visu_api.update_node(node_id="popup", body=VisuNodeUpdate(kind="normal"), db=db, _user="admin")

    assert exc.value.status_code == 400
    assert await _stored_kind(db, "popup") == "popup"


# ── R12: globale Inkludeseite inkludiert selbst nichts ────────────────────────


@pytest.mark.asyncio
async def test_r12_global_include_cannot_include_another_page(db: Database) -> None:
    await _insert_node(db, "quelle")
    await _insert_node(db, "global", kind="globalInclude")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "global", PageConfig(includes=["quelle"]))

    assert exc.value.status_code == 400
    assert "globale Inkludeseite" in exc.value.detail


@pytest.mark.asyncio
async def test_r12_global_include_without_includes_is_accepted(db: Database) -> None:
    await _insert_node(db, "global", kind="globalInclude")

    await _save(db, "global", PageConfig(widgets=[_widget()]))

    stored = await visu_api.get_page(node_id="global", request=_request(), db=db, user="admin")
    assert stored.includes == []


@pytest.mark.asyncio
async def test_r12_switching_to_global_include_is_rejected_while_includes_remain(db: Database) -> None:
    await _insert_node(db, "quelle")
    await _insert_node(db, "seite", config=PageConfig(includes=["quelle"]))

    with pytest.raises(HTTPException) as exc:
        await visu_api.update_node(node_id="seite", body=VisuNodeUpdate(kind="globalInclude"), db=db, _user="admin")

    assert exc.value.status_code == 400
    assert await _stored_kind(db, "seite") == "normal"


# ── R13: normale Seite kann globale Includes ignorieren ───────────────────────


@pytest.mark.asyncio
async def test_r13_ignore_global_includes_persists_both_ways(db: Database) -> None:
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(ignore_global_includes=True))
    assert (await visu_api.get_page(node_id="seite", request=_request(), db=db, user="admin")).ignore_global_includes is True

    await _save(db, "seite", PageConfig(ignore_global_includes=False))
    assert (await visu_api.get_page(node_id="seite", request=_request(), db=db, user="admin")).ignore_global_includes is False


# ── R14: individuelle Inkludeseiten ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_r14_includes_persist_in_the_authored_order(db: Database) -> None:
    await _insert_node(db, "kopf")
    await _insert_node(db, "fuss")
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(includes=["fuss", "kopf"]))

    stored = await visu_api.get_page(node_id="seite", request=_request(), db=db, user="admin")
    assert stored.includes == ["fuss", "kopf"]


@pytest.mark.asyncio
async def test_r14_a_global_include_is_a_valid_include_target(db: Database) -> None:
    await _insert_node(db, "global", kind="globalInclude")
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(includes=["global"]))

    stored = await visu_api.get_page(node_id="seite", request=_request(), db=db, user="admin")
    assert stored.includes == ["global"]


@pytest.mark.asyncio
async def test_r14_missing_include_target_is_rejected(db: Database) -> None:
    await _insert_node(db, "seite")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "seite", PageConfig(includes=["gibt-es-nicht"]))

    assert exc.value.status_code == 400
    assert "existiert nicht" in exc.value.detail


@pytest.mark.asyncio
async def test_r14_location_as_include_target_is_rejected(db: Database) -> None:
    await _insert_node(db, "ordner", node_type="LOCATION")
    await _insert_node(db, "seite")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "seite", PageConfig(includes=["ordner"]))

    assert exc.value.status_code == 400
    assert "keine Seite" in exc.value.detail


@pytest.mark.asyncio
async def test_r14_popup_as_include_target_is_rejected(db: Database) -> None:
    await _insert_node(db, "popup", kind="popup")
    await _insert_node(db, "seite")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "seite", PageConfig(includes=["popup"]))

    assert exc.value.status_code == 400
    assert "Popup" in exc.value.detail


@pytest.mark.asyncio
async def test_r14_popup_page_cannot_include_anything(db: Database) -> None:
    await _insert_node(db, "quelle")
    await _insert_node(db, "popup", kind="popup")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "popup", PageConfig(includes=["quelle"]))

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_r14_self_include_is_rejected(db: Database) -> None:
    await _insert_node(db, "seite")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "seite", PageConfig(includes=["seite"]))

    assert exc.value.status_code == 400
    assert "selbst inkludieren" in exc.value.detail


@pytest.mark.asyncio
async def test_r14_multi_level_include_cycle_is_rejected(db: Database) -> None:
    await _insert_node(db, "a")
    await _insert_node(db, "b", config=PageConfig(includes=["c"]))
    await _insert_node(db, "c", config=PageConfig(includes=["a"]))

    with pytest.raises(HTTPException) as exc:
        await _save(db, "a", PageConfig(includes=["b"]))

    assert exc.value.status_code == 400
    assert "Zyklus" in exc.value.detail


@pytest.mark.asyncio
async def test_r14_diamond_graph_and_dangling_nested_target_stay_valid(db: Database) -> None:
    # b und c inkludieren beide d (Diamant, kein Zyklus); d zeigt zusätzlich auf
    # eine gelöschte Seite, was die Zyklusprüfung überspringen können muss.
    await _insert_node(db, "d", config=PageConfig(includes=["geloescht"]))
    await _insert_node(db, "b", config=PageConfig(includes=["d"]))
    await _insert_node(db, "c", config=PageConfig(includes=["d"]))
    await _insert_node(db, "a")

    await _save(db, "a", PageConfig(includes=["b", "c"]))

    stored = await visu_api.get_page(node_id="a", request=_request(), db=db, user="admin")
    assert stored.includes == ["b", "c"]


@pytest.mark.asyncio
async def test_r14_nested_target_without_page_config_is_skipped(db: Database) -> None:
    await _insert_node(db, "leer", raw_page_config="")
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(includes=["leer"]))

    stored = await visu_api.get_page(node_id="seite", request=_request(), db=db, user="admin")
    assert stored.includes == ["leer"]


# ── Popup darf nie Include-Ziel sein, auch nicht nachträglich ─────────────────


@pytest.mark.asyncio
async def test_included_page_cannot_become_a_popup(db: Database) -> None:
    await _insert_node(db, "quelle")
    await _insert_node(db, "seite", config=PageConfig(includes=["quelle"]))

    with pytest.raises(HTTPException) as exc:
        await visu_api.update_node(node_id="quelle", body=VisuNodeUpdate(kind="popup"), db=db, _user="admin")

    assert exc.value.status_code == 400
    assert await _stored_kind(db, "quelle") == "normal"


@pytest.mark.asyncio
async def test_unreferenced_page_may_become_a_popup(db: Database) -> None:
    await _insert_node(db, "frei")
    await _insert_node(db, "seite", config=PageConfig(widgets=[_widget()]))

    updated = await visu_api.update_node(node_id="frei", body=VisuNodeUpdate(kind="popup"), db=db, _user="admin")

    assert updated.kind == "popup"


@pytest.mark.asyncio
async def test_kind_change_survives_a_row_with_unparsable_page_config(db: Database) -> None:
    # Eine Zeile ohne gültiges JSON darf die Include-Rückwärtssuche nicht sprengen.
    await _insert_node(db, "kaputt", raw_page_config="")
    await _insert_node(db, "frei")

    updated = await visu_api.update_node(node_id="frei", body=VisuNodeUpdate(kind="popup"), db=db, _user="admin")

    assert updated.kind == "popup"


# ── Verwaiste und verdeckte Include-Ziele (R14/R17) ───────────────────────────


async def _raw_includes(db: Database, node_id: str) -> list[str]:
    row = await db.fetchone("SELECT page_config FROM visu_nodes WHERE id = ?", (node_id,))
    return json.loads(row["page_config"])["includes"]


@pytest.mark.asyncio
async def test_deleting_an_include_target_drops_the_reference_from_the_source_page(db: Database) -> None:
    """Aufräumen statt Karteileiche: die gewählte Seite beim Löschen (siehe `_drop_include_references`)."""
    await _insert_node(db, "ziel")
    await _insert_node(db, "bleibt")
    await _insert_node(db, "quelle", config=PageConfig(includes=["ziel", "bleibt"]))

    await visu_api.delete_node(node_id="ziel", db=db, _user="admin")

    assert await _raw_includes(db, "quelle") == ["bleibt"]


@pytest.mark.asyncio
async def test_deleting_a_location_also_drops_references_to_its_child_pages(db: Database) -> None:
    await _insert_node(db, "bereich", node_type="LOCATION")
    await _insert_node(db, "unterseite", parent_id="bereich")
    await _insert_node(db, "quelle", config=PageConfig(includes=["unterseite"]))

    await visu_api.delete_node(node_id="bereich", db=db, _user="admin")

    assert await _raw_includes(db, "quelle") == []


@pytest.mark.asyncio
async def test_deleting_a_page_nobody_includes_leaves_other_pages_untouched(db: Database) -> None:
    await _insert_node(db, "einsam")
    await _insert_node(db, "ziel")
    await _insert_node(db, "quelle", config=PageConfig(includes=["ziel"]))

    await visu_api.delete_node(node_id="einsam", db=db, _user="admin")

    assert await _raw_includes(db, "quelle") == ["ziel"]


@pytest.mark.asyncio
async def test_cleanup_keeps_unknown_page_config_fields_of_a_v1_config(db: Database) -> None:
    # R17: Die Aufräum-Schreibung geht über die rohe JSON-Struktur, damit
    # Felder, die das aktuelle Modell nicht kennt, nicht verloren gehen.
    await _insert_node(db, "ziel")
    await _insert_node(
        db,
        "quelle",
        raw_page_config=json.dumps({"widgets": [], "includes": ["ziel"], "zukunftsfeld": {"a": 1}}),
    )

    await visu_api.delete_node(node_id="ziel", db=db, _user="admin")

    row = await db.fetchone("SELECT page_config FROM visu_nodes WHERE id = 'quelle'")
    stored = json.loads(row["page_config"])
    assert stored["includes"] == []
    assert stored["zukunftsfeld"] == {"a": 1}


@pytest.mark.asyncio
async def test_an_orphaned_include_entry_does_not_block_saving_the_source_page(db: Database) -> None:
    """Der Bugfix: ein bereits gespeicherter, inzwischen verwaister Eintrag sperrt nichts.

    Solche Einträge entstehen trotz Aufräumen weiter (Import eines Teilbaums
    ohne das Ziel, Kopie, parallele Löschung). V1 schickt die geladene Config
    unverändert zurück und hat keine Include-UI – ohne diese Duldung wäre die
    Seite dauerhaft unspeicherbar (R17).
    """
    await _insert_node(db, "quelle", config=PageConfig(includes=["nie-dagewesen"]))

    await _save(db, "quelle", PageConfig(includes=["nie-dagewesen"], widgets=[_widget()]))

    stored = await visu_api.get_page(node_id="quelle", request=_request(), db=db, user="admin")
    assert stored.includes == ["nie-dagewesen"]
    assert len(stored.widgets) == 1


@pytest.mark.asyncio
async def test_a_new_include_target_that_does_not_exist_is_still_rejected(db: Database) -> None:
    """Gegenzweig: die Duldung gilt nur für unveränderte Alt-Einträge."""
    await _insert_node(db, "quelle", config=PageConfig(includes=["nie-dagewesen"]))

    with pytest.raises(HTTPException) as exc:
        await _save(db, "quelle", PageConfig(includes=["nie-dagewesen", "auch-nicht-da"]))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Include-Ziel existiert nicht"


@pytest.mark.asyncio
async def test_a_row_without_a_stored_page_config_has_no_previous_includes(db: Database) -> None:
    # Bestandszeile ohne page_config (V1/Legacy): es gibt keine Alt-Einträge,
    # also wird jeder Include beim ersten Speichern voll geprüft.
    await _insert_node(db, "leer", raw_page_config="")
    await _insert_node(db, "ziel")

    await _save(db, "leer", PageConfig(includes=["ziel"]))
    with pytest.raises(HTTPException) as exc:
        await _save(db, "leer", PageConfig(includes=["ziel", "fehlt"]))

    assert await _raw_includes(db, "leer") == ["ziel"]
    assert exc.value.status_code == 400
    assert exc.value.detail == "Include-Ziel existiert nicht"


@pytest.mark.asyncio
async def test_a_new_include_target_that_is_a_popup_is_still_rejected(db: Database) -> None:
    await _insert_node(db, "quelle", config=PageConfig(includes=["nie-dagewesen"]))
    await _insert_node(db, "popup", kind="popup")

    with pytest.raises(HTTPException) as exc:
        await _save(db, "quelle", PageConfig(includes=["nie-dagewesen", "popup"]))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Eine Popup-Seite kann nicht inkludiert werden"


@pytest.mark.asyncio
async def test_a_self_include_is_rejected_even_as_a_stored_entry(db: Database) -> None:
    # Die Duldung erfasst nur die Ziel-Prüfung gegen die Datenbank, nicht die
    # Invarianten, die ohne Ziel entscheidbar sind.
    await _insert_node(db, "quelle", config=PageConfig(includes=["quelle"]))

    with pytest.raises(HTTPException) as exc:
        await _save(db, "quelle", PageConfig(includes=["quelle"]))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Eine Seite kann sich nicht selbst inkludieren"


@pytest.mark.asyncio
async def test_a_kind_change_is_not_blocked_by_an_orphaned_include_entry(db: Database) -> None:
    await _insert_node(db, "quelle", config=PageConfig(includes=["nie-dagewesen"]))

    updated = await visu_api.update_node(node_id="quelle", body=VisuNodeUpdate(kind="normal"), db=db, _user="admin")

    assert updated.kind == "normal"


@pytest.mark.asyncio
async def test_a_kind_change_to_popup_is_still_rejected_with_an_orphaned_include_entry(db: Database) -> None:
    await _insert_node(db, "quelle", config=PageConfig(includes=["nie-dagewesen"]))

    with pytest.raises(HTTPException) as exc:
        await visu_api.update_node(node_id="quelle", body=VisuNodeUpdate(kind="popup"), db=db, _user="admin")

    assert exc.value.status_code == 400
    assert exc.value.detail == "Eine Popup-Seite kann keine Seiten inkludieren"


@pytest.mark.asyncio
async def test_a_concealed_include_target_does_not_block_saving_the_source_page(db: Database) -> None:
    """Zweiter Fall des Bugs: das Ziel existiert, ist für den Speichernden aber verdeckt."""
    await db.execute_and_commit(
        "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, 'alice', 'hash', 0, ?)",
        (str(uuid.uuid4()), NOW),
    )
    await _insert_node(db, "verdeckt", access="user")
    await _insert_node(db, "quelle", access="public", config=PageConfig(includes=["verdeckt"]))
    await db.execute_and_commit(
        """INSERT INTO authz_node_roles (principal_type, principal_id, node_type, node_id, role, effect)
           VALUES ('user', 'alice', 'visu_page', 'quelle', 'operator', 'allow')""",
    )
    alice = Principal(subject="alice", type="user", is_admin=False)

    with pytest.raises(HTTPException) as read_exc:
        await visu_api.get_page(node_id="verdeckt", request=_request(), db=db, user=alice)
    await visu_api.save_page(
        node_id="quelle",
        config=PageConfig(includes=["verdeckt"], widgets=[_widget()]),
        request=_request(),
        db=db,
        _user=alice,
    )

    assert read_exc.value.status_code == 403  # verdeckt für Alice
    assert await _raw_includes(db, "quelle") == ["verdeckt"]


# ── R15: Zugriffsgrenze über einen Include hinweg ─────────────────────────────


@pytest.mark.asyncio
async def test_r15_readonly_include_source_is_marked_readonly(db: Database) -> None:
    await _insert_node(db, "quelle", access="readonly", config=PageConfig(widgets=[_widget()]))
    response = Response()

    await visu_api.get_page(node_id="quelle", request=_request(), response=response, db=db, user="admin")
    widgets = await visu_api.get_widget_ref(page_id="quelle", request=_request(), db=db, user="admin")

    assert response.headers["X-Source-Page-Readonly"] == "true"
    assert [widget.source_page_readonly for widget in widgets] == [True]


@pytest.mark.asyncio
async def test_r15_writable_include_source_is_not_marked_readonly(db: Database) -> None:
    await _insert_node(db, "quelle", access="public", config=PageConfig(widgets=[_widget()]))
    response = Response()

    await visu_api.get_page(node_id="quelle", request=_request(), response=response, db=db, user="admin")
    widgets = await visu_api.get_widget_ref(page_id="quelle", request=_request(), db=db, user="admin")

    assert response.headers["X-Source-Page-Readonly"] == "false"
    assert [widget.source_page_readonly for widget in widgets] == [False]


@pytest.mark.asyncio
async def test_r15_page_read_without_a_response_object_still_serves_the_config(db: Database) -> None:
    await _insert_node(db, "quelle", access="readonly", config=PageConfig(widgets=[_widget()]))

    stored = await visu_api.get_page(node_id="quelle", request=_request(), db=db, user="admin")

    assert len(stored.widgets) == 1


@pytest.mark.asyncio
async def test_r15_unreadable_include_source_is_concealed_in_navigation_and_denied_on_read(db: Database) -> None:
    """Der Verdeckungs-Vertrag aus CONTRIBUTING-visu-m5.md §2.1, festgenagelt.

    Verdeckung entsteht auf der **Navigationsebene** (Baum leer, `get_node` 404).
    Der Seiteninhalt antwortet dagegen mit 403 – das ist das bewusst gewählte,
    von der authz-Welle stammende Verhalten (`tests/unit/test_visu_authz.py`,
    z. B. `test_export_hides_user_page_from_api_key_with_visu_grant`) und keine
    Neuerung von M5. Der Host behandelt 401/403/404 gemeinsam als „verdeckt".
    """
    await db.execute_and_commit(
        "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, 'mallory', 'hash', 0, ?)",
        (str(uuid.uuid4()), NOW),
    )
    await _insert_node(db, "geheim", access="user", config=PageConfig(widgets=[_widget()]))
    principal = Principal(subject="mallory", type="user", is_admin=False)

    with pytest.raises(HTTPException) as node_exc:
        await visu_api.get_node(node_id="geheim", db=db, user=principal)
    with pytest.raises(HTTPException) as page_exc:
        await visu_api.get_page(node_id="geheim", request=_request(), response=Response(), db=db, user=principal)

    assert node_exc.value.status_code == 404  # verdeckt: der Knoten existiert für Mallory nicht
    assert page_exc.value.status_code == 403
    assert await visu_api.get_tree(db=db, user=principal) == []


@pytest.mark.asyncio
async def test_r15_http_signal_list_for_an_include_source_without_read_right(db: Database) -> None:
    """Über den echten HTTP-Pfad: was bekommt ein Principal ohne Leserecht?

    Belegt die Signalliste, gegen die Teil B baut. 404 ist nicht darunter, weil
    die Seite existiert – deshalb steht in §2.1 die vollständige Liste 401/403/404.
    """
    await db.execute_and_commit(
        "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, 'mallory', 'hash', 0, ?)",
        (str(uuid.uuid4()), NOW),
    )
    await _insert_node(db, "user-quelle", access="user", config=PageConfig(widgets=[_widget()]))
    await _insert_node(db, "pin-quelle", access="protected", config=PageConfig(widgets=[_widget()]))
    mallory = Principal(subject="mallory", type="user", is_admin=False)

    async with _client(db, principal=mallory) as client:
        without_grant = await client.get("/api/v1/visu/pages/user-quelle")
    async with _client(db, principal=None) as client:
        anonymous_user_page = await client.get("/api/v1/visu/pages/user-quelle")
        anonymous_pin_page = await client.get("/api/v1/visu/pages/pin-quelle")
        missing_page = await client.get("/api/v1/visu/pages/gibt-es-nicht")

    assert without_grant.status_code == 403
    assert without_grant.json()["detail"] == "Zugriff verweigert"
    assert anonymous_user_page.status_code == 401
    assert anonymous_user_page.json()["detail"] == "Anmeldung erforderlich"
    assert anonymous_pin_page.status_code == 401
    assert anonymous_pin_page.json()["detail"] == "PIN-Authentifizierung erforderlich"
    assert missing_page.status_code == 404
    # Kein Body verrät etwas über die Seite, und der readonly-Header fehlt.
    assert "X-Source-Page-Readonly" not in without_grant.headers


@pytest.mark.asyncio
async def test_r15_readonly_header_reaches_the_client_over_http(db: Database) -> None:
    """Die Naht selbst: FastAPI injiziert `response` trotz `= None`-Default."""
    await _insert_node(db, "readonly-quelle", access="readonly", config=PageConfig(widgets=[_widget()]))
    await _insert_node(db, "offene-quelle", access="public", config=PageConfig(widgets=[_widget()]))

    async with _client(db, principal=None) as client:
        readonly = await client.get("/api/v1/visu/pages/readonly-quelle")
        writable = await client.get("/api/v1/visu/pages/offene-quelle")

    assert readonly.status_code == 200
    assert readonly.headers["X-Source-Page-Readonly"] == "true"
    assert writable.status_code == 200
    assert writable.headers["X-Source-Page-Readonly"] == "false"
    # Der Header ist die einzige Quelle: der Body trägt kein Zugriffs-Level.
    assert "access" not in readonly.json()


@pytest.mark.asyncio
async def test_r15_readonly_inherited_from_the_parent_chain_reaches_the_client(db: Database) -> None:
    await _insert_node(db, "wurzel", node_type="LOCATION", access="readonly")
    await _insert_node(db, "kind", parent_id="wurzel", config=PageConfig(widgets=[_widget()]))

    async with _client(db, principal=None) as client:
        inherited = await client.get("/api/v1/visu/pages/kind")

    assert inherited.status_code == 200
    assert inherited.headers["X-Source-Page-Readonly"] == "true"


def test_source_page_readonly_derives_only_from_the_readonly_level() -> None:
    assert visu_api._source_page_readonly("readonly") is True
    assert visu_api._source_page_readonly("public") is False


# ── Kopieren, Export, Import ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_copy_carries_the_page_kind(db: Database) -> None:
    await _insert_node(db, "popup", kind="popup", config=PageConfig(popup=PopupConfig(modal=True)))

    copy = await visu_api.copy_node(
        node_id="popup",
        body=visu_api.CopyNodeRequest(target_parent_id=None, new_name="Popup Kopie"),
        db=db,
        _user="admin",
    )

    assert copy.kind == "popup"
    assert copy.page_config is not None
    assert copy.page_config.popup is not None
    assert copy.page_config.popup.modal is True


@pytest.mark.asyncio
async def test_export_carries_kind_includes_and_popup(db: Database) -> None:
    await _insert_node(db, "global", kind="globalInclude")
    await _insert_node(db, "seite", config=PageConfig(includes=["global"], ignore_global_includes=True))

    exported = json.loads((await visu_api.export_node(node_id="seite", db=db, _user="admin")).body)

    assert exported["nodes"][0]["kind"] == "normal"
    assert exported["nodes"][0]["page_config"]["includes"] == ["global"]
    assert exported["nodes"][0]["page_config"]["ignore_global_includes"] is True


@pytest.mark.asyncio
async def test_import_carries_kind_and_remaps_includes_to_the_new_ids(db: Database) -> None:
    body = VisuImportRequest(
        obs_export="visu_subtree",
        version=1,
        nodes=[
            VisuExportNode(
                id="alt-seite",
                parent_id=None,
                name="Seite",
                type="PAGE",
                page_config={"includes": ["alt-global"]},
            ),
            VisuExportNode(
                id="alt-global",
                parent_id="alt-seite",
                name="Global",
                type="PAGE",
                kind="globalInclude",
                page_config={"widgets": []},
            ),
        ],
    )

    root = await visu_api.import_nodes(body=body, db=db, _user="admin")

    child = await db.fetchone("SELECT id, kind FROM visu_nodes WHERE parent_id = ?", (root.id,))
    assert root.kind == "normal"
    assert child["kind"] == "globalInclude"
    assert root.page_config is not None
    assert root.page_config.includes == [child["id"]]


@pytest.mark.asyncio
async def test_import_keeps_an_include_target_outside_the_export(db: Database) -> None:
    await _insert_node(db, "bestand")
    body = VisuImportRequest(
        obs_export="visu_subtree",
        version=1,
        nodes=[
            VisuExportNode(id="alt", parent_id=None, name="Seite", type="PAGE", page_config={"includes": ["bestand"]}),
        ],
    )

    root = await visu_api.import_nodes(body=body, db=db, _user="admin")

    assert root.page_config is not None
    assert root.page_config.includes == ["bestand"]


@pytest.mark.asyncio
async def test_import_of_a_location_with_a_page_child_keeps_both_kinds(db: Database) -> None:
    body = VisuImportRequest(
        obs_export="visu_subtree",
        version=1,
        nodes=[
            VisuExportNode(id="alt-ordner", parent_id=None, name="Ordner", type="LOCATION"),
            VisuExportNode(id="alt-popup", parent_id="alt-ordner", name="Popup", type="PAGE", kind="popup"),
        ],
    )

    root = await visu_api.import_nodes(body=body, db=db, _user="admin")

    child = await db.fetchone("SELECT kind FROM visu_nodes WHERE parent_id = ?", (root.id,))
    assert root.type == "LOCATION"
    assert root.kind == "normal"
    assert child["kind"] == "popup"


@pytest.mark.asyncio
async def test_import_rejects_a_global_include_that_includes(db: Database) -> None:
    await _insert_node(db, "bestand")
    body = VisuImportRequest(
        obs_export="visu_subtree",
        version=1,
        nodes=[
            VisuExportNode(
                id="alt",
                parent_id=None,
                name="Global",
                type="PAGE",
                kind="globalInclude",
                page_config={"includes": ["bestand"]},
            ),
        ],
    )

    with pytest.raises(HTTPException) as exc:
        await visu_api.import_nodes(body=body, db=db, _user="admin")

    assert exc.value.status_code == 400
    assert await db.fetchall("SELECT id FROM visu_nodes WHERE name = 'Global'") == []


@pytest.mark.asyncio
async def test_import_rejects_a_location_with_a_page_kind(db: Database) -> None:
    body = VisuImportRequest(
        obs_export="visu_subtree",
        version=1,
        nodes=[VisuExportNode(id="alt", parent_id=None, name="Ordner", type="LOCATION", kind="popup")],
    )

    with pytest.raises(HTTPException) as exc:
        await visu_api.import_nodes(body=body, db=db, _user="admin")

    assert exc.value.status_code == 400


# ── R17: V1-Kompatibilität und Migration von Bestandsdaten ────────────────────


@pytest.mark.asyncio
async def test_r17_legacy_page_config_gains_the_new_fields_as_defaults(db: Database) -> None:
    legacy = '{"grid_cols":12,"grid_row_height":80,"background":null,"widgets":[]}'
    await _insert_node(db, "v1-seite", raw_page_config=legacy)

    stored = await visu_api.get_page(node_id="v1-seite", request=_request(), db=db, user="admin")

    assert stored.includes == []
    assert stored.ignore_global_includes is False
    assert stored.popup is None
    assert stored.grid_cols == 12


@pytest.mark.asyncio
async def test_r17_unknown_page_config_fields_do_not_break_the_read(db: Database) -> None:
    await _insert_node(db, "fremd", raw_page_config='{"widgets":[],"zukunft":{"a":1}}')

    stored = await visu_api.get_page(node_id="fremd", request=_request(), db=db, user="admin")

    assert stored.widgets == []


def test_r17_export_without_kind_still_validates() -> None:
    node = VisuExportNode(id="alt", parent_id=None, name="Seite", type="PAGE")

    assert node.kind == "normal"


@pytest.mark.asyncio
async def test_r17_fresh_database_has_the_kind_column_at_schema_53(db: Database) -> None:
    columns = {row["name"] for row in await db.fetchall("PRAGMA table_info(visu_nodes)")}
    version = await db.fetchone("SELECT MAX(version) AS v FROM schema_version")

    assert "kind" in columns
    assert version["v"] >= 53


@pytest.mark.asyncio
async def test_r17_migration_v53_defaults_existing_pages_to_normal_and_keeps_policies(tmp_path) -> None:
    conn = await aiosqlite.connect(tmp_path / "legacy-v52.sqlite")
    conn.row_factory = aiosqlite.Row
    try:
        await conn.executescript(
            """
            PRAGMA foreign_keys=ON;
            CREATE TABLE visu_nodes (
                id          TEXT PRIMARY KEY,
                parent_id   TEXT REFERENCES visu_nodes(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                type        TEXT NOT NULL DEFAULT 'PAGE',
                node_order  INTEGER NOT NULL DEFAULT 0,
                page_config TEXT NOT NULL DEFAULT '{}',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE TABLE authz_visu_page_policies (
                node_id     TEXT PRIMARY KEY REFERENCES visu_nodes(id) ON DELETE CASCADE,
                access_mode TEXT NOT NULL
            );
            INSERT INTO visu_nodes (id, parent_id, name, type, node_order, page_config, created_at, updated_at)
            VALUES ('home', NULL, 'Home', 'PAGE', 0, '{"widgets":[]}', '', ''),
                   ('keller', 'home', 'Keller', 'PAGE', 1, '{"widgets":[]}', '', '');
            INSERT INTO authz_visu_page_policies VALUES ('keller', 'readonly');
            """
        )
        await conn.commit()

        await _migration_v53_visu_page_kind(conn)
        await conn.commit()

        rows = await (await conn.execute("SELECT id, kind FROM visu_nodes ORDER BY id")).fetchall()
        policies = await (await conn.execute("SELECT node_id, access_mode FROM authz_visu_page_policies")).fetchall()
        assert [(row["id"], row["kind"]) for row in rows] == [("home", "normal"), ("keller", "normal")]
        # Der Copy-Migrationspfad (DROP TABLE) hätte diese Zeile per ON DELETE CASCADE gelöscht
        # (als Assertion belegt in test_a_copy_rename_migration_on_visu_nodes_would_delete_policies_and_pins).
        assert [(row["node_id"], row["access_mode"]) for row in policies] == [("keller", "readonly")]

        # Zweiter Lauf ist ein No-op, kein doppeltes ADD COLUMN.
        await _migration_v53_visu_page_kind(conn)
        await conn.commit()
        assert len(await (await conn.execute("SELECT kind FROM visu_nodes")).fetchall()) == 2

        with pytest.raises(sqlite3.IntegrityError):
            await conn.execute(
                "INSERT INTO visu_nodes (id, name, page_config, created_at, updated_at, kind) VALUES ('x', 'X', '{}', '', '', 'banner')"
            )
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_r17_migration_v53_ignores_a_database_without_visu_nodes(tmp_path) -> None:
    conn = await aiosqlite.connect(tmp_path / "empty.sqlite")
    conn.row_factory = aiosqlite.Row
    try:
        await _migration_v53_visu_page_kind(conn)
    finally:
        await conn.close()


_MIGRATIONS_UP_TO_V52 = [entry for entry in MIGRATIONS if entry[0] <= 52]


async def _seed_v52_database(path) -> None:
    """Baut eine Bestands-DB über die **echte** Migrationskette bis exakt v52."""
    with patch("obs.db.database.MIGRATIONS", _MIGRATIONS_UP_TO_V52):
        legacy = Database(str(path))
        await legacy.connect()
        try:
            version = await legacy.fetchone("SELECT MAX(version) AS v FROM schema_version")
            columns = {row["name"] for row in await legacy.fetchall("PRAGMA table_info(visu_nodes)")}
            assert version["v"] == 52
            assert "kind" not in columns  # sonst prüft der Test nicht, was er behauptet
            await legacy.execute_and_commit(
                """INSERT INTO visu_nodes (id, parent_id, name, type, node_order, page_config, created_at, updated_at)
                   VALUES ('home', NULL, 'Home', 'PAGE', 0, '{"widgets":[]}', ?, ?),
                          ('keller', 'home', 'Keller', 'PAGE', 1, '{"widgets":[]}', ?, ?)""",
                (NOW, NOW, NOW, NOW),
            )
            await legacy.execute_and_commit(
                "INSERT INTO authz_visu_page_policies (node_id, access_mode) VALUES ('keller', 'protected')",
            )
            await legacy.execute_and_commit(
                "INSERT INTO authz_visu_page_credentials (node_id, pin_hash, updated_at) VALUES ('keller', 'bcrypt-hash', ?)",
                (NOW,),
            )
            await legacy.execute_and_commit(
                """INSERT INTO authz_node_roles (principal_type, principal_id, node_type, node_id, role, effect)
                   VALUES ('user', 'bob', 'visu_page', 'keller', 'guest', 'allow')""",
            )
        finally:
            await legacy.disconnect()


@pytest.mark.asyncio
async def test_r17_migration_v53_over_the_real_chain_keeps_the_whole_access_stock(tmp_path) -> None:
    """§5 „Migration gegen Bestands-DB": echte Kette v0→v52, dann der echte Runner auf v53.

    Der Schwestertest oben baut das v52-Schema von Hand nach (schnell, isoliert);
    dieser hier fährt denselben Weg wie eine echte Installation.
    """
    path = tmp_path / "bestand.sqlite"
    await _seed_v52_database(path)

    upgraded = Database(str(path))
    await upgraded.connect()
    try:
        version = await upgraded.fetchone("SELECT MAX(version) AS v FROM schema_version")
        pages = await upgraded.fetchall("SELECT id, kind FROM visu_nodes ORDER BY id")
        policies = await upgraded.fetchall("SELECT node_id, access_mode FROM authz_visu_page_policies")
        credentials = await upgraded.fetchall("SELECT node_id FROM authz_visu_page_credentials")
        grants = await upgraded.fetchall("SELECT principal_id, node_id FROM authz_node_roles WHERE node_type = 'visu_page'")
        broken = await upgraded.fetchall("PRAGMA foreign_key_check")

        assert version["v"] >= 53
        assert [(row["id"], row["kind"]) for row in pages] == [("home", "normal"), ("keller", "normal")]
        assert [(row["node_id"], row["access_mode"]) for row in policies] == [("keller", "protected")]
        assert [row["node_id"] for row in credentials] == ["keller"]
        assert [(row["principal_id"], row["node_id"]) for row in grants] == [("bob", "keller")]
        assert list(broken) == []
    finally:
        await upgraded.disconnect()


@pytest.mark.asyncio
async def test_a_copy_rename_migration_on_visu_nodes_would_delete_policies_and_pins(tmp_path) -> None:
    """Regressionsschutz für die bewusste Abweichung vom V18/V19-Copy-Muster.

    Belegt als Assertion (nicht als Kommentar), warum v53 per ADD COLUMN geht:
    seit V42 hängt `authz_visu_page_policies` per ON DELETE CASCADE an
    `visu_nodes` und `authz_visu_page_credentials` (die PIN-Hashes) wiederum an
    der Policy. SQLite feuert Cascades auch bei DROP TABLE, ein Tabellen-Copy
    löschte also Zugriffsmodus und PIN jeder Seite. `authz_node_roles` hat
    dagegen keinen Fremdschlüssel (`node_id` ist über `node_type` polymorph) und
    überlebt das Copy als verwaiste Zeile. Wer hier später „aufräumt", reißt
    diesen Test.
    """
    path = tmp_path / "copy-probe.sqlite"
    await _seed_v52_database(path)
    conn = await aiosqlite.connect(path)
    conn.row_factory = aiosqlite.Row

    async def counts() -> tuple[int, int, int]:
        result = []
        for table in ("authz_visu_page_policies", "authz_visu_page_credentials", "authz_node_roles"):
            row = await (await conn.execute(f"SELECT COUNT(*) AS c FROM {table}")).fetchone()
            result.append(row["c"])
        return tuple(result)

    try:
        # Der Runner öffnet die Migrations-Connection genauso (database.py `_open_connection`).
        await conn.execute("PRAGMA foreign_keys=ON")
        before = await counts()

        await conn.executescript(
            """
            CREATE TABLE visu_nodes_v53 (
                id          TEXT PRIMARY KEY,
                parent_id   TEXT REFERENCES visu_nodes_v53(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                type        TEXT NOT NULL DEFAULT 'PAGE',
                kind        TEXT NOT NULL DEFAULT 'normal',
                node_order  INTEGER NOT NULL DEFAULT 0,
                icon        TEXT,
                access      TEXT,
                access_pin  TEXT,
                page_config TEXT NOT NULL DEFAULT '{}',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                created_by  TEXT
            );
            INSERT INTO visu_nodes_v53 (id, parent_id, name, type, node_order, icon, access, access_pin, page_config, created_at, updated_at, created_by)
                SELECT id, parent_id, name, type, node_order, icon, access, access_pin, page_config, created_at, updated_at, created_by FROM visu_nodes;
            """
        )
        await conn.commit()
        await conn.execute("DROP TABLE visu_nodes")
        await conn.execute("ALTER TABLE visu_nodes_v53 RENAME TO visu_nodes")
        await conn.commit()

        after = await counts()
        rows = await (await conn.execute("SELECT COUNT(*) AS c FROM visu_nodes")).fetchone()

        assert before == (1, 1, 1)
        assert rows["c"] == 2  # die Seiten selbst überleben das Copy …
        # … Policy und PIN-Hash nicht; der Rollen-Grant bleibt als verwaiste Zeile stehen.
        assert after == (0, 0, 1)
    finally:
        await conn.close()
