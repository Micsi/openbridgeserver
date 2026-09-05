/**
 * Das Seitenmodell des V2-Editors (M5 C2, Issue #169): wo der Layout-Modus, die
 * Rasterweite, die Breakpoints, der Skin und die Marken „gesperrt"/„ausgeblendet"
 * wohnen - und wie daraus der Entwurf fuer die Vorschau wird.
 *
 * DIE NAHT, und warum sie so aussieht:
 *
 *  - `PageConfig.layout_mode` / `.grid` / `.breakpoints` / `.skin` → die
 *    Eigenschaften DER SEITE. Sie liegen im Backend-Modell (`obs/models/visu.py`),
 *    additiv in derselben JSON-Spalte wie `includes`/`popup`, ohne Migration.
 *  - `WidgetInstance.config.editor` → die Marken DIESES Widgets (`locked`,
 *    `hidden`, E8). Sie gehoeren dem Widget und bleiben dort.
 *
 * VORGESCHICHTE (Runde 1, bewusst hier festgehalten): bis Runde 2 spiegelte
 * dieser Editor die Seiteneigenschaften in `WidgetInstance.config.editor_page`
 * auf JEDES Widget. Das war ein Datenfork: n Kopien derselben Wahrheit, kein
 * Besitzer, gelesen wurde die erste Kopie der LISTENREIHENFOLGE - also genau der
 * Groesse, die E2 (Umsortieren) und E8 (Z-Ordnung) veraendern. Eine Seite ohne
 * Widgets konnte die Werte gar nicht halten und bekam trotzdem „Gespeichert"
 * gemeldet. Ausserhalb von `gui/` kannte das Feld niemand. Deshalb ist der
 * Traeger jetzt die Seite selbst, und es gibt keinen Rueckfallpfad auf
 * `editor_page`: ein zweiter Leseort waere derselbe Fehler mit einer Ausrede.
 *
 * DIE DESIGN-INVARIANTE (§1.1) gilt hier wie im Backend: eine Seite im
 * responsiven Modus traegt KEINE Koordinaten. `writePageSettings` legt sie beim
 * Wechsel ab, `PageConfig` im Backend tut dasselbe noch einmal - der Editor ist
 * damit ehrlich zu dem, was gleich in der Datenbank steht, und die Regel haengt
 * nicht an ihm allein.
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

/** Die vier Zahlen der Autoren-Box. */
export const BOX_KEYS = ['x', 'y', 'w', 'h']

/**
 * Der Skin, gegen den gerendert wird, wenn die Seite keinen nennt.
 *
 * `edomi` ist die Vorgabe, weil es der Skin ist, der die Autoren-Box honoriert -
 * eine Seite ohne Skin-Wahl ist eine Bestandsseite, und die ist im Pixel-Modus.
 */
export const DEFAULT_SKIN = 'edomi'

/**
 * Die Skins, die `position` honorieren (Host-Registry:
 * `apps/visu/src/skin-host/skins.ts`). `edomi` besitzt die Seite und zeichnet die
 * Autoren-Box; `ionic` und `terminal` legen ihren eigenen Boden und ignorieren
 * Koordinaten.
 */
export const POSITION_SKINS = ['edomi']

/** Honoriert dieser Skin die Autoren-Box? */
export function skinHonorsPosition(skin) {
  return POSITION_SKINS.includes(skin || DEFAULT_SKIN)
}

/**
 * Welcher Modus wird tatsaechlich gerendert - JE SKIN (Design-Invariante §1.1:
 * „Der Editor zeigt je Skin, welcher Modus gerendert wird").
 *
 * Die Richtung ist wichtig und war in Runde 1 verdreht: dort leitete
 * `skinForMode()` den SKIN aus dem MODUS ab (`pixel → edomi`,
 * `responsive → ionic`). Damit war der Skin nicht mehr waehlbar und kollidierte
 * mit E19 (Skin je Seite, Teil C1). Modus und Skin sind ZWEI Seiteneigenschaften:
 * der Modus sagt, was die Seite TRAEGT, der Skin, was davon HONORIERT wird. Eine
 * Pixel-Seite unter `ionic` wird responsiv gerendert - der Autor soll das sehen,
 * statt sich zu wundern.
 */
