"""Die Layout-Eigenschaften einer Seite (M5 C2, Issue #169) als Regeltabelle.

Nachtrag zu Teil A: Layout-Modus, Rasterweite, Breakpoints und der Skin sind
**Seiten**-Eigenschaften. Sie liegen deshalb in ``PageConfig`` — additiv in der
bestehenden JSON-Spalte, genau wie ``includes``/``ignore_global_includes``
(§2.1), also ohne Migration.

Die Vorgeschichte steht in der Kritik zu Runde 1: bis dahin spiegelte der Editor
dieselben Werte in ``WidgetInstance.config.editor_page`` auf **jedes** Widget.
Das war ein Datenfork (n Kopien, kein Besitzer, stiller Erstleser-Sieg), eine
Seite ohne Widgets konnte die Werte gar nicht halten, und ausserhalb von ``gui/``
kannte das Feld niemand. Diese Datei belegt die Ablösung: die Werte überleben
den Round-Trip durch die echte Datenbank, eine leere Seite trägt sie ebenso, und
die Design-Invariante (§1.1) gilt für die GESPEICHERTE Seite.

Getestet wird — wie in ``test_visu_page_kinds.py`` — gegen eine echte
In-Memory-Datenbank, damit Spalte, Validierung und Round-Trip zusammen belegt
sind und nicht nur ein Mock. Jede neue Bedingung steht mit BEIDEN Zweigen da.
"""

from __future__ import annotations

import json
import typing
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from obs.api.v1 import visu as visu_api
from obs.db.database import Database
from obs.models.visu import LayoutMode, PageConfig, WidgetInstance

NOW = "2026-09-05T00:00:00+00:00"


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


async def _insert_node(db: Database, node_id: str, *, raw_page_config: str | None = None) -> None:
    page_config = raw_page_config if raw_page_config is not None else PageConfig().model_dump_json()
    await db.execute_and_commit(
        """INSERT INTO visu_nodes
               (id, parent_id, name, type, kind, node_order, icon, page_config, created_at, updated_at)
           VALUES (?, NULL, ?, 'PAGE', 'normal', 0, NULL, ?, ?, ?)""",
        (node_id, node_id, page_config, NOW, NOW),
    )


async def _save(db: Database, node_id: str, config: PageConfig) -> None:
    await visu_api.save_page(node_id=node_id, config=config, request=None, db=db, _user="admin")


async def _load(db: Database, node_id: str) -> PageConfig:
    return await visu_api.get_page(node_id=node_id, request=_request(), db=db, user="admin")


async def _raw(db: Database, node_id: str) -> dict[str, typing.Any]:
    row = await db.fetchone("SELECT page_config FROM visu_nodes WHERE id = ?", (node_id,))
    return json.loads(row["page_config"])


# ── Der Modus: genau zwei, je Seite ───────────────────────────────────────────


def test_layout_mode_has_exactly_the_two_paradigms() -> None:
    assert set(typing.get_args(LayoutMode)) == {"pixel", "responsive"}


def test_a_page_defaults_to_the_pixel_mode() -> None:
    """Vorgabe ist der Pixel-Modus: jede Bestandsseite ist genau das."""
    assert PageConfig().layout_mode == "pixel"


def test_the_responsive_mode_is_accepted() -> None:
    assert PageConfig(layout_mode="responsive").layout_mode == "responsive"


def test_an_unknown_layout_mode_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PageConfig(layout_mode="grid")


# ── Die Rasterweite: mindestens 1 ─────────────────────────────────────────────


def test_grid_defaults_to_eight() -> None:
    assert PageConfig().grid == 8


def test_a_grid_below_one_is_clamped_to_one() -> None:
    """„0" wäre kein Raster, sondern eine Division durch nichts."""
    assert PageConfig(grid=0).grid == 1
    assert PageConfig(grid=-5).grid == 1


def test_a_grid_of_one_or_more_is_kept_verbatim() -> None:
    assert PageConfig(grid=1).grid == 1
    assert PageConfig(grid=24).grid == 24


# ── Die Breakpoints: positiv, dublettenfrei, aufsteigend ──────────────────────


def test_breakpoints_default_to_the_three_common_widths() -> None:
    assert PageConfig().breakpoints == [480, 768, 1024]


def test_breakpoints_keep_a_clean_ascending_list_unchanged() -> None:
    assert PageConfig(breakpoints=[360, 900]).breakpoints == [360, 900]


def test_breakpoints_drop_non_positive_values() -> None:
    assert PageConfig(breakpoints=[0, -3, 480]).breakpoints == [480]


def test_breakpoints_drop_duplicates_and_sort_ascending() -> None:
    """Die Vorschau-Auswahl braucht eine Ordnung; zweimal 480 ist kein zweiter Wert."""
    assert PageConfig(breakpoints=[900, 360, 900]).breakpoints == [360, 900]


def test_an_empty_breakpoint_list_stays_empty() -> None:
    assert PageConfig(breakpoints=[]).breakpoints == []


