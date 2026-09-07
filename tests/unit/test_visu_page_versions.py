"""Seitenversionen und der Export-Import-Kreis (M5 C6, Issue #173).

Zwei Zusagen der Messlatte haengen an dieser Datei:

* **E12** - „Seitenversionen einsehbar, fruehere Version wiederherstellbar".
  Der Nachweis ist nicht „es gibt eine Liste", sondern: **Wiederherstellen
  ergibt exakt den alten `GET`**. Genau das steht unten als eigener Test, und
  zwar auf dem Weg, den auch der Editor geht.
* **E18** - „Seite/Vorlage als Datei export-/importierbar". Der Nachweis ist
  „Export gefolgt von Import ergibt **dieselbe** Seite", gemessen an dem, was
  `GET /visu/pages/{id}` fuer beide Seiten liefert.

**Wo die Version herkommt.** Additiv, wie der ganze M5-Nachtrag: eine eigene
Tabelle `visu_page_versions` (Migration 54), **kein** Anfassen von `visu_nodes`.
Das Copy-Rename-Muster der Migrationen V18/V19 ist hier verboten - es loescht
ueber `ON DELETE CASCADE` die authz-Seiten-Policies und die PIN-Hashes (belegt in
`test_visu_page_kinds.py::test_a_copy_rename_migration_on_visu_nodes_would_
delete_policies_and_pins`). Eine neue Tabelle beruehrt die bestehende Zeile
nicht, und jede Bestandsseite bleibt ohne Version, bis sie das erste Mal
geschrieben wird.

**Warum es keinen Schreib-Endpunkt fuer das Wiederherstellen gibt.** Auf
`page_config` schreiben heute schon zwei Stellen des Editors (Formular und
Canvas, Micsi/openbridgeserver#187). Ein dritter Schreibweg waere die naechste
Stelle, an der ein „letzter gewinnt" entsteht. Wiederherstellen ist deshalb
**kein eigener Schreibweg**, sondern das Lesen eines alten Standes und ein
gewoehnliches `PUT /visu/pages/{id}` damit - dieselbe Validierung, dieselbe
Zugriffspruefung, derselbe Audit-Vertrag. Was die Tests unten pruefen, ist genau
diese Zusammensetzung.

Getestet wird gegen eine echte In-Memory-Datenbank (wie in
`test_visu_page_kinds.py` und `test_visu_page_layout.py`), damit Migration,
Endpunkt und Round-Trip zusammen belegt sind. Jede Bedingung steht mit **beiden**
Zweigen da.
"""

from __future__ import annotations

import json
import typing
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from obs.api.auth import Principal
from obs.api.v1 import config as config_api
from obs.api.v1 import visu as visu_api
from obs.db.database import Database
from obs.models.visu import (
    CopyNodeRequest,
    PageConfig,
    VisuExportNode,
    VisuImportRequest,
    VisuNodeCreate,
    VisuPageVersion,
    WidgetInstance,
)

NOW = "2026-09-06T00:00:00+00:00"


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


def _widget(widget_id: str = "w-1", **kwargs: typing.Any) -> WidgetInstance:
    return WidgetInstance(id=widget_id, name="Licht", type="light", **kwargs)


async def _insert_node(
    db: Database,
    node_id: str,
    *,
    kind: str = "normal",
    node_type: str = "PAGE",
    config: PageConfig | None = None,
    access: str | None = None,
    raw_page_config: str | None = None,
) -> None:
    page_config = raw_page_config if raw_page_config is not None else (config or PageConfig()).model_dump_json()
    await db.execute_and_commit(
        """INSERT INTO visu_nodes
               (id, parent_id, name, type, kind, node_order, icon, page_config, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, 0, NULL, ?, ?, ?)""",
        (node_id, node_id, node_type, kind, page_config, NOW, NOW),
    )
    if access is not None:
        await db.execute_and_commit(
            "INSERT INTO authz_visu_page_policies (node_id, access_mode) VALUES (?, ?)",
            (node_id, access),
        )


async def _save(db: Database, node_id: str, config: PageConfig) -> None:
    await visu_api.save_page(node_id=node_id, config=config, request=None, db=db, _user="admin")


async def _load(db: Database, node_id: str) -> PageConfig:
    return await visu_api.get_page(node_id=node_id, request=_request(), db=db, user="admin")


async def _versions(db: Database, node_id: str, *, user: typing.Any = "admin") -> list[VisuPageVersion]:
    return await visu_api.get_page_versions(node_id=node_id, db=db, _user=user)


async def _version_config(db: Database, node_id: str, revision: int, *, user: typing.Any = "admin") -> PageConfig:
    return await visu_api.get_page_version(node_id=node_id, revision=revision, db=db, _user=user)


async def _restore(db: Database, node_id: str, revision: int) -> None:
    """Wiederherstellen, so wie der Editor es tut: alten Stand lesen, dann speichern.

    Bewusst KEIN eigener Endpunkt (siehe Modulkopf): der Weg auf die Spalte
    bleibt `PUT /visu/pages/{id}`.
    """
    alt = await _version_config(db, node_id, revision)
    await _save(db, node_id, alt)


def _rows(db: Database, node_id: str) -> typing.Any:
    return db.fetchall(
        "SELECT revision, page_config, created_by FROM visu_page_versions WHERE node_id = ? ORDER BY revision",
        (node_id,),
    )


# ── Die Tabelle: additiv, ohne visu_nodes anzufassen ──────────────────────────


@pytest.mark.asyncio
async def test_the_version_table_exists_after_the_migrations(db: Database) -> None:
    rows = await db.fetchall("PRAGMA table_info(visu_page_versions)")

    assert {row["name"] for row in rows} == {"node_id", "revision", "page_config", "created_at", "created_by"}


@pytest.mark.asyncio
async def test_the_version_table_does_not_change_the_node_table(db: Database) -> None:
    """R17: `visu_nodes` behaelt genau die Spalten, die Teil A hinterlassen hat."""
    rows = await db.fetchall("PRAGMA table_info(visu_nodes)")

    assert {row["name"] for row in rows} == {
        "id",
        "parent_id",
        "name",
        "type",
        "kind",
        "node_order",
        "icon",
        "access",
        "access_pin",
        "page_config",
        "created_at",
        "updated_at",
        "created_by",
    }


@pytest.mark.asyncio
async def test_a_stock_page_starts_without_any_version(db: Database) -> None:
    """Eine Bestandszeile bekommt nichts angedichtet - die Geschichte beginnt beim ersten Schreiben."""
    await _insert_node(db, "seite")

    assert await _versions(db, "seite") == []


# ── Jeder Schreibweg auf page_config haelt seinen Stand fest ──────────────────


@pytest.mark.asyncio
async def test_creating_a_page_records_its_first_version(db: Database) -> None:
    created = await visu_api.create_node(body=VisuNodeCreate(name="Wohnen"), db=db, _user="admin")

    versions = await _versions(db, created.id)
    assert [version.revision for version in versions] == [1]
    assert versions[0].created_by == "admin"


