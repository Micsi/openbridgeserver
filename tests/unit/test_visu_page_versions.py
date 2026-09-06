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
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from obs.api.auth import Principal
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
