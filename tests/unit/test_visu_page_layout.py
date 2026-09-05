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
den Round-Trip durch die echte Datenbank, und eine leere Seite trägt sie ebenso.

DIE DESIGN-INVARIANTE §1.1 UND R17 — die Korrektur aus Runde 3. Runde 2 setzte
„eine responsive Seite trägt keine Koordinaten" durch, indem sie beim Speichern
alle vier Zahlen auf ``None`` setzte. Das erfüllte die Invariante und brach R17
im selben Zug: V1 liest **dieselbe Zeile**, deklariert ``x: number``
(``frontend/src/types/index.ts:45-48``) und rechnet ``w.x * CELL_W``
(``frontend/src/views/VisuEditor.vue:400``). Aus ``null`` wird dort ``0``, die
Seite kollabiert auf ``left:0px; width:0px``, und ``w.x + (i % w.w)``
(``:615``) läuft in ein ``NaN``.

Deshalb entscheidet jetzt der **Modus**, nicht das Fehlen der Werte: die
Koordinaten bleiben in der Spalte stehen, und ob sie WIRKEN, liest der Host aus
``layout_mode`` (``mapTree``/``itemsOf`` in ``apps/visu/src/core/obs/``). Beides
gilt damit zugleich — im responsiven Modus wirkt keine Koordinate, und V1 sieht
weiterhin vier ganze Zahlen. Der Nachweis dafür steht unten in eigener Sektion
und rechnet mit V1s eigener Formel, aus V1s eigener Datei gelesen.