@pytest.mark.asyncio
async def test_creating_a_folder_records_no_version(db: Database) -> None:
    """Der andere Zweig: ein Ordner hat keine Seiten-Konfiguration, also auch keine Geschichte."""
    created = await visu_api.create_node(body=VisuNodeCreate(name="Etage", type="LOCATION"), db=db, _user="admin")

    rows = await _rows(db, created.id)
    assert rows == []


@pytest.mark.asyncio
async def test_saving_a_page_appends_the_new_state(db: Database) -> None:
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=2)]))

    rows = await _rows(db, "seite")
    assert [row["revision"] for row in rows] == [1, 2]
    assert json.loads(rows[0]["page_config"])["widgets"][0]["x"] == 1
    assert json.loads(rows[1]["page_config"])["widgets"][0]["x"] == 2


@pytest.mark.asyncio
async def test_saving_the_same_state_twice_appends_nothing(db: Database) -> None:
    """Der zweite Zweig derselben Bedingung: gleich bleibt gleich, und dafuer gibt es keine Zeile.

    Ohne diese Regel fuellte jeder Umsortier-Klick des Canvas den Verlauf mit
    Zwillingen, und der Autor faende den Stand nicht wieder, den er sucht.
    """
    await _insert_node(db, "seite")
    config = PageConfig(widgets=[_widget(x=1)])

    await _save(db, "seite", config)
    await _save(db, "seite", config)

    assert [version.revision for version in await _versions(db, "seite")] == [1]


@pytest.mark.asyncio
async def test_importing_a_subtree_records_a_version_for_each_page(db: Database) -> None:
    body = VisuImportRequest(
        obs_export="visu_subtree",
        version=1,
        nodes=[
            VisuExportNode(id="alt-ordner", parent_id=None, name="Ordner", type="LOCATION"),
            VisuExportNode(id="alt-seite", parent_id="alt-ordner", name="Seite", type="PAGE", page_config={"widgets": []}),
        ],
    )

    root = await visu_api.import_nodes(body=body, db=db, _user="admin")

    seite = await db.fetchone("SELECT id FROM visu_nodes WHERE parent_id = ?", (root.id,))
    assert await _rows(db, root.id) == []
    assert [row["revision"] for row in await _rows(db, seite["id"])] == [1]


@pytest.mark.asyncio
async def test_copying_a_page_records_the_first_version_of_the_copy(db: Database) -> None:
    await _insert_node(db, "seite", config=PageConfig(widgets=[_widget(x=3)]))

    copy = await visu_api.copy_node(
        node_id="seite",
        body=CopyNodeRequest(target_parent_id=None, new_name="Kopie"),
        db=db,
        _user="admin",
    )

    rows = await _rows(db, copy.id)
    assert [row["revision"] for row in rows] == [1]
    assert json.loads(rows[0]["page_config"])["widgets"][0]["x"] == 3


@pytest.mark.asyncio
async def test_copying_a_folder_records_no_version(db: Database) -> None:
    await _insert_node(db, "ordner", node_type="LOCATION")

    copy = await visu_api.copy_node(
        node_id="ordner",
        body=CopyNodeRequest(target_parent_id=None, new_name="Ordner Kopie"),
        db=db,
        _user="admin",
    )

    assert await _rows(db, copy.id) == []


@pytest.mark.asyncio
async def test_deleting_a_page_takes_its_versions_with_it(db: Database) -> None:
    """Kein verwaister Verlauf: die Fremdschluessel-Kaskade raeumt mit ab."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget()]))
    assert await _rows(db, "seite") != []

    await visu_api.delete_node(node_id="seite", db=db, _user="admin")

    assert await _rows(db, "seite") == []


# ── Die Liste: neueste zuerst, und nur fuer eine Seite ────────────────────────


@pytest.mark.asyncio
async def test_versions_are_listed_newest_first(db: Database) -> None:
    """Der Verlauf im Editor liest von oben: Position 0 ist der aktuelle Stand."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=2)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=3)]))

    assert [version.revision for version in await _versions(db, "seite")] == [3, 2, 1]


@pytest.mark.asyncio
async def test_the_version_list_of_a_folder_is_rejected(db: Database) -> None:
    await _insert_node(db, "ordner", node_type="LOCATION")

    with pytest.raises(HTTPException) as err:
        await _versions(db, "ordner")

    assert err.value.status_code == 400


