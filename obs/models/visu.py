"""Visu-Modelle — Pydantic-Schemas für das Visualisierungs-System

VisuNode: Knoten im Gebäudebaum (LOCATION oder PAGE)
PageConfig: Seiten-Konfiguration mit Widget-Liste
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

# ── Typen ─────────────────────────────────────────────────────────────────────

NodeType = Literal["LOCATION", "PAGE"]
AccessLevel = Literal["readonly", "public", "protected", "user"]
# Seitentyp (M5): normale Seite, Popup oder globale Inkludeseite.
# Individuelle Inkludeseiten sind gewöhnliche Seiten, die woanders in
# ``PageConfig.includes`` referenziert werden, sie brauchen keinen eigenen Typ.
PageKind = Literal["normal", "popup", "globalInclude"]
# Layout-Paradigma einer Seite (M5 §1.1, Design-Invariante): eine Seite trägt
# **entweder** Koordinaten (``pixel``) **oder** nur Reihenfolge/Gruppe
# (``responsive``). Je Seite wählbar — Pixel-Autorenschaft ist ein Angebot.
LayoutMode = Literal["pixel", "responsive"]


# ── WidgetInstance ────────────────────────────────────────────────────────────


#: Die Vorgabe-Box eines Widgets — dieselben vier Zahlen, die V1 seit jeher
#: annimmt (``frontend/src/types/index.ts`` → ``WidgetInstance``).
_BOX_DEFAULTS = {"x": 0, "y": 0, "w": 2, "h": 2}


class WidgetInstance(BaseModel):
    """Ein platziertes Widget.

    ``x``/``y``/``w``/``h`` sind die Autoren-Box: **vier ganze Zahlen, immer**.
    Der Typ ist kein Detail, sondern R17 — V1 liest dieselbe Zeile, deklariert
    ``x: number`` (``frontend/src/types/index.ts:45-48``) und rechnet damit
    ungeprüft (``w.x * CELL_W``, ``frontend/src/views/VisuEditor.vue:400``; die
    Belegungsrechnung ``i % w.w``, ``:615``). Ein ``None`` wird dort zu ``0``,
    und die Seite kollabiert auf ``left:0px; width:0px``.

    Ob die Box **wirkt**, sagt nicht ihr Vorhandensein, sondern der Modus der
    SEITE (``PageConfig.layout_mode``): auf einer responsiven Seite emittiert der
    Host gar kein ``position`` (``mapTree``/``itemsOf`` in
    ``apps/visu/src/core/obs/``). Damit gilt beides — die Design-Invariante §1.1
    („im responsiven Modus wirkt keine Koordinate") und R17.

    Eine Zeile, in der schon ``null`` steht, wird beim Lesen auf die Vorgabe
    geheilt statt abgewiesen (siehe ``_a_missing_coordinate_is_the_v1_default``).
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""  # frei wählbarer Widget-Name
    type: str
    datapoint_id: str | None = None
    status_datapoint_id: str | None = None  # optionaler Rückmelde-DP
    x: int = 0
    y: int = 0
    w: int = 2
    h: int = 2
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("x", "y", "w", "h", mode="before")
    @classmethod
    def _a_missing_coordinate_is_the_v1_default(cls, value: Any, info: Any) -> Any:
        """``null`` → die V1-Vorgabe, statt die Seite unlesbar zu machen.

        Dieselbe Duldung wie bei ``PageConfig._drop_duplicate_includes``: eine
        bereits geschriebene Zeile darf nicht dauerhaft unspeicherbar werden.
        Betroffen sind genau die Seiten, die eine frühere Fassung dieses Modells
        im responsiven Modus geleert hat — sie heilen beim ersten Lesen, und V1
        sieht wieder vier Zahlen.
        """
        return _BOX_DEFAULTS[info.field_name] if value is None else value


class WidgetRefInstance(WidgetInstance):
    source_page_readonly: bool = False


# ── PopupConfig ───────────────────────────────────────────────────────────────


class PopupConfig(BaseModel):
    """Darstellungs-Deskriptor einer Popup-Seite (nur für ``kind == "popup"``).

    Reine Daten: der Host reicht sie an den Skin durch, das Backend wertet sie
    nicht aus. Fehlt eine der beiden Koordinaten, zentriert der Host (R2).
    """

    x: int | None = None
    y: int | None = None
    w: int | None = None
    h: int | None = None
    auto_close_ms: int | None = None  # R4
    modal: bool = False  # „exklusiv öffnen" (R5)
    animate: bool = False  # R6
    shadow: bool = False  # R6
    dim_backdrop: bool = False  # R6


# ── PageConfig ────────────────────────────────────────────────────────────────


class PageConfig(BaseModel):
    """Die Konfiguration einer Seite.

    Die Layout-Felder unten (``layout_mode``, ``grid``, ``breakpoints``, ``skin``)
    sind der Nachtrag aus M5 C2 (Issue #169): **Seiten**-Eigenschaften gehören der
    Seite. Sie sind additiv in derselben JSON-Spalte wie ``includes``/``popup``,
    brauchen also keine Migration; eine Zeile aus der Zeit davor liest sie als
    ihre Vorgaben.
    """

    grid_cols: int = 12
    grid_row_height: int = 80
    grid_cell_width: int = 80  # feste Zellbreite in Pixeln (WYSIWYG)
    background: str | None = None
    widgets: list[WidgetInstance] = Field(default_factory=list)
    includes: list[str] = Field(default_factory=list)  # individuelle Inkludeseiten, geordnet (R14)
    ignore_global_includes: bool = False  # R13
    popup: PopupConfig | None = None

    # ── Layout der Seite (M5 C2, §1.1) ────────────────────────────────────────
    #
    # Bewusst NICHT ``grid_cell_width`` mitbenutzt: das ist V1s Zellbreite und
    # bestimmt dort die Kachelgröße. Sie als „Rasterweite" des V2-Editors zu
    # überschreiben würde die V1-Darstellung derselben Seite ändern (R17).
    # Die Design-Invariante §1.1 hängt an DIESEM Feld — nicht am Fehlen von
    # Koordinaten. Der Host liest es und emittiert auf einer responsiven Seite
    # gar kein ``position`` (``mapTree``/``itemsOf`` in
    # ``apps/visu/src/core/obs/``); die Zahlen selbst bleiben in der Spalte
    # stehen, weil V1 dieselbe Zeile liest und sie als ``number`` erwartet (R17).
    # Der Rückweg auf ``pixel`` gibt damit genau die Lage zurück, die der Autor
    # gesetzt hat — es gibt nichts zu erfinden, weil nichts verworfen wurde.
    layout_mode: LayoutMode = "pixel"
    grid: int = 8  # Rasterweite des V2-Editors in Autoreneinheiten
    breakpoints: list[int] = Field(default_factory=lambda: [480, 768, 1024])  # E17
    # Der Skin, gegen den diese Seite gebaut wird (E19, Teil C1). ``None`` heißt
    # „keine Wahl getroffen" — der Ausliefernde entscheidet dann. Ein leerer
    # String wäre ein Registry-Schlüssel, den es nicht gibt, und wird zu ``None``.
    skin: str | None = None

    @field_validator("grid")
    @classmethod
    def _clamp_grid(cls, value: int) -> int:
        """Mindestens 1: ein Raster der Weite 0 ist kein Raster, sondern eine Division durch nichts."""
        return max(1, value)

    @field_validator("breakpoints")
    @classmethod
    def _normalize_breakpoints(cls, value: list[int]) -> list[int]:
        """Positiv, dublettenfrei, aufsteigend.

        Dieselbe Duldung wie bei ``includes``: eine unbrauchbare Zahl aus einem
        Restore macht die Seite nicht dauerhaft unspeicherbar, sie fällt weg. Die
        Ordnung ist keine Kosmetik — die Vorschau-Auswahl des Editors bietet die
        Breakpoints in genau dieser Reihenfolge an.
        """
        return sorted({width for width in value if width > 0})

    @field_validator("skin")
    @classmethod
    def _blank_skin_is_no_skin(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("includes")
    @classmethod
    def _drop_duplicate_includes(cls, value: list[str]) -> list[str]:
        """Duplikate still entfernen, Reihenfolge des ersten Vorkommens behalten.

        R14 wählt je Include-Zeile *eine* Seite; dieselbe Seite zweimal zu
        komponieren hat keine zusätzliche Bedeutung (identische Widgets auf
        identischen Datenpunkten) und wäre für Teil B nur eine Doppel-Darstellung.
        Bewusst **kein** 400: eine bereits gespeicherte Doppelung (Restore,
        direkter DB-Zugriff) würde die Seite sonst dauerhaft unspeicherbar machen -
        genau der Fehlertyp, den die Duldung unveränderter Alt-Einträge in
        ``_validate_page_kind_config`` verhindert. Die Normalisierung ist idempotent
        und greift auf jedem Weg (PUT, Import, Kopie, Lesen); Teil B bekommt die
        Liste damit garantiert dublettenfrei, ohne selbst zu entdoppeln.
        """
        return list(dict.fromkeys(value))


# ── VisuNode ──────────────────────────────────────────────────────────────────


class VisuNode(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    parent_id: str | None = None
    name: str
    type: NodeType = "PAGE"
    kind: PageKind = "normal"
    order: int = 0
    icon: str | None = None
    access: AccessLevel | None = None  # None = von Elternknoten erben
    access_pin: str | None = None  # bcrypt-Hash, nie im Klartext
    page_config: PageConfig | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class VisuPageVersion(BaseModel):
    """Ein festgehaltener Stand einer Seiten-Konfiguration (M5 C6, E12).

    Nur der Steckbrief, nicht der Inhalt: der Verlauf im Editor soll lesbar sein,
    ohne n Konfigurationen im Rumpf mitzuschleppen. Der Stand selbst kommt
    einzeln über ``GET /visu/nodes/{id}/versions/{revision}`` und ist eine
    gewöhnliche ``PageConfig`` - dieselbe Form, die ``GET /visu/pages/{id}``
    liefert. Wiederherstellen muss deshalb nichts umrechnen, es schickt genau
    diese Antwort an ``PUT /visu/pages/{id}`` zurück.

    ``created_by`` ist der Principal, der den Stand geschrieben hat; ``None``,
    wo die Zeile keinen Urheber trägt.
    """

    revision: int
    created_at: datetime
    created_by: str | None = None


class VisuNodeSummary(BaseModel):
    """Navigation metadata without page configuration or credentials.

    ``has_pin`` ist die einzige Angabe hier, die nicht der Navigation dient
    (M5 C6, Issue #173). Sie sagt, ob es zu dieser Seite überhaupt eine
    PIN-Zeile gibt - nie den Hash und nie den PIN selbst. Der Grund ist ein
    dauerhafter Zustand, den sonst niemand sehen kann: eine ``protected``-Seite
    OHNE PIN ist für jeden Besucher zu, und im Eigenschaftsformular ist sie von
    einer gewöhnlichen geschützten Seite nicht zu unterscheiden - das PIN-Feld
    steht dort immer leer, denn der Hash geht nie an den Browser. So entsteht
    er vor allem beim Import einer Seite (ein Export trägt kein Geheimnis, siehe
    ``import_nodes``); die Meldung dort ist flüchtig, dieser Befund bleibt.

    ``None`` heißt **nicht ausgewiesen**, nicht „keine PIN": der Baum geht auch
    an Besucher hinaus, und wie eine geschützte Seite ausgestattet ist, gehört
    dem Autorenwerkzeug. Wer die Antwort nicht als Admin holt, bekommt hier
    ``None`` - für ihn ist die Frage nicht beantwortet.
    """

    id: str
    parent_id: str | None = None
    name: str
    type: NodeType
    kind: PageKind = "normal"
    order: int = 0
    icon: str | None = None
    access: AccessLevel | None = None
    has_pin: bool | None = None
    created_at: datetime
    updated_at: datetime


# ── Request-Schemas ───────────────────────────────────────────────────────────


class VisuNodeCreate(BaseModel):
    parent_id: str | None = None
    name: str
    type: NodeType = "PAGE"
    kind: PageKind = "normal"
    order: int = 0
    icon: str | None = None
    access: AccessLevel | None = None
    access_pin: str | None = None  # Klartext — wird im Endpoint gehasht


class VisuNodeUpdate(BaseModel):
    name: str | None = None
    kind: PageKind | None = None
    order: int | None = None
    icon: str | None = None
    access: AccessLevel | None = None
    access_pin: str | None = None  # Klartext — wird im Endpoint gehasht
    usernames: list[str] | None = None  # atomare Zielgruppen-Aktualisierung


class PinAuthRequest(BaseModel):
    pin: str


class PinAuthResponse(BaseModel):
    session_token: str
    expires_in: int = 3600


class VisuNodeUsersUpdate(BaseModel):
    usernames: list[str]


class CopyNodeRequest(BaseModel):
    target_parent_id: str | None = None
    new_name: str


class MoveNodeRequest(BaseModel):
    new_parent_id: str | None = None
    order: int = 0


# ── Export-/Import-Schemas ────────────────────────────────────────────────────


class VisuExportNode(BaseModel):
    """Ein einzelner Knoten im Export-Format (ohne access_pin)."""

    id: str
    parent_id: str | None = None
    name: str
    type: NodeType
    kind: PageKind = "normal"  # Default hält ältere Exporte importierbar (R17)
    node_order: int = 0
    icon: str | None = None
    access: AccessLevel | None = None
    page_config: dict | None = None


class VisuImportRequest(BaseModel):
    """Import-Payload für einen exportierten Visu-Teilbaum."""

    obs_export: str  # muss "visu_subtree" sein
    version: int
    nodes: list[VisuExportNode]
    target_parent_id: str | None = None