export function renderedMode(mode, skin) {
  return mode === LAYOUT_PIXEL && skinHonorsPosition(skin) ? LAYOUT_PIXEL : LAYOUT_RESPONSIVE
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

/**
 * Eine Kopie des Widgets OHNE Autoren-Box. Die Schluessel fallen ganz weg statt
 * auf `null` zu gehen: eine unvollstaendige Box ist fuer den Host keine Box
 * (`readPosition`), und ein fehlender Schluessel sagt dasselbe, ohne der Seite
 * eine Zahl anzudichten. Das Backend legt dafuer `null` ab - beides liest
 * `readPosition` gleich.
 */
export function withoutBox(widget) {
  const copy = { ...widget }
  for (const key of BOX_KEYS) delete copy[key]
  return copy
}

/** Traegt dieses Widget eine vollstaendige Autoren-Box? */
export function hasBox(widget) {
  return BOX_KEYS.every((key) => typeof (widget || {})[key] === 'number')
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
 * auf die Vorgabe zurueck. Der Unterschied ist Absicht - eine Seite, die eine
 * Rasterweite traegt, soll sie behalten, und eine, die keine traegt, bekommt die
 * Vorgabe statt einer 0.
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
 * aufsteigend - dieselbe Normalisierung wie `PageConfig._normalize_breakpoints`
 * im Backend, damit der Editor keine Liste anzeigt, die die Seite nicht traegt.
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
  return {
    mode: LAYOUT_PIXEL,
    breakpoints: [...DEFAULT_BREAKPOINTS],
    grid: DEFAULT_GRID,
    skin: null,
  }
}

/** Aus rohen Werten geprueft gemachte Einstellungen. */
function normalizeSettings(raw) {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const skin = typeof raw.skin === 'string' ? raw.skin.trim() : ''
  return {
    mode: LAYOUT_MODES.includes(raw.mode) ? raw.mode : base.mode,
    breakpoints: Array.isArray(raw.breakpoints)
      ? raw.breakpoints
          .map(positiveInt)
          .filter((n, i, all) => n !== null && all.indexOf(n) === i)
          .sort((a, b) => a - b)
      : base.breakpoints,
    grid: gridValue(raw.grid, base.grid),
    skin: skin || null,
  }
}

/**
 * Die Seiteneigenschaften einer `PageConfig` - aus der Seite, nicht aus ihren
 * Widgets. Eine Seite ohne diese Felder (jede Bestandsseite) liefert die
 * Vorgaben, und eine Seite ohne Widgets traegt sie genauso wie jede andere.
 */
export function readPageSettings(pageConfig) {
  const raw = pageConfig && typeof pageConfig === 'object' ? pageConfig : {}
  return normalizeSettings({
    mode: raw.layout_mode,
    grid: raw.grid,
    breakpoints: raw.breakpoints,
    skin: raw.skin,
  })
}

/**
 * Eine neue `PageConfig` mit den gewuenschten Einstellungen. Teil-Aenderungen
 * sind erlaubt: was der Aufruf nicht nennt, bleibt so, wie die Seite es heute
 * traegt.
 *
 * Im responsiven Modus verlassen die Koordinaten die Seite schon hier - der
 * Editor schickt damit genau das, was gleich in der Spalte steht, und die
 * Vorschau zeigt kein Bild, das der gespeicherte Stand nicht haette.
 */
export function writePageSettings(pageConfig, patch) {
  const current = readPageSettings(pageConfig)
  const next = normalizeSettings({ ...current, ...(patch || {}) })
  const widgets = pageConfig && Array.isArray(pageConfig.widgets) ? pageConfig.widgets : []
  return {
    ...(pageConfig || {}),
    layout_mode: next.mode,
    grid: next.grid,
    breakpoints: [...next.breakpoints],
    skin: next.skin,
    widgets:
      next.mode === LAYOUT_RESPONSIVE ? widgets.map(withoutBox) : widgets.map((w) => ({ ...w })),
  }
}

/** Sind zwei Saetze Seiteneigenschaften derselbe Satz? */
export function sameSettings(a, b) {
  const left = normalizeSettings(a)
  const right = normalizeSettings(b)
  return (
    left.mode === right.mode &&
    left.grid === right.grid &&
    left.skin === right.skin &&
    left.breakpoints.length === right.breakpoints.length &&
    left.breakpoints.every((n, i) => n === right.breakpoints[i])
  )
}

/**
 * Der Entwurf als REINE DATEN - kein reaktiver Proxy, keine Vue-Innereien.
 *
 * Das ist keine Kosmetik, sondern die Bedingung dafuer, dass er ueberhaupt
 * ankommt: die Bruecke schickt ihn per `postMessage`, und der Structured-Clone-
 * Algorithmus lehnt einen Proxy ab (`DataCloneError: #<Object> could not be
 * cloned`). Alles, was aus dem Canvas kommt, haengt an `ref()`/`reactive()` - die
 * `config` eines Widgets ebenso wie die geladene `page_config` eines Layers.
 *
 * Gemessen mit der Vorschau auf der ECHTEN Visu (`VITE_VISU_PREVIEW_URL` auf
 * `http://…/preview`): ohne diese Zeile blieb im Rahmen „Warte auf einen Entwurf
 * aus dem Editor" stehen, und in der Konsole stand genau dieser Fehler. Solange
 * die Vorschau-Adresse nichts auslieferte (Teil D ist offen), kam es nie so weit -
 * ohne Handshake wird gar keine Nachricht geschickt.
 *
 * Der Vertrag nennt den Entwurf ohnehin als Daten (`PreviewDraft`, Protokoll 1.1);
 * der JSON-Umweg ist damit seine Form und keine Notloesung.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Ein Knoten des Entwurfs in der BACKEND-Form. Ein Layer ist derselbe Knoten wie
 * die Seite selbst - die Vorschau komponiert ihn mit denselben Funktionen wie die
 * echte Visu (`composeLayers`), es gibt hier keine zweite Kompositionsregel.
 */
function draftNode({ id, name, kind, order = 0, pageConfig }) {
  return {
    id,
    parent_id: null,
    name: name ?? '',
    type: 'PAGE',
    kind: kind ?? 'normal',
    order,
    access: null,
    page_config: pageConfig,
  }
}

/**
 * Der Entwurf, den die Vorschau-Bruecke traegt (Protokoll 1.1,
 * `apps/visu/src/preview/protocol.ts`). Er traegt die BACKEND-Form, damit die
 * Vorschau ihn mit denselben Funktionen abbildet wie die echte Visu.
 *
 * Vier Regeln stecken darin:
 *  1. Ein AUSGEBLENDETES Widget ist nicht im Entwurf (E8). Es bleibt im Canvas
 *     und im Baum - ausgeblendet heisst „nicht im Bild", nicht „geloescht".
 *  2. Im RESPONSIVEN Modus traegt der Entwurf keine Koordinaten (E2,
 *     Design-Invariante §1.1). Der Host emittiert dann auch kein `position`.
 *  3. Der SKIN ist die Wahl der Seite, keine Ableitung aus dem Modus (E19/C1).
 *     Ohne Wahl gilt {@link DEFAULT_SKIN}.
 *  4. Die LAYER (globale Inkludeseiten, individuelle Inkludeseiten) stehen als
 *     eigene Knoten im Entwurf, damit die Vorschau sie mit `composeLayers` genau
 *     so stapelt wie die echte Visu. Ein ausgeblendeter Layer verschwindet nicht
 *     durch eine Sonderregel, sondern ueber die BESTEHENDEN: der globale Boden
 *     ueber `ignore_global_includes` (R13), die individuellen ueber eine leere
 *     `includes`-Liste (R14). Der Autor sieht damit genau das Bild, das eine
 *     Seite haette, die es so gespeichert haette.
 */
export function toPreviewDraft({
  pageId,
  name,
  kind,
  pageConfig,
  layers = [],
  showGlobalLayer = true,
  showIncludeLayer = true,
}) {
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
        for (const key of BOX_KEYS) item[key] = w[key]
      }
      return item
    })
  const visible = (Array.isArray(layers) ? layers : []).filter((layer) =>
    layer && layer.kind === 'globalInclude' ? showGlobalLayer : showIncludeLayer,
  )
  const ownConfig = {
    ...pageConfig,
    widgets,
    includes: showIncludeLayer ? (pageConfig.includes ?? []) : [],
    ignore_global_includes: showGlobalLayer ? (pageConfig.ignore_global_includes ?? false) : true,
  }
  return plain({
    skin: settings.skin || DEFAULT_SKIN,
    pageId,
    nodes: [
      draftNode({ id: pageId, name, kind, pageConfig: ownConfig }),
      ...visible.map((layer, index) =>
        draftNode({
          id: layer.id,
          name: layer.name,
          kind: layer.kind,
          order: index + 1,
          pageConfig: layer.page_config ?? { widgets: [] },
        }),
      ),
    ],
  })
}