@pytest.mark.asyncio
async def test_the_version_list_of_an_unknown_node_is_not_found(db: Database) -> None:
    with pytest.raises(HTTPException) as err:
        await _versions(db, "gibt-es-nicht")

    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_a_single_version_can_be_read_on_its_own(db: Database) -> None:
    """„Einsehbar" heisst: der alte Stand ist lesbar, ohne ihn vorher zu schreiben."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)], grid=16))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=9)], grid=16))

    alt = await _version_config(db, "seite", 1)

    assert alt.widgets[0].x == 1
    assert alt.grid == 16
    assert (await _load(db, "seite")).widgets[0].x == 9


@pytest.mark.asyncio
async def test_an_unknown_revision_is_not_found(db: Database) -> None:
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget()]))

    with pytest.raises(HTTPException) as err:
        await _version_config(db, "seite", 99)

    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_a_single_version_of_a_folder_is_rejected(db: Database) -> None:
    await _insert_node(db, "ordner", node_type="LOCATION")

    with pytest.raises(HTTPException) as err:
        await _version_config(db, "ordner", 1)

    assert err.value.status_code == 400


# ── Verdeckung und Berechtigung: beide Zweige ─────────────────────────────────


@pytest.mark.asyncio
async def test_a_concealed_page_hides_its_history_as_not_found(db: Database) -> None:
    """Der Verlauf verraet keine Seite, die der Baum schon nicht zeigt (§2.1, Navigationsebene)."""
    await _insert_node(db, "seite", access="user")
    await _save(db, "seite", PageConfig(widgets=[_widget()]))
    fremder = Principal(subject="mieter", type="user", is_admin=False)

    with pytest.raises(HTTPException) as err:
        await _versions(db, "seite", user=fremder)

    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_a_principal_without_generate_may_not_read_the_history(db: Database) -> None:
    """Der Verlauf ist Autoren-Material: wer die Seite nicht schreiben darf, sieht ihn nicht."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget()]))
    fremder = Principal(subject="mieter", type="user", is_admin=False)

    with pytest.raises(HTTPException) as err:
        await _versions(db, "seite", user=fremder)

    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_a_single_version_needs_the_same_right_as_the_list(db: Database) -> None:
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget()]))
    fremder = Principal(subject="mieter", type="user", is_admin=False)

    with pytest.raises(HTTPException) as err:
        await _version_config(db, "seite", 1, user=fremder)

    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_without_a_principal_there_is_no_history(db: Database) -> None:
    """Der andere Zweig der Principal-Pruefung: gar niemand ist kein Autor."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget()]))

    with pytest.raises(HTTPException) as err:
        await _versions(db, "seite", user=None)

    assert err.value.status_code == 401


@pytest.mark.asyncio
async def test_without_a_principal_a_single_version_is_refused_as_well(db: Database) -> None:
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget()]))

    with pytest.raises(HTTPException) as err:
        await _version_config(db, "seite", 1, user=None)

    assert err.value.status_code == 401


# ── Der Deckel: der Verlauf waechst nicht unbegrenzt ──────────────────────────


@pytest.mark.asyncio
async def test_the_history_keeps_at_most_the_capped_number_of_versions(db: Database) -> None:
    await _insert_node(db, "seite")
    for schritt in range(visu_api.PAGE_VERSION_CAP + 3):
        await _save(db, "seite", PageConfig(widgets=[_widget(x=schritt)]))

    versions = await _versions(db, "seite")

    assert len(versions) == visu_api.PAGE_VERSION_CAP
    assert versions[0].revision == visu_api.PAGE_VERSION_CAP + 3
    assert versions[-1].revision == 4


@pytest.mark.asyncio
async def test_below_the_cap_nothing_is_dropped(db: Database) -> None:
    """Der andere Zweig: solange Platz ist, wird nichts weggeraeumt."""
    await _insert_node(db, "seite")
    for schritt in range(3):
        await _save(db, "seite", PageConfig(widgets=[_widget(x=schritt)]))

    assert [version.revision for version in await _versions(db, "seite")] == [3, 2, 1]


# ── E12: Wiederherstellen ergibt EXAKT den alten GET ──────────────────────────


@pytest.mark.asyncio
async def test_restoring_reproduces_the_earlier_get_exactly(db: Database) -> None:
    """Die Zusage der Messlatte, woertlich gemessen.

    Verglichen wird nicht ein Feld, sondern die **ganze** Antwort von
    `GET /visu/pages/{id}` vor und nach dem Wiederherstellen.
    """
    await _insert_node(db, "seite")
    await _save(
        db,
        "seite",
        PageConfig(widgets=[_widget(x=1, y=2, w=3, h=4)], grid=16, breakpoints=[360, 900], skin="edomi"),
    )
    vorher = (await _load(db, "seite")).model_dump()

    await _save(db, "seite", PageConfig(widgets=[_widget(x=99)], grid=4, skin="terminal"))
    assert (await _load(db, "seite")).model_dump() != vorher

    await _restore(db, "seite", 1)

    assert (await _load(db, "seite")).model_dump() == vorher


@pytest.mark.asyncio
async def test_restoring_appends_a_version_instead_of_erasing_the_newer_one(db: Database) -> None:
    """Der Verlauf ist ein Stapel, kein Radiergummi: der verlassene Stand bleibt erreichbar."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=2)]))

    await _restore(db, "seite", 1)

    assert [version.revision for version in await _versions(db, "seite")] == [3, 2, 1]
    assert (await _version_config(db, "seite", 2)).widgets[0].x == 2
    assert (await _load(db, "seite")).widgets[0].x == 1


@pytest.mark.asyncio
async def test_restoring_the_current_state_adds_no_version(db: Database) -> None:
    """Der andere Zweig: wer den obersten Stand wiederherstellt, aendert nichts."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))

    await _restore(db, "seite", 1)

    assert [version.revision for version in await _versions(db, "seite")] == [1]


@pytest.mark.asyncio
async def test_restoring_still_runs_the_include_rules(db: Database) -> None:
    """Wiederherstellen ist ein gewoehnliches Speichern - die Regeln gelten weiter.

    Belegt zugleich, dass es KEINEN zweiten Schreibweg gibt, der an
    `_validate_page_kind_config` vorbeikaeme.
    """
    await _insert_node(db, "quelle")
    await _insert_node(db, "seite", config=PageConfig(includes=["quelle"]))
    await _save(db, "seite", PageConfig(includes=["quelle"]))
    await _save(db, "seite", PageConfig(includes=[]))
    await db.execute_and_commit("UPDATE visu_nodes SET kind = 'globalInclude' WHERE id = ?", ("seite",))

    with pytest.raises(HTTPException) as err:
        await _restore(db, "seite", 1)

    assert err.value.status_code == 400


@pytest.mark.asyncio
async def test_restoring_a_page_whose_include_target_still_exists_succeeds(db: Database) -> None:
    """Der andere Zweig derselben Regel: an einer normalen Seite geht genau dasselbe durch."""
    await _insert_node(db, "quelle")
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(includes=["quelle"]))
    await _save(db, "seite", PageConfig(includes=[]))

    await _restore(db, "seite", 1)

    assert (await _load(db, "seite")).includes == ["quelle"]


# ── E18: Export gefolgt von Import ergibt dieselbe Seite ──────────────────────


async def _export(db: Database, node_id: str) -> dict[str, typing.Any]:
    return json.loads((await visu_api.export_node(node_id=node_id, db=db, _user="admin")).body)


@pytest.mark.asyncio
async def test_export_then_import_yields_the_same_page(db: Database) -> None:
    """Die Zusage der Zeile E18, gemessen am `GET` beider Seiten."""
    await _insert_node(db, "seite")
    await _save(
        db,
        "seite",
        PageConfig(
            widgets=[_widget(x=5, y=6, w=7, h=8), _widget("w-2", x=1)],
            grid=16,
            breakpoints=[360, 900],
            skin="edomi",
            ignore_global_includes=True,
        ),
    )
    datei = await _export(db, "seite")

    neu = await visu_api.import_nodes(body=VisuImportRequest(**datei), db=db, _user="admin")

    original = (await _load(db, "seite")).model_dump()
    kopie = (await _load(db, neu.id)).model_dump()
    # Die Widget-IDs werden beim Import neu vergeben (sonst haetten zwei Seiten
    # dieselben) - alles andere muss Zeichen fuer Zeichen stimmen.
    for seite in (original, kopie):
        for index, widget in enumerate(seite["widgets"]):
            widget["id"] = f"widget-{index}"
    assert kopie == original


@pytest.mark.asyncio
async def test_export_import_export_is_the_same_file_apart_from_identity(db: Database) -> None:
    """Der Kreis schliesst sich auch als Datei, nicht nur als Seite."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=5)], grid=16, skin="edomi"))
    erste = await _export(db, "seite")

    neu = await visu_api.import_nodes(body=VisuImportRequest(**erste), db=db, _user="admin")
    zweite = await _export(db, neu.id)

    def _ohne_identitaet(datei: dict[str, typing.Any]) -> list[dict[str, typing.Any]]:
        knoten = [dict(node) for node in datei["nodes"]]
        for node in knoten:
            node.pop("id")
            node.pop("parent_id")
            for index, widget in enumerate((node.get("page_config") or {}).get("widgets", [])):
                widget["id"] = f"widget-{index}"
        return knoten

    assert _ohne_identitaet(zweite) == _ohne_identitaet(erste)


