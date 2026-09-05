/**
 * Das Seitenmodell des V2-Editors (M5 C2, Issue #169): wo der Layout-Modus, die
 * Rasterweite, die Breakpoints und die Marken „gesperrt"/„ausgeblendet" wohnen -
 * und wie daraus der Entwurf fuer die Vorschau wird.
 *
 * DIE NAHT, und warum sie so aussieht:
 *
 * Das Backend-Modell (`obs/models/visu.py` → `PageConfig`) kennt weder einen
 * Layout-Modus noch Breakpoints, und pydantic wirft unbekannte Felder beim
 * Speichern still weg (nachgemessen gegen `PageConfig.model_validate` +
 * `model_dump_json`). `obs/` gehoert nicht zu Teil C2, ein neues Feld ist also
 * nicht drin. Der EINZIGE frei formbare, dauerhafte Platz einer Seite ist
 * `WidgetInstance.config` - ein offener Dict, den das Backend unveraendert
 * durchreicht und den V1 (`frontend/`) ignoriert.
 *
 * Deshalb:
 *  - `config.editor`      → die Marken DIESES Widgets (`locked`, `hidden`, E8).
 *  - `config.editor_page` → die Einstellungen DER SEITE (`mode`, `breakpoints`,
 *    `grid`), auf JEDEM Widget gespiegelt. Die Spiegelung ist kein Geschmack,
 *    sondern Haltbarkeit: wer ein einzelnes Widget loescht, nimmt die
 *    Seiteneinstellungen sonst mit. Gelesen wird der erste Eintrag, der eine
 *    Spiegelung traegt.
 *
 * Bewusst NICHT benutzt wird `PageConfig.grid_cell_width`: das ist V1s
 * Zellbreite und bestimmt dort die Kachelgroesse. Sie als „Rasterweite" des V2-
 * Editors zu ueberschreiben wuerde die V1-Darstellung derselben Seite aendern -
 * R17 („V1 bleibt unberuehrt") gilt fuer die Daten so wie fuer den Code.
 *
 * OFFEN, ausdruecklich: eine Seite ganz OHNE Widgets kann heute keine
 * Seiteneinstellungen halten. Das ist die Grenze der Naht, nicht ihre Absicht;
 * sie faellt, sobald `PageConfig` ein eigenes Feld traegt (Teil A).
 */

import { DEFAULT_GRID } from '@/utils/visuEditorLayout'

export const LAYOUT_PIXEL = 'pixel'
export const LAYOUT_RESPONSIVE = 'responsive'
/** Die beiden Paradigmen - je Seite waehlbar (Design-Invariante §1.1). */
export const LAYOUT_MODES = [LAYOUT_PIXEL, LAYOUT_RESPONSIVE]

/** Vorgabe der Responsive-Breakpoints (E17), bis der Autor eigene setzt. */
export const DEFAULT_BREAKPOINTS = [480, 768, 1024]

/** Der Schluessel der Widget-Marken in `WidgetInstance.config`. */
export const WIDGET_FLAGS_KEY = 'editor'
/** Der Schluessel der Seiteneinstellungen in `WidgetInstance.config`. */
export const PAGE_SETTINGS_KEY = 'editor_page'

/**
 * Der Skin, gegen den der gewaehlte Modus gerendert wird.
 *
 * Der Editor soll ZEIGEN, welcher Modus rendert (Owner-Vorgabe): `edomi` besitzt
 * die Seite und honoriert `position` (Pixel), `ionic` legt seinen responsiven
 * Boden und ignoriert Koordinaten. Die Schluessel sind die der Host-Registry
 * (`apps/visu/src/skin-host/skins.ts`).
 */
export function skinForMode(mode) {
  return mode === LAYOUT_RESPONSIVE ? 'ionic' : 'edomi'
}

/** Die Marken eines Widgets - fehlt etwas, ist es aus. */
export function widgetFlags(widget) {
  const raw = widget && widget.config ? widget.config[WIDGET_FLAGS_KEY] : null
  return {
    locked: Boolean(raw && raw.locked),
    hidden: Boolean(raw && raw.hidden),
  }
}

/** Eine Kopie des Widgets mit geaenderten Marken; das Original bleibt stehen. */
export function withWidgetFlags(widget, patch) {
  const flags = { ...widgetFlags(widget), ...(patch || {}) }
  return {
    ...widget,
    config: {
      ...(widget && widget.config ? widget.config : {}),
      [WIDGET_FLAGS_KEY]: { locked: Boolean(flags.locked), hidden: Boolean(flags.hidden) },
    },
  }
}

/** Eine positive ganze Zahl oder `null`. */
function positiveInt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  return rounded > 0 ? rounded : null
}

/**
 * Die Rasterweite: eine Zahl wird auf mindestens 1 geklemmt, KEINE Zahl faellt
 * auf die Vorgabe zurueck. Der Unterschied ist Absicht - „0" ist die Ansage
 * „ohne Raster" (`snapValue` rundet dann nur), und die darf nicht heimlich als
 * 8er-Raster wieder auftauchen.
 */