# ── Der Skin: eine Seiteneigenschaft (E19, Teil C1) ───────────────────────────


def test_skin_defaults_to_none() -> None:
    """Ohne Wahl entscheidet der Ausliefernde — das Feld lügt nicht mit einer Vorgabe."""
    assert PageConfig().skin is None


def test_a_chosen_skin_is_kept() -> None:
    assert PageConfig(skin="ionic").skin == "ionic"


def test_a_blank_skin_becomes_none() -> None:
    """Leer ist keine Wahl; sonst stünde "" als Registry-Schlüssel im Host."""
    assert PageConfig(skin="   ").skin is None
    assert PageConfig(skin="").skin is None


# ── Die Design-Invariante §1.1: entweder Koordinaten oder Reihenfolge ─────────


def test_a_pixel_page_keeps_every_coordinate() -> None:
    config = PageConfig(layout_mode="pixel", widgets=[_widget(x=3, y=4, w=5, h=6)])
    assert (config.widgets[0].x, config.widgets[0].y) == (3, 4)
    assert (config.widgets[0].w, config.widgets[0].h) == (5, 6)


def test_a_responsive_page_carries_no_coordinates_at_all() -> None:
    """Die Kernaussage: „entweder/oder" gilt für die Seite, nicht nur für die Vorschau."""
    config = PageConfig(layout_mode="responsive", widgets=[_widget(x=3, y=4, w=5, h=6)])
    assert config.widgets[0].x is None
    assert config.widgets[0].y is None
    assert config.widgets[0].w is None
    assert config.widgets[0].h is None


def test_a_widget_without_coordinates_keeps_the_v1_defaults() -> None:
    """R17: V1 schickt Seiten ohne Layout-Modus — die bekommen ihre alten Vorgaben."""
    assert (_widget().x, _widget().y, _widget().w, _widget().h) == (0, 0, 2, 2)


# ── Round-Trip durch die echte Spalte (ohne Migration) ────────────────────────


async def test_all_four_page_properties_survive_the_round_trip(db: Database) -> None:
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(layout_mode="responsive", grid=24, breakpoints=[900, 360], skin="ionic"))

    stored = await _load(db, "seite")
    assert stored.layout_mode == "responsive"
    assert stored.grid == 24
    assert stored.breakpoints == [360, 900]
    assert stored.skin == "ionic"


async def test_a_page_without_widgets_holds_its_layout_properties(db: Database) -> None:
    """Der Grund für den Umzug: eine leere Seite hatte im Widget-Modell keinen Träger."""
    await _insert_node(db, "leer")

    await _save(db, "leer", PageConfig(widgets=[], grid=37, breakpoints=[333, 666]))

    stored = await _load(db, "leer")
    assert stored.widgets == []
    assert stored.grid == 37
    assert stored.breakpoints == [333, 666]


async def test_a_saved_responsive_page_has_null_coordinates_in_the_column(db: Database) -> None:
    """Nicht nur im Modell: in der Spalte steht `null`, und `readPosition` sieht keine Box."""
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(layout_mode="responsive", widgets=[_widget(x=9, y=9, w=9, h=9)]))

    raw = await _raw(db, "seite")
    assert raw["widgets"][0]["x"] is None
    assert raw["widgets"][0]["h"] is None
    assert (await _load(db, "seite")).widgets[0].x is None


async def test_a_saved_pixel_page_keeps_its_coordinates_in_the_column(db: Database) -> None:
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(layout_mode="pixel", widgets=[_widget(x=9, y=8, w=7, h=6)]))

    raw = await _raw(db, "seite")
    assert [raw["widgets"][0][key] for key in ("x", "y", "w", "h")] == [9, 8, 7, 6]


async def test_switching_back_to_pixel_leaves_the_coordinates_absent(db: Database) -> None:
    """Ehrlich statt heimlich: der Wechsel gibt die verworfenen Koordinaten nicht zurück."""
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(layout_mode="responsive", widgets=[_widget(x=9, y=9)]))

    zurueck = await _load(db, "seite")
    await _save(db, "seite", PageConfig(layout_mode="pixel", widgets=zurueck.widgets))

    assert (await _load(db, "seite")).widgets[0].x is None


async def test_an_older_page_without_the_fields_reads_as_the_defaults(db: Database) -> None:
    """Additiv heisst: eine Zeile aus der Zeit vor C2 bleibt lesbar (keine Migration)."""
    await _insert_node(
        db,
        "alt",
        raw_page_config=json.dumps({"grid_cols": 12, "widgets": [{"id": "w-1", "type": "light", "x": 1, "y": 2}]}),
    )

    stored = await _load(db, "alt")
    assert stored.layout_mode == "pixel"
    assert stored.grid == 8
    assert stored.breakpoints == [480, 768, 1024]
    assert stored.skin is None
    assert (stored.widgets[0].x, stored.widgets[0].y) == (1, 2)