@pytest.mark.asyncio
async def test_the_export_still_reads_raw_and_keeps_a_stored_duplicate(db: Database) -> None:
    """Die bekannte Kante aus §2.1, hier festgehalten statt stillschweigend geheilt.

    `GET /nodes/{id}/export` liest an der Modellschicht vorbei. Diese Datei
    aendert das NICHT (die Kante ist in `CONTRIBUTING-visu-m5.md` §2.1 zugesagt
    und andere Teile bauen darauf), sie belegt sie.
    """
    await _insert_node(db, "quelle")
    await _insert_node(
        db,
        "seite",
        raw_page_config=json.dumps({"widgets": [], "includes": ["quelle", "quelle"]}),
    )

    datei = await _export(db, "seite")

    assert datei["nodes"][0]["page_config"]["includes"] == ["quelle", "quelle"]


@pytest.mark.asyncio
async def test_the_import_normalizes_what_the_export_read_raw(db: Database) -> None:
    """Und deshalb ergibt der Kreis trotzdem dieselbe Seite: der Import geht durch das Modell."""
    await _insert_node(db, "quelle")
    await _insert_node(
        db,
        "seite",
        raw_page_config=json.dumps({"widgets": [], "includes": ["quelle", "quelle"]}),
    )
    datei = await _export(db, "seite")

    neu = await visu_api.import_nodes(body=VisuImportRequest(**datei), db=db, _user="admin")

    assert (await _load(db, "seite")).includes == ["quelle"]
    assert (await _load(db, neu.id)).includes == ["quelle"]