function gridValue(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.round(n))
}

/**
 * Die Breakpoints einer Eingabe (E17). Komma oder Semikolon trennen, alles, was
 * keine positive Zahl ist, faellt weg; Dubletten fallen weg; sortiert wird
 * aufsteigend, damit die Vorschau-Auswahl eine Ordnung hat.
 */
export function parseBreakpoints(text) {
  if (typeof text !== 'string') return []
  const found = []
  for (const part of text.split(/[,;]/)) {
    const n = positiveInt(part.trim())
    if (n !== null && !found.includes(n)) found.push(n)
  }
  return found.sort((a, b) => a - b)
}

/** Die Breakpoints als Text, so wie der Autor sie eingibt. */
export function formatBreakpoints(list) {
  return Array.isArray(list) ? list.join(', ') : ''
}

/** Die Vorgaben, wenn eine Seite noch nichts traegt. */
function defaultSettings() {
  return { mode: LAYOUT_PIXEL, breakpoints: [...DEFAULT_BREAKPOINTS], grid: DEFAULT_GRID }
}

/** Aus rohen Werten geprueft gemachte Einstellungen. */
function normalizeSettings(raw) {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  return {
    mode: LAYOUT_MODES.includes(raw.mode) ? raw.mode : base.mode,
    breakpoints: Array.isArray(raw.breakpoints)
      ? raw.breakpoints.map(positiveInt).filter((n) => n !== null)
      : base.breakpoints,
    grid: gridValue(raw.grid, base.grid),
  }
}

/**
 * Die Seiteneinstellungen einer `PageConfig` - gelesen vom ersten Widget, das
 * die Spiegelung traegt. Eine Seite ohne Spiegelung liefert die Vorgaben.
 */
export function readPageSettings(pageConfig) {
  const widgets = pageConfig && Array.isArray(pageConfig.widgets) ? pageConfig.widgets : []
  const carrier = widgets.find((w) => w && w.config && w.config[PAGE_SETTINGS_KEY])
  return normalizeSettings(carrier ? carrier.config[PAGE_SETTINGS_KEY] : null)
}

/**
 * Eine neue `PageConfig` mit den gewuenschten Einstellungen, auf jedes Widget
 * gespiegelt. Teil-Aenderungen sind erlaubt: was der Aufruf nicht nennt, bleibt
 * so, wie die Seite es heute traegt.
 */
export function writePageSettings(pageConfig, patch) {
  const current = readPageSettings(pageConfig)
  const next = normalizeSettings({ ...current, ...(patch || {}) })
  const widgets = pageConfig && Array.isArray(pageConfig.widgets) ? pageConfig.widgets : []
  return {
    ...(pageConfig || {}),
    widgets: widgets.map((w) => ({
      ...w,
      config: { ...(w && w.config ? w.config : {}), [PAGE_SETTINGS_KEY]: { ...next } },
    })),
  }
}

/**
 * Der Entwurf, den die Vorschau-Bruecke traegt (Protokoll 1.1,
 * `apps/visu/src/preview/protocol.ts`). Er traegt die BACKEND-Form, damit die
 * Vorschau ihn mit denselben Funktionen abbildet wie die echte Visu.
 *
 * Zwei Regeln stecken darin:
 *  1. Ein AUSGEBLENDETES Widget ist nicht im Entwurf (E8). Es bleibt im Canvas
 *     und im Baum - ausgeblendet heisst „nicht im Bild", nicht „geloescht".
 *  2. Im RESPONSIVEN Modus traegt der Entwurf keine Koordinaten (E2,
 *     Design-Invariante §1.1). Der Host emittiert dann auch kein `position`
 *     (`readPosition` in `core/obs/mapping.ts`: eine unvollstaendige Box ist
 *     keine Box), und der Skin legt seinen eigenen Boden.
 */
export function toPreviewDraft({ pageId, name, kind, pageConfig }) {
  if (!pageId || !pageConfig) return null
  const settings = readPageSettings(pageConfig)
  const widgets = (Array.isArray(pageConfig.widgets) ? pageConfig.widgets : [])
    .filter((w) => w && !widgetFlags(w).hidden)
    .map((w) => {
      const item = {
        id: w.id,
        name: w.name,
        type: w.type,
        datapoint_id: w.datapoint_id ?? null,
        status_datapoint_id: w.status_datapoint_id ?? null,
        config: w.config ?? {},
      }
      if (settings.mode !== LAYOUT_RESPONSIVE) {
        item.x = w.x
        item.y = w.y
        item.w = w.w
        item.h = w.h
      }
      return item
    })
  return {
    skin: skinForMode(settings.mode),
    pageId,
    nodes: [
      {
        id: pageId,
        parent_id: null,
        name: name ?? '',
        type: 'PAGE',
        kind: kind ?? 'normal',
        order: 0,
        access: null,
        page_config: { ...pageConfig, widgets },
      },
    ],
  }
}