Getestet wird — wie in ``test_visu_page_kinds.py`` — gegen eine echte
In-Memory-Datenbank, damit Spalte, Validierung und Round-Trip zusammen belegt
sind und nicht nur ein Mock. Jede neue Bedingung steht mit BEIDEN Zweigen da.
"""

from __future__ import annotations

import json
import pathlib
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


# ── Die Design-Invariante §1.1: der MODUS entscheidet, nicht das Fehlen ───────


def test_a_pixel_page_keeps_every_coordinate() -> None:
    config = PageConfig(layout_mode="pixel", widgets=[_widget(x=3, y=4, w=5, h=6)])
    assert (config.widgets[0].x, config.widgets[0].y) == (3, 4)
    assert (config.widgets[0].w, config.widgets[0].h) == (5, 6)


def test_a_responsive_page_keeps_its_coordinates_as_well() -> None:
    """Die Korrektur aus Runde 3, und die Kernaussage dieser Datei.

    „Entweder/oder" heisst: im responsiven Modus WIRKT keine Koordinate. Es
    heisst nicht, dass die Zahlen weg sein müssen — der Modus steht als
    ``layout_mode`` auf derselben Seite, der Host liest ihn und emittiert dann
    gar kein ``position``. Die Zahlen zu löschen wäre die teurere Variante
    derselben Aussage, und sie zerstört R17 (siehe Sektion unten).
    """
    config = PageConfig(layout_mode="responsive", widgets=[_widget(x=3, y=4, w=5, h=6)])
    assert (config.widgets[0].x, config.widgets[0].y) == (3, 4)
    assert (config.widgets[0].w, config.widgets[0].h) == (5, 6)


def test_a_widget_without_coordinates_keeps_the_v1_defaults() -> None:
    """R17: V1 schickt Seiten ohne Layout-Modus — die bekommen ihre alten Vorgaben."""
    assert (_widget().x, _widget().y, _widget().w, _widget().h) == (0, 0, 2, 2)


def test_the_coordinate_fields_carry_the_type_v1_declares() -> None:
    """``x: number`` in ``frontend/src/types/index.ts:45-48`` heisst hier ``int``.

    Ein ``int | None`` wäre für V1 kein Typ, sondern ein Versprechen mit
    Ausnahme; genau daran ist Runde 2 gescheitert. Diese Zeile hält den Typ
    fest, damit ihn niemand versehentlich wieder aufweicht.
    """
    for name in ("x", "y", "w", "h"):
        assert WidgetInstance.model_fields[name].annotation is int, name


def test_a_null_coordinate_heals_into_the_v1_default() -> None:
    """Eine Zeile aus Runde 2 trägt ``null`` — V1 muss sie trotzdem lesen können.

    Bewusst kein 400: dieselbe Duldung wie bei ``includes``. Eine bereits
    geschriebene Seite dauerhaft unlesbar zu machen wäre der schlechtere von
    zwei Fehlern, und die Vorgabe, auf die geheilt wird, ist genau die, die V1
    ohnehin annimmt.
    """
    widget = WidgetInstance(id="w-1", type="light", x=None, y=None, w=None, h=None)
    assert (widget.x, widget.y, widget.w, widget.h) == (0, 0, 2, 2)


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


async def test_a_saved_responsive_page_keeps_its_coordinates_in_the_column(db: Database) -> None:
    """Nicht nur im Modell: in der Spalte stehen die Zahlen, und zwar unverändert."""
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(layout_mode="responsive", widgets=[_widget(x=9, y=8, w=7, h=6)]))

    raw = await _raw(db, "seite")
    assert [raw["widgets"][0][key] for key in ("x", "y", "w", "h")] == [9, 8, 7, 6]
    assert (await _load(db, "seite")).widgets[0].x == 9


async def test_a_saved_pixel_page_keeps_its_coordinates_in_the_column(db: Database) -> None:
    await _insert_node(db, "seite")

    await _save(db, "seite", PageConfig(layout_mode="pixel", widgets=[_widget(x=9, y=8, w=7, h=6)]))

    raw = await _raw(db, "seite")
    assert [raw["widgets"][0][key] for key in ("x", "y", "w", "h")] == [9, 8, 7, 6]


async def test_switching_back_to_pixel_needs_no_invented_position(db: Database) -> None:
    """Der Rückweg gibt genau die Lage zurück, die der Autor gesetzt hat.

    Der schwerste Fund aus Runde 2 hing an dieser Zeile: weil das Modell die
    Zahlen verwarf, musste der Editor beim Rückweg eine Lage erfinden
    (``0/0/2/2`` für JEDE Kachel, stapelweise auf demselben Punkt). Es gibt
    nichts zu erfinden, wenn nichts verworfen wurde.
    """
    await _insert_node(db, "seite")
    await _save(db, "seite", PageConfig(layout_mode="pixel", widgets=[_widget(x=9, y=8, w=7, h=6)]))

    await _save(db, "seite", PageConfig(layout_mode="responsive", widgets=(await _load(db, "seite")).widgets))
    zurueck = await _load(db, "seite")
    await _save(db, "seite", PageConfig(layout_mode="pixel", widgets=zurueck.widgets))

    endstand = (await _load(db, "seite")).widgets[0]
    assert (endstand.x, endstand.y, endstand.w, endstand.h) == (9, 8, 7, 6)


async def test_a_column_written_with_null_coordinates_reads_as_the_v1_defaults(db: Database) -> None:
    """Genau die Zeilen, die Runde 2 geschrieben hat — sie dürfen V1 nicht umbringen."""
    await _insert_node(
        db,
        "runde2",
        raw_page_config=json.dumps(
            {
                "layout_mode": "responsive",
                "widgets": [{"id": "w-1", "type": "light", "x": None, "y": None, "w": None, "h": None}],
            }
        ),
    )

    stored = (await _load(db, "runde2")).widgets[0]
    assert (stored.x, stored.y, stored.w, stored.h) == (0, 0, 2, 2)


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


# ── R17: V1 rendert eine responsiv gespeicherte Seite unverändert ─────────────
#
# Der Pflichtnachweis der Runde 3. ``frontend/`` selbst wird dafür NICHT
# angefasst (R17 verbietet es), sondern GELESEN: die Formel unten ist V1s eigene
# ``widgetStyle``, und ``test_the_modelled_v1_formula_is_still_v1s_own`` hält
# fest, dass sie es bleibt. Gerechnet wird auf genau den Bytes, die V1s
# API-Aufruf zurückbekommt — also auf dem echten Round-Trip durch die Spalte.

V1_EDITOR = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "views" / "VisuEditor.vue"
V1_TYPES = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "types" / "index.ts"


def _v1_widget_style(widget: WidgetInstance, config: PageConfig) -> dict[str, str]:
    """``widgetStyle`` aus ``frontend/src/views/VisuEditor.vue:398-405``.

    ``CELL_W``/``CELL_H`` sind dort ``config.grid_cell_width ?? 80`` (``:254``)
    und ``config.grid_row_height`` (``:252``).
    """
    cell_w = config.grid_cell_width if config.grid_cell_width is not None else 80
    cell_h = config.grid_row_height
    return {
        "left": f"{widget.x * cell_w}px",
        "top": f"{widget.y * cell_h}px",
        "width": f"{widget.w * cell_w}px",
        "height": f"{widget.h * cell_h}px",
    }


def _v1_occupied_cells(config: PageConfig) -> set[str]:
    """``insertWidget``s Belegungsrechnung, ``frontend/src/views/VisuEditor.vue:612-618``.

    Sie ist der zweite Weg, auf dem eine fehlende Koordinate V1 zerlegt: ``i %
    w.w`` ist bei ``w = 0`` (aus ``null``) in JS ein ``NaN``, hier eine
    ``ZeroDivisionError``. Beides heisst „die nächste freie Position lässt sich
    nicht mehr finden".
    """
    cells: set[str] = set()
    for widget in config.widgets:
        for i in range(widget.w * widget.h):
            cells.add(f"{widget.x + (i % widget.w)},{widget.y + i // widget.w}")
    return cells


def test_the_modelled_v1_formula_is_still_v1s_own() -> None:
    """Der Nachweis unten taugt nur, solange er V1s echte Rechnung nachbildet."""
    source = V1_EDITOR.read_text(encoding="utf-8")
    for fragment in (
        "left:   `${w.x * CELL_W.value}px`",
        "top:    `${w.y * CELL_H.value}px`",
        "width:  `${w.w * CELL_W.value}px`",
        "height: `${w.h * CELL_H.value}px`",
        "`${w.x + (i % w.w)},${w.y + Math.floor(i / w.w)}`",
    ):
        assert fragment in source, fragment
    # Und der Typ, an dem V1 die Zahl festmacht: kein `| null`.
    types = V1_TYPES.read_text(encoding="utf-8")
    assert "  x: number\n  y: number\n  w: number\n  h: number\n" in types


async def test_v1_renders_a_responsively_saved_page_unchanged(db: Database) -> None:
    """R17, gemessen: derselbe Kasten an derselben Stelle, vor und nach dem Wechsel.

    Ablauf wie im Produkt: V1 legt die Seite an (Pixel, echte Koordinaten), der
    V2-Editor stellt sie auf ``responsive`` und speichert, V1 liest sie wieder.
    Bis Runde 2 kollabierten dabei alle Kacheln auf ``left:0px; width:0px``,
    weil in der Spalte ``null`` stand.
    """
    await _insert_node(db, "geteilt")
    v1_seite = PageConfig(
        layout_mode="pixel",
        widgets=[
            _widget("w-1", x=0, y=0, w=3, h=2),
            _widget("w-2", x=4, y=0, w=3, h=2),
            _widget("w-3", x=4, y=2, w=3, h=2),
        ],
    )
    await _save(db, "geteilt", v1_seite)

    vorher = await _load(db, "geteilt")
    stil_vorher = [_v1_widget_style(w, vorher) for w in vorher.widgets]
    zellen_vorher = _v1_occupied_cells(vorher)

    # Der V2-Editor stellt NUR den Modus um und speichert die Seite.
    await _save(db, "geteilt", PageConfig(**{**vorher.model_dump(), "layout_mode": "responsive"}))

    nachher = await _load(db, "geteilt")
    assert nachher.layout_mode == "responsive"
    assert [_v1_widget_style(w, nachher) for w in nachher.widgets] == stil_vorher
    assert _v1_occupied_cells(nachher) == zellen_vorher
    # Kein Kollaps: die drei Kacheln liegen weiterhin an drei Stellen und haben Ausdehnung.
    assert len({stil["left"] + stil["top"] for stil in stil_vorher}) == 3
    for stil in [_v1_widget_style(w, nachher) for w in nachher.widgets]:
        assert stil["width"] != "0px"
        assert "None" not in stil["left"]


async def test_v1_reads_no_null_coordinate_from_a_responsive_page(db: Database) -> None:
    """Die Naht in der anderen Richtung: was V1 als JSON bekommt, trägt vier Zahlen."""
    await _insert_node(db, "geteilt")
    await _save(
        db,
        "geteilt",
        PageConfig(layout_mode="responsive", widgets=[_widget("w-1", x=4, y=6, w=3, h=2)]),
    )

    ausgeliefert = (await _load(db, "geteilt")).model_dump()
    for key in ("x", "y", "w", "h"):
        assert isinstance(ausgeliefert["widgets"][0][key], int), key