@pytest.mark.asyncio
async def test_the_imported_page_starts_its_own_history(db: Database) -> None:
    """Die importierte Seite ist eine eigene Seite - mit eigener, leerer Vorgeschichte."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=2)]))
    datei = await _export(db, "seite")

    neu = await visu_api.import_nodes(body=VisuImportRequest(**datei), db=db, _user="admin")

    assert [version.revision for version in await _versions(db, neu.id)] == [1]
    assert [version.revision for version in await _versions(db, "seite")] == [2, 1]


# ── Der fuenfte Schreibweg: das Aufraeumen beim Loeschen ──────────────────────
#
# `_drop_include_references` schreibt beim Loeschen einer Seite die
# `page_config` JEDER Seite um, die sie inkludiert hatte - auf fremden Zeilen,
# ohne dass deren Autor etwas getan haette. Ohne Version daran waere der oberste
# Verlaufseintrag dieser Seiten weder der ausgelieferte Stand noch ueberhaupt
# wiederherstellbar: der gestrichene Include-Eintrag gilt beim `PUT` als NEU
# hinzugefuegt und faellt in die strenge Zielpruefung (§2.1) - 400 „Include-Ziel
# existiert nicht". Genau das steht unten als eigener Test.


async def _delete(db: Database, node_id: str, *, user: typing.Any = "admin") -> None:
    await visu_api.delete_node(node_id=node_id, db=db, _user=user)


@pytest.mark.asyncio
async def test_deleting_an_include_source_records_a_version_on_every_page_that_referenced_it(db: Database) -> None:
    await _insert_node(db, "quelle")
    await _insert_node(db, "wirt")
    await _save(db, "wirt", PageConfig(includes=["quelle"]))

    await _delete(db, "quelle")

    versions = await _versions(db, "wirt")
    assert [version.revision for version in versions] == [2, 1]
    assert (await _version_config(db, "wirt", 2)).includes == []
    assert (await _version_config(db, "wirt", 1)).includes == ["quelle"]


@pytest.mark.asyncio
async def test_after_that_cleanup_the_top_version_is_the_delivered_state(db: Database) -> None:
    """Die Ordnungszusage von `get_page_versions`: Position 0 IST der ausgelieferte Stand."""
    await _insert_node(db, "quelle")
    await _insert_node(db, "wirt")
    await _save(db, "wirt", PageConfig(widgets=[_widget(x=3)], includes=["quelle"]))

    await _delete(db, "quelle")

    oberste = (await _versions(db, "wirt"))[0].revision
    assert (await _version_config(db, "wirt", oberste)).model_dump() == (await _load(db, "wirt")).model_dump()


@pytest.mark.asyncio
async def test_the_top_version_after_that_cleanup_can_be_restored(db: Database) -> None:
    """Der Bruch, der Runde 1 aufgehalten hat: hier faellt kein 400 mehr."""
    await _insert_node(db, "quelle")
    await _insert_node(db, "wirt")
    await _save(db, "wirt", PageConfig(includes=["quelle"]))
    await _delete(db, "quelle")

    await _restore(db, "wirt", (await _versions(db, "wirt"))[0].revision)

    assert (await _load(db, "wirt")).includes == []


@pytest.mark.asyncio
async def test_the_cleanup_version_carries_the_principal_that_deleted(db: Database) -> None:
    await _insert_node(db, "quelle")
    await _insert_node(db, "wirt")
    await _save(db, "wirt", PageConfig(includes=["quelle"]))

    await _delete(db, "quelle")

    oberste = (await _versions(db, "wirt"))[0]
    assert oberste.revision == 2
    assert oberste.created_by == "admin"


@pytest.mark.asyncio
async def test_the_cleanup_version_is_exactly_what_the_column_now_holds(db: Database) -> None:
    """Stand und Version entstehen in derselben Transaktion, also aus derselben Zeichenkette."""
    await _insert_node(db, "quelle")
    await _insert_node(db, "wirt")
    await _save(db, "wirt", PageConfig(includes=["quelle"]))

    await _delete(db, "quelle")

    spalte = await db.fetchone("SELECT page_config FROM visu_nodes WHERE id = ?", ("wirt",))
    zeilen = await _rows(db, "wirt")
    assert zeilen[-1]["page_config"] == spalte["page_config"]


@pytest.mark.asyncio
async def test_a_page_the_cleanup_does_not_touch_gets_no_version(db: Database) -> None:
    """Der andere Zweig: wer den Geloeschten nie inkludiert hat, bekommt keine Zeile."""
    await _insert_node(db, "quelle")
    await _insert_node(db, "unbeteiligt")
    await _save(db, "unbeteiligt", PageConfig(widgets=[_widget(x=1)]))

    await _delete(db, "quelle")

    assert [version.revision for version in await _versions(db, "unbeteiligt")] == [1]


@pytest.mark.asyncio
async def test_the_cleanup_keeps_unknown_fields_of_a_foreign_configuration(db: Database) -> None:
    """R17 bleibt: das Aufraeumen fasst die rohe Struktur an, nicht das Modell."""
    await _insert_node(db, "quelle")
    await _insert_node(
        db,
        "wirt",
        raw_page_config=json.dumps({"widgets": [], "includes": ["quelle"], "v1_feld": {"a": 1}}),
    )

    await _delete(db, "quelle")

    spalte = await db.fetchone("SELECT page_config FROM visu_nodes WHERE id = ?", ("wirt",))
    gespeichert = json.loads(spalte["page_config"])
    assert gespeichert["v1_feld"] == {"a": 1}
    assert json.loads((await _rows(db, "wirt"))[-1]["page_config"])["v1_feld"] == {"a": 1}


@pytest.mark.asyncio
async def test_deleting_a_page_nobody_included_writes_no_version_anywhere(db: Database) -> None:
    """Der leere Zweig des Aufraeumens: keine betroffene Zeile, keine Version."""
    await _insert_node(db, "quelle")
    await _insert_node(db, "wirt")
    await _save(db, "wirt", PageConfig(widgets=[_widget(x=1)]))

    await _delete(db, "quelle")

    assert len(await _rows(db, "wirt")) == 1


# ── E18, Gegenfall 1: ein Emoji im Seitennamen bricht den Export nicht ────────


@pytest.mark.asyncio
async def test_exporting_a_page_with_a_non_latin1_name_succeeds(db: Database) -> None:
    """Vor der Behebung: HTTP 500, `UnicodeEncodeError: 'latin-1' codec can't encode`."""
    await db.execute_and_commit(
        """INSERT INTO visu_nodes (id, parent_id, name, type, kind, node_order, icon, page_config, created_at, updated_at)
           VALUES (?, NULL, ?, 'PAGE', 'normal', 0, NULL, ?, ?, ?)""",
        ("emoji", "Krit 😀 Emoji", PageConfig().model_dump_json(), NOW, NOW),
    )

    antwort = await visu_api.export_node(node_id="emoji", db=db, _user="admin")

    disposition = antwort.headers["content-disposition"]
    disposition.encode("latin-1")  # genau das ist vorher geplatzt
    assert "filename*=UTF-8''" in disposition
    assert "%F0%9F%98%80" in disposition  # das Emoji, prozentkodiert (RFC 5987)


@pytest.mark.asyncio
async def test_the_ascii_fallback_of_that_header_stays_usable(db: Database) -> None:
    await db.execute_and_commit(
        """INSERT INTO visu_nodes (id, parent_id, name, type, kind, node_order, icon, page_config, created_at, updated_at)
           VALUES (?, NULL, ?, 'PAGE', 'normal', 0, NULL, ?, ?, ?)""",
        ("emoji", "Krit 😀 Emoji", PageConfig().model_dump_json(), NOW, NOW),
    )

    antwort = await visu_api.export_node(node_id="emoji", db=db, _user="admin")

    assert 'filename="Krit_Emoji_visu.json"' in antwort.headers["content-disposition"]


@pytest.mark.asyncio
async def test_a_name_made_only_of_emoji_still_yields_a_filename(db: Database) -> None:
    """Der Randfall der Rueckfall-Regel: nichts Druckbares bleibt uebrig."""
    await db.execute_and_commit(
        """INSERT INTO visu_nodes (id, parent_id, name, type, kind, node_order, icon, page_config, created_at, updated_at)
           VALUES (?, NULL, ?, 'PAGE', 'normal', 0, NULL, ?, ?, ?)""",
        ("emoji", "😀", PageConfig().model_dump_json(), NOW, NOW),
    )

    antwort = await visu_api.export_node(node_id="emoji", db=db, _user="admin")

    assert 'filename="visu_export.json"' in antwort.headers["content-disposition"]


@pytest.mark.asyncio
async def test_a_plain_name_keeps_the_plain_filename(db: Database) -> None:
    """Der andere Zweig: an einem gewoehnlichen Namen aendert sich nichts."""
    await _insert_node(db, "Wohnzimmer")

    antwort = await visu_api.export_node(node_id="Wohnzimmer", db=db, _user="admin")

    assert 'filename="Wohnzimmer_visu.json"' in antwort.headers["content-disposition"]


# ── E18, Gegenfaelle 2 und 3: was der Import NICHT mitbringt, sagt er ─────────


class _Antwort:
    """Ein Platzhalter fuer die `Response`, die FastAPI dem Endpunkt sonst stellt."""

    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


async def _import(db: Database, datei: dict[str, typing.Any]) -> tuple[typing.Any, dict[str, str]]:
    antwort = _Antwort()
    knoten = await visu_api.import_nodes(
        body=VisuImportRequest(**datei),
        response=typing.cast(typing.Any, antwort),
        db=db,
        _user="admin",
    )
    return knoten, antwort.headers


@pytest.mark.asyncio
async def test_the_import_names_the_fields_it_could_not_keep(db: Database) -> None:
    """Ein stiller Verlust ist keine Option: der Autor erfaehrt, was liegen blieb."""
    await _insert_node(
        db,
        "seite",
        raw_page_config=json.dumps(
            {
                "widgets": [{"id": "w-1", "name": "Licht", "type": "light", "neu_im_widget": 7}],
                "includes": [],
                "zukunftsfeld": {"a": 1},
            },
        ),
    )
    datei = await _export(db, "seite")

    _neu, headers = await _import(db, datei)

    assert headers["X-Visu-Import-Dropped-Fields"] == "widgets[].neu_im_widget,zukunftsfeld"


@pytest.mark.asyncio
async def test_an_import_without_unknown_fields_reports_none(db: Database) -> None:
    """Der andere Zweig: eine Datei dieser Version meldet nichts."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    datei = await _export(db, "seite")

    _neu, headers = await _import(db, datei)

    assert "X-Visu-Import-Dropped-Fields" not in headers


@pytest.mark.asyncio
async def test_the_import_reports_a_protected_page_that_arrives_without_its_pin(db: Database) -> None:
    """Der Export laesst den PIN bewusst weg - dann muss der Import es sagen."""
    datei = {
        "obs_export": "visu_subtree",
        "version": 1,
        "nodes": [
            {"id": "a", "parent_id": None, "name": "Geschuetzt", "type": "PAGE", "access": "protected", "page_config": {}},
        ],
    }

    neu, headers = await _import(db, datei)

    assert headers["X-Visu-Import-Protected-Without-Pin"] == "1"
    policy = await db.fetchone("SELECT access_mode FROM authz_visu_page_policies WHERE node_id = ?", (neu.id,))
    credential = await db.fetchone("SELECT pin_hash FROM authz_visu_page_credentials WHERE node_id = ?", (neu.id,))
    assert policy["access_mode"] == "protected"
    assert credential is None


# ── Der BLEIBENDE Fundort: eine geschuetzte Seite ohne PIN ───────────────────
#
# Die Meldung beim Import ist fluechtig - sie verschwindet beim ersten Klick auf
# die neue Seite. Der Zustand ist es nicht: die Seite bleibt zu, bis jemand eine
# PIN setzt. Ohne einen zweiten Fundort waere sie im Eigenschaftsformular von
# einer gewoehnlichen geschuetzten Seite nicht zu unterscheiden - das PIN-Feld
# steht dort immer leer, denn der Hash geht nie an den Browser.
#
# ``has_pin`` sagt genau das eine: gibt es zu dieser Seite ueberhaupt eine
# Credential-Zeile? Es sagt es NUR einem Admin. Fuer alle anderen bleibt das
# Feld ``None`` - „diese Antwort weist es nicht aus". Der Baum geht auch an
# Besucher hinaus, und die Ausstattung einer geschuetzten Seite ist keine
# Navigationsangabe.


async def _tree(db: Database, *, user: typing.Any = "admin") -> list[typing.Any]:
    return await visu_api.get_tree(db=db, user=user)


async def _set_pin(db: Database, node_id: str) -> None:
    await db.execute_and_commit(
        "INSERT INTO authz_visu_page_credentials (node_id, pin_hash) VALUES (?, ?)",
        (node_id, "$2b$12$nichtgeprueft"),
    )


@pytest.mark.asyncio
async def test_the_tree_tells_an_admin_that_a_protected_page_has_no_pin(db: Database) -> None:
    """Der bleibende Fundort fuer genau den Zustand, den der Import meldet."""
    await _insert_node(db, "seite", access="protected")

    eintrag = next(node for node in await _tree(db) if node.id == "seite")

    assert eintrag.access == "protected"
    assert eintrag.has_pin is False


@pytest.mark.asyncio
async def test_the_tree_tells_an_admin_that_a_protected_page_has_a_pin(db: Database) -> None:
    """Der andere Zweig - sonst stuende der Hinweis an jeder geschuetzten Seite."""
    await _insert_node(db, "seite", access="protected")
    await _set_pin(db, "seite")

    eintrag = next(node for node in await _tree(db) if node.id == "seite")

    assert eintrag.has_pin is True


@pytest.mark.asyncio
async def test_the_tree_does_not_disclose_the_pin_state_to_a_visitor(db: Database) -> None:
    """Ein Besucher erfaehrt es nicht: `None` heisst „nicht ausgewiesen"."""
    await _insert_node(db, "seite", access="protected")

    eintrag = next(node for node in await _tree(db, user=None) if node.id == "seite")

    assert eintrag.access == "protected"
    assert eintrag.has_pin is None


@pytest.mark.asyncio
async def test_a_page_imported_without_its_pin_is_recognisable_afterwards(db: Database) -> None:
    """Die Naht zum Import-Header: derselbe Befund, nur dauerhaft."""
    datei = {
        "obs_export": "visu_subtree",
        "version": 1,
        "nodes": [
            {"id": "a", "parent_id": None, "name": "Geschuetzt", "type": "PAGE", "access": "protected", "page_config": {}},
        ],
    }
    neu, headers = await _import(db, datei)

    eintrag = next(node for node in await _tree(db) if node.id == neu.id)

    assert headers["X-Visu-Import-Protected-Without-Pin"] == "1"
    assert eintrag.has_pin is False


@pytest.mark.asyncio
async def test_a_single_node_reports_the_pin_state_the_same_way(db: Database) -> None:
    """Derselbe Befund am Einzelknoten - und ebenso nur fuer einen Admin."""
    await _insert_node(db, "seite", access="protected")

    als_admin = await visu_api.get_node(node_id="seite", db=db, user="admin")
    als_besucher = await visu_api.get_node(node_id="seite", db=db, user=None)

    assert als_admin.has_pin is False
    assert als_besucher.has_pin is None


@pytest.mark.asyncio
async def test_the_dropped_fields_header_says_how_many_names_it_left_out(db: Database) -> None:
    """Der Deckel von 20 Namen darf nicht schweigend abschneiden.

    Ein Header, der 20 von 42 Namen nennt und so aussieht, als waeren es alle,
    ist schlimmer als ein langer: der Autor haelt die Liste fuer vollstaendig
    und sucht die restlichen 22 Felder nie.
    """
    fremd = {"widgets": [], "includes": []}
    for nummer in range(42):
        fremd[f"zukunftsfeld_{nummer:02d}"] = nummer
    await _insert_node(db, "seite", raw_page_config=json.dumps(fremd))
    datei = await _export(db, "seite")

    _neu, headers = await _import(db, datei)

    assert len(headers["X-Visu-Import-Dropped-Fields"].split(",")) == visu_api._DROPPED_FIELDS_CAP
    assert headers["X-Visu-Import-Dropped-Fields-Omitted"] == str(42 - visu_api._DROPPED_FIELDS_CAP)


@pytest.mark.asyncio
async def test_a_field_list_that_fits_reports_no_omission(db: Database) -> None:
    """Der andere Zweig: was ganz hineinpasst, meldet keine Kuerzung."""
    await _insert_node(
        db,
        "seite",
        raw_page_config=json.dumps({"widgets": [], "includes": [], "zukunftsfeld": 1}),
    )
    datei = await _export(db, "seite")

    _neu, headers = await _import(db, datei)

    assert headers["X-Visu-Import-Dropped-Fields"] == "zukunftsfeld"
    assert "X-Visu-Import-Dropped-Fields-Omitted" not in headers


@pytest.mark.asyncio
async def test_exactly_the_capped_number_of_fields_reports_no_omission(db: Database) -> None:
    """Die Kante selbst: genau 20 Namen sind vollstaendig, nicht gekuerzt."""
    fremd: dict[str, typing.Any] = {"widgets": [], "includes": []}
    for nummer in range(visu_api._DROPPED_FIELDS_CAP):
        fremd[f"zukunftsfeld_{nummer:02d}"] = nummer
    await _insert_node(db, "seite", raw_page_config=json.dumps(fremd))
    datei = await _export(db, "seite")

    _neu, headers = await _import(db, datei)

    assert "X-Visu-Import-Dropped-Fields-Omitted" not in headers


@pytest.mark.asyncio
async def test_a_page_without_pin_protection_reports_nothing(db: Database) -> None:
    """Der andere Zweig: eine oeffentliche Seite loest keine Meldung aus."""
    await _insert_node(db, "seite", access="public")
    datei = await _export(db, "seite")

    _neu, headers = await _import(db, datei)

    assert "X-Visu-Import-Protected-Without-Pin" not in headers


# ── Was der Import als verloren meldet: die Regel selbst, beide Zweige ────────


def test_unknown_fields_are_found_on_all_three_levels() -> None:
    """Seite, Widget und Popup - tiefer traegt ein Export keine benannten Felder."""
    gefunden = visu_api._unknown_config_fields(
        {
            "widgets": [{"id": "w-1", "name": "Licht", "type": "light", "neu_im_widget": 7}],
            "popup": {"x": 1, "neu_im_popup": True},
            "zukunftsfeld": {"a": 1},
        },
    )

    assert gefunden == ["popup.neu_im_popup", "widgets[].neu_im_widget", "zukunftsfeld"]


def test_a_configuration_of_this_version_reports_nothing() -> None:
    """Der andere Zweig auf allen drei Ebenen zugleich."""
    voll = PageConfig(widgets=[_widget(x=1)], popup=None).model_dump(mode="json")

    assert visu_api._unknown_config_fields(voll) == []


def test_a_known_popup_descriptor_reports_nothing() -> None:
    """Der Popup-Zweig, wenn dort nichts Fremdes steht."""
    mit_popup = {"widgets": [], "popup": {"x": 10, "y": 20, "modal": True}}

    assert visu_api._unknown_config_fields(mit_popup) == []


def test_entries_that_are_not_objects_are_skipped_instead_of_crashing() -> None:
    """Die Datei kommt von aussen: ein `widgets: [null]` darf kein 500 werden."""
    assert visu_api._unknown_config_fields({"widgets": [None, 7], "popup": "keine Struktur"}) == []


def test_a_page_config_that_is_not_an_object_reports_nothing() -> None:
    """Und der aeusserste Zweig: gar keine Konfiguration (ein Ordner im Export)."""
    assert visu_api._unknown_config_fields(None) == []


# ── Der SECHSTE Schreibweg: das Einspielen einer ganzen Konfiguration ─────────
#
# `POST /config/import` (`obs/api/v1/config.py`) schreibt `page_config`
# ebenfalls, und zwar als UPSERT: eine bestehende Seite behaelt ihre `id` und
# bekommt einen neuen Stand. Eine Version schreibt dieser Weg bewusst NICHT
# (Begruendung dort) - aber damit ist erst die halbe Frage beantwortet. Die
# andere: **was wird aus den Zeilen, die schon da sind?**
#
# Bleiben sie stehen, dann ist die oberste von ihnen nach dem Einspielen NICHT
# mehr der ausgelieferte Stand - entgegen der unbedingten Zusage von
# `get_page_versions` und entgegen dem Etikett „Zuletzt gespeichert", das der
# Editor genau dieser Zeile gibt. Ihr Wiederherstellen ist dann ein
# gewoehnliches, gelingendes `PUT`: es macht die eingespielte Konfiguration
# still rueckgaengig und quittiert das als Erfolg. Ein Datenverlust mit gruener
# Quittung, erreichbar ueber `POST /config/autobackup/restore/{name}` (das ohne
# vorheriges Reset arbeitet) und ueber die Einstellungen der Admin-GUI.
#
# Der Verlauf gehoerte zu einem Stand, den es nicht mehr gibt. Genau das sagt
# der Einspielweg jetzt: er RAEUMT ihn ab, wo er den Stand einer Seite
# tatsaechlich veraendert - und laesst ihn stehen, wo er ihn nicht anfasst.


def _exported_node(
    node_id: str,
    config: PageConfig | None = None,
    *,
    node_type: str = "PAGE",
    access: str | None = None,
) -> config_api.ExportedVisuNode:
    return config_api.ExportedVisuNode(
        id=node_id,
        parent_id=None,
        name=node_id,
        type=node_type,
        node_order=0,
        icon=None,
        access=access,
        page_config=config.model_dump_json() if config is not None else None,
        users=[],
    )


async def _config_import(db: Database, *nodes: config_api.ExportedVisuNode) -> typing.Any:
    body = config_api.ConfigExport(
        obs_version="5",
        exported_at=NOW,
        datapoints=[],
        bindings=[],
        visu_nodes=list(nodes),
    )
    registry = MagicMock()
    registry.all.return_value = []
    with (
        patch.object(config_api, "get_registry", return_value=registry),
        patch("obs.adapters.registry.stop_all", new_callable=AsyncMock),
        patch("obs.adapters.registry.start_all", new_callable=AsyncMock),
        patch("obs.adapters.registry.get_all_instances", return_value={}),
        patch("obs.core.event_bus.get_event_bus", return_value=MagicMock()),
    ):
        return await config_api.import_config(body=body, _user="admin", db=db)


@pytest.mark.asyncio
async def test_a_configuration_import_drops_the_history_of_a_page_it_overwrites(db: Database) -> None:
    """Der Verlauf gehoerte zu einem Stand, den das Einspielen ersetzt hat."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=7)]))
    assert [version.revision for version in await _versions(db, "seite")] == [2, 1]

    ergebnis = await _config_import(db, _exported_node("seite", PageConfig(widgets=[_widget(x=99)])))

    assert ergebnis.errors == []
    assert ergebnis.visu_nodes_upserted == 1
    assert await _versions(db, "seite") == []


@pytest.mark.asyncio
async def test_after_a_configuration_import_the_history_never_contradicts_the_delivered_state(db: Database) -> None:
    """Die Ordnungszusage von `get_page_versions`, gemessen nach dem Einspielen.

    Entweder es gibt keine Zeile - oder Position 0 ist byteweise der Stand, den
    `GET /visu/pages/{id}` ausliefert. Ein Dazwischen gibt es nicht.
    """
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=7)]))

    await _config_import(db, _exported_node("seite", PageConfig(widgets=[_widget(x=99)])))

    versions = await _versions(db, "seite")
    assert (await _load(db, "seite")).widgets[0].x == 99
    if versions:
        oberste = await _version_config(db, "seite", versions[0].revision)
        assert oberste.model_dump() == (await _load(db, "seite")).model_dump()


@pytest.mark.asyncio
async def test_no_restore_after_a_configuration_import_can_silently_undo_it(db: Database) -> None:
    """Der Bruch selbst: kein angebotener Eintrag darf den Einspielstand zuruecknehmen."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=7)]))

    await _config_import(db, _exported_node("seite", PageConfig(widgets=[_widget(x=99)])))

    for version in await _versions(db, "seite"):
        await _restore(db, "seite", version.revision)
        assert (await _load(db, "seite")).widgets[0].x == 99


@pytest.mark.asyncio
async def test_a_configuration_import_that_leaves_a_page_untouched_keeps_its_history(db: Database) -> None:
    """Der andere Zweig: gleicher Stand, gleicher Verlauf.

    Das Einspielen der Sicherung von heute darf den Verlauf nicht abraeumen - es
    hat an dieser Seite nichts veraendert, ihre Vorgeschichte beschreibt den
    ausgelieferten Stand also weiterhin richtig.
    """
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=7)]))
    unveraendert = await db.fetchone("SELECT page_config FROM visu_nodes WHERE id = 'seite'")

    await _config_import(db, _exported_node("seite", PageConfig.model_validate_json(unveraendert["page_config"])))

    assert [version.revision for version in await _versions(db, "seite")] == [2, 1]
    oberste = await _version_config(db, "seite", 2)
    assert oberste.model_dump() == (await _load(db, "seite")).model_dump()


@pytest.mark.asyncio
async def test_a_configuration_import_does_not_touch_the_history_of_a_page_it_never_mentions(db: Database) -> None:
    """Eine Seite, die in der Datei gar nicht vorkommt, behaelt ihre Vorgeschichte."""
    await _insert_node(db, "seite")
    await _insert_node(db, "unbeteiligt")
    await _save(db, "seite", PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "unbeteiligt", PageConfig(widgets=[_widget(x=5)]))
    await _save(db, "unbeteiligt", PageConfig(widgets=[_widget(x=6)]))

    await _config_import(db, _exported_node("seite", PageConfig(widgets=[_widget(x=99)])))

    assert [version.revision for version in await _versions(db, "unbeteiligt")] == [2, 1]


@pytest.mark.asyncio
async def test_a_configuration_import_still_writes_no_version_of_its_own(db: Database) -> None:
    """Die Begruendung dieses Weges bleibt gueltig: er ist kein Autorenschritt."""
    await _insert_node(db, "seite")

    await _config_import(db, _exported_node("seite", PageConfig(widgets=[_widget(x=99)])))

    assert await _versions(db, "seite") == []


@pytest.mark.asyncio
async def test_a_page_the_import_brings_in_new_starts_without_a_history(db: Database) -> None:
    """Der Einfuege-Zweig des Upserts: eine neue Seite, kein Verlauf, kein Fehler."""
    ergebnis = await _config_import(db, _exported_node("frisch", PageConfig(widgets=[_widget(x=2)])))

    assert ergebnis.errors == []
    assert await _versions(db, "frisch") == []
    assert (await _load(db, "frisch")).widgets[0].x == 2


@pytest.mark.asyncio
async def test_a_folder_in_the_imported_configuration_is_no_special_case(db: Database) -> None:
    """Ein Ordner traegt keinen Autorenstand - und der Einspielweg stolpert nicht ueber ihn."""
    await _insert_node(db, "ordner", node_type="LOCATION")

    ergebnis = await _config_import(db, _exported_node("ordner", PageConfig(), node_type="LOCATION"))

    assert ergebnis.errors == []
    assert await db.fetchall("SELECT revision FROM visu_page_versions WHERE node_id = 'ordner'") == []


# ---------------------------------------------------------------------------
# Folge-Welle F2 (Issue #187/#188): zwei kleine Punkte am Konfigurations-Import
# ---------------------------------------------------------------------------
#
# Beide Proben haengen an genau der Stelle oben, die entscheidet, ob der
# Verlauf einer Seite abzuraeumen ist (`page_config_before != node.page_config`
# in `obs/api/v1/config.py`, `import_config`).


@pytest.mark.asyncio
async def test_the_history_decision_reads_its_comparison_value_inside_the_same_lock_as_the_write(
    db: Database,
) -> None:
    """Der Wettlauf aus #188: der Vergleichswert wird VORWEG gelesen, das Schreiben
    kommt erst danach - dazwischen kann ein Autorenklick dieselbe Seite speichern.

    Nachgestellt wird genau dieses Fenster: sobald der Einspielweg seinen
    (heute rein topologischen) Bestand vorab liest, speichert - simuliert
    genau in dieser Luecke - ein Autor `PUT /visu/pages/seite` mit einem neuen
    Stand C. Das eingespielte Dokument selbst lautet ebenfalls C (Zufall des
    Tests, kein Widerspruch: es geht um den VERGLEICHSWERT, nicht darum, was
    importiert wird).

    Vor der Behebung verglich der Import den frisch eingespielten Stand C
    gegen den VOR der Luecke gelesenen Stand B - die beiden sind
    verschieden, der Import raeumte den Verlauf faelschlich ab und loeschte
    damit auch die Version, die der Autorenklick gerade erst angelegt hatte.
    Nach der Behebung liest der Import seinen Vergleichswert ERST INNERHALB
    derselben Sperre wie den Schreibvorgang - also NACH dem Autorenklick -
    und sieht: die Seite traegt bereits C, es hat sich nichts geaendert, der
    Verlauf bleibt stehen.
    """
    await _insert_node(db, "seite", config=PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=2)]))  # B, Version 1

    concurrent_c = PageConfig(widgets=[_widget(x=3)])
    original_fetchall = db.fetchall

    async def racy_fetchall(query: str, params: typing.Any = ()) -> typing.Any:
        rows = await original_fetchall(query, params)
        if "SELECT id FROM visu_nodes" in query:
            # Der Autorenklick, der GENAU in die Luecke zwischen dem
            # vorweggelesenen Bestand und dem eigentlichen Schreibvorgang
            # dieser Seite faellt.
            await _save(db, "seite", concurrent_c)  # C, Version 2
        return rows

    db.fetchall = racy_fetchall
    try:
        ergebnis = await _config_import(db, _exported_node("seite", concurrent_c))
    finally:
        db.fetchall = original_fetchall

    assert ergebnis.errors == []
    assert (await _load(db, "seite")).widgets[0].x == 3
    # DER BELEG: die Version des Autorenklicks (C, Revision 2) ist noch da -
    # der Vergleich hat den FRISCHEN Stand gesehen, nicht den veralteten (B).
    assert [version.revision for version in await _versions(db, "seite")] == [2, 1]


@pytest.mark.asyncio
async def test_a_failed_upsert_leaves_the_history_standing_the_order_is_pinned(db: Database) -> None:
    """Reihenfolge ungepinnt hiesse: das Abraeumen zuerst, dann der Upsert - beide
    gruen bei Erfolg, aber falsch bei einem gescheiterten Upsert.

    Das heutige Verhalten ist richtig: ERST schreiben, DANN abraeumen, damit ein
    gescheiterter Import den gueltigen Verlauf behaelt. Der Upsert wird hier
    ECHT zum Scheitern gebracht (kein Mock): `type='BOGUS'` verletzt die
    `CHECK`-Bedingung der Spalte (`obs/db/database.py`, `visu_nodes.type`), das
    `INSERT ... ON CONFLICT` wirft, und die (heute atomare) Transaktion aus
    Lesen/Schreiben/Abraeumen wird ohne jede Wirkung zurueckgerollt.
    """
    await _insert_node(db, "seite", config=PageConfig(widgets=[_widget(x=1)]))
    await _save(db, "seite", PageConfig(widgets=[_widget(x=2)]))
    vor_dem_import = await _versions(db, "seite")
    assert vor_dem_import  # Vorbedingung: es gibt ueberhaupt etwas zu verlieren.

    ergebnis = await _config_import(
        db,
        _exported_node("seite", PageConfig(widgets=[_widget(x=99)]), node_type="BOGUS"),
    )

    assert any("seite" in fehler for fehler in ergebnis.errors)
    assert ergebnis.visu_nodes_upserted == 0
    # Der Stand von VOR dem gescheiterten Import steht unveraendert da ...
    assert (await _load(db, "seite")).widgets[0].x == 2
    # ... und genau deshalb ist sein Verlauf weiterhin die richtige Antwort.
    assert await _versions(db, "seite") == vor_dem_import
