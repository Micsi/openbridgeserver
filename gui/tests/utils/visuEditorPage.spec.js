import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import {
  DEFAULT_BREAKPOINTS,
  DEFAULT_SKIN,
  LAYOUT_MODES,
  LAYOUT_PIXEL,
  LAYOUT_RESPONSIVE,
  formatBreakpoints,
  hasBox,
  parseBreakpoints,
  readPageSettings,
  renderedMode,
  sameSettings,
  skinHonorsPosition,
  toPreviewDraft,
  widgetFlags,
  withWidgetFlags,
  writePageSettings,
} from '@/utils/visuEditorPage'

/**
 * Das Seitenmodell des Editors (M5 C2, Issue #169) - wo der Modus, die
 * Rasterweite, die Breakpoints, der Skin und die Marken
 * „gesperrt"/„ausgeblendet" wohnen.
 *
 * DIE NAHT, die diese Datei traegt: die vier Seiteneigenschaften stehen in der
 * `PageConfig` des Backends (`obs/models/visu.py`), additiv in derselben
 * JSON-Spalte wie `includes`/`popup`. In Runde 1 lagen sie n-fach in
 * `WidgetInstance.config.editor_page` - ein Datenfork ohne Besitzer, den eine
 * Seite ohne Widgets gar nicht halten konnte. Diese Datei haelt die Abloesung
 * fest; die Backend-Haelfte steht in `tests/unit/test_visu_page_layout.py`.
 *
 * DIE KORREKTUR AUS RUNDE 3 steht in dieser Datei an mehreren Stellen: bis
 * Runde 2 nahm `writePageSettings` einer responsiven Seite JEDE Koordinate ab,
 * und der Entwurf trug sie folglich auch nicht. Das setzte die
 * Design-Invariante §1.1 durch und brach R17 im selben Zug - V1 liest dieselbe
 * Seite, deklariert `x: number` und rechnet `w.x * CELL_W`, aus `null` wird `0`,
 * die Kacheln kollabieren. Jetzt bleiben die Zahlen stehen; ob sie WIRKEN,
 * entscheidet `layout_mode`, und zwar im Host (`pageHonoursPosition` in
 * `apps/visu/src/core/obs/mapping.ts`, gelesen von `mapTree` und `itemsOf`).
 * Der Editor muss dafuer nichts mehr wegnehmen - und erfindet auf dem Rueckweg
 * folglich auch nichts mehr.
 */

const widget = (id, extra = {}) => ({
  id,
  name: `W ${id}`,
  type: 'Toggle',
  datapoint_id: `dp-${id}`,
  status_datapoint_id: null,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  config: {},
  ...extra,
})

const page = (widgets) => ({
  grid_cols: 12,
  grid_row_height: 80,
  grid_cell_width: 80,
  background: null,
  widgets,
  includes: [],
  ignore_global_includes: false,
  popup: null,
})

describe('widgetFlags - sperren und ausblenden (E8)', () => {
  it('meldet fuer ein frisches Widget beides als aus', () => {
    expect(widgetFlags(widget('a'))).toEqual({ locked: false, hidden: false })
  })

  it('liest die Marken aus der Widget-Konfiguration', () => {
    const w = widget('a', { config: { editor: { locked: true, hidden: true } } })
    expect(widgetFlags(w)).toEqual({ locked: true, hidden: true })
  })

  it('vertraegt ein Widget ohne config und ein fehlendes Widget', () => {
    expect(widgetFlags({ id: 'a' })).toEqual({ locked: false, hidden: false })
    expect(widgetFlags(null)).toEqual({ locked: false, hidden: false })
  })

  it('setzt eine Marke, ohne die uebrige Konfiguration anzufassen', () => {
    const w = widget('a', { config: { target_node_id: 'n1' } })
    const next = withWidgetFlags(w, { locked: true })
    expect(next.config.target_node_id).toBe('n1')
    expect(widgetFlags(next)).toEqual({ locked: true, hidden: false })
    // und das Original bleibt, wie es war
    expect(widgetFlags(w)).toEqual({ locked: false, hidden: false })
  })
})

describe('hasBox - die Autoren-Box', () => {
  it('erkennt eine vollstaendige Box', () => {
    expect(hasBox(widget('a'))).toBe(true)
  })

  it('erkennt eine unvollstaendige oder fehlende Box als keine Box', () => {
    expect(hasBox(widget('a', { y: null }))).toBe(false)
    expect(hasBox({ id: 'a' })).toBe(false)
    expect(hasBox(null)).toBe(false)
  })
})

describe('readPageSettings / writePageSettings - die Seiteneigenschaften (E1, E2, E17, E19)', () => {
  it('liefert fuer eine unberuehrte Seite die Vorgaben', () => {
    const settings = readPageSettings(page([widget('a')]))
    expect(settings.mode).toBe(LAYOUT_PIXEL)
    expect(settings.breakpoints).toEqual(DEFAULT_BREAKPOINTS)
    expect(settings.grid).toBeGreaterThan(0)
    expect(settings.skin).toBeNull()
  })

  it('kennt genau zwei Modi', () => {
    expect(LAYOUT_MODES).toEqual([LAYOUT_PIXEL, LAYOUT_RESPONSIVE])
  })

  it('schreibt die Einstellungen in die SEITE, nicht in ihre Widgets', () => {
    const next = writePageSettings(page([widget('a'), widget('b')]), {
      mode: LAYOUT_RESPONSIVE,
      breakpoints: [480, 768],
      grid: 20,
      skin: 'ionic',
    })
    expect(next.layout_mode).toBe(LAYOUT_RESPONSIVE)
    expect(next.breakpoints).toEqual([480, 768])
    expect(next.grid).toBe(20)
    expect(next.skin).toBe('ionic')
    for (const w of next.widgets) expect(w.config.editor_page).toBeUndefined()
  })

  it('liest zurueck, was es geschrieben hat', () => {
    const next = writePageSettings(page([widget('a'), widget('b')]), {
      mode: LAYOUT_RESPONSIVE,
      breakpoints: [480, 768],
      grid: 20,
      skin: 'ionic',
    })
    expect(readPageSettings(next)).toEqual({
      mode: LAYOUT_RESPONSIVE,
      breakpoints: [480, 768],
      grid: 20,
      skin: 'ionic',
    })
  })

  it('laesst auch einer responsiven Seite jede Koordinate stehen (R17)', () => {
    // Die Korrektur aus Runde 3. Die Zahlen wegzunehmen setzte §1.1 durch und
    // brach R17: V1 liest dieselbe Seite mit `x: number`. Jetzt entscheidet der
    // MODUS, ob eine Koordinate wirkt - und der steht daneben in der Seite.
    const next = writePageSettings(page([widget('a', { x: 40, y: 60 }), widget('b')]), {
      mode: LAYOUT_RESPONSIVE,
    })
    expect(next.layout_mode).toBe(LAYOUT_RESPONSIVE)
    expect(next.widgets[0]).toMatchObject({ x: 40, y: 60, w: 3, h: 2 })
    expect(next.widgets[1]).toMatchObject({ x: 0, y: 0, w: 3, h: 2 })
  })

  it('macht den Hin- und Rueckweg verlustfrei - es gibt nichts zu erfinden', () => {
    const original = page([widget('a', { x: 40, y: 60 })])
    const responsiv = writePageSettings(original, { mode: LAYOUT_RESPONSIVE })
    const zurueck = writePageSettings(responsiv, { mode: LAYOUT_PIXEL })
    expect(zurueck.widgets[0]).toMatchObject({ x: 40, y: 60, w: 3, h: 2 })
  })

  it('laesst einer Pixel-Seite jede Koordinate', () => {
    const next = writePageSettings(page([widget('a', { x: 40, y: 60 })]), { mode: LAYOUT_PIXEL })
    expect(next.widgets[0]).toMatchObject({ x: 40, y: 60, w: 3, h: 2 })
  })

  it('weist einen unbekannten Modus ab, statt ihn zu speichern', () => {
    const next = writePageSettings(page([widget('a')]), { mode: 'zauberei' })
    expect(readPageSettings(next).mode).toBe(LAYOUT_PIXEL)
  })

  it('haelt die Rasterweite bei mindestens 1', () => {
    expect(readPageSettings(writePageSettings(page([widget('a')]), { grid: 0 })).grid).toBe(1)
    expect(readPageSettings(writePageSettings(page([widget('a')]), { grid: -8 })).grid).toBe(1)
  })

  it('normalisiert die Breakpoints wie das Backend', () => {
    const next = writePageSettings(page([]), { breakpoints: [900, 360, 900, 0] })
    expect(next.breakpoints).toEqual([360, 900])
  })

  it('macht aus einem leeren Skin keine Wahl', () => {
    expect(readPageSettings({ skin: '   ' }).skin).toBeNull()
    expect(readPageSettings({ skin: 'ionic' }).skin).toBe('ionic')
  })

  it('laesst die Seite unveraendert und gibt eine neue zurueck', () => {
    const cfg = page([widget('a')])
    const next = writePageSettings(cfg, { grid: 20 })
    expect(next).not.toBe(cfg)
    expect(cfg.grid).toBeUndefined()
  })

  it('vertraegt eine Seite ganz OHNE Widgets - der Grund fuer den Umzug', () => {
    expect(readPageSettings(page([])).mode).toBe(LAYOUT_PIXEL)
    const leer = writePageSettings(page([]), { grid: 37, breakpoints: [333, 666] })
    expect(leer.widgets).toEqual([])
    expect(readPageSettings(leer).grid).toBe(37)
    expect(readPageSettings(leer).breakpoints).toEqual([333, 666])
    expect(readPageSettings(null).mode).toBe(LAYOUT_PIXEL)
  })

  it('liest eine Bestandsseite ohne die neuen Felder als Vorgaben', () => {
    expect(readPageSettings({ grid_cols: 12, widgets: [] })).toEqual({
      mode: LAYOUT_PIXEL,
      grid: 8,
      breakpoints: DEFAULT_BREAKPOINTS,
      skin: null,
    })
  })
})

describe('sameSettings - was „Gespeichert" belegt', () => {
  it('erkennt zwei gleiche Saetze', () => {
    const a = { mode: LAYOUT_PIXEL, grid: 8, breakpoints: [480], skin: null }
    expect(sameSettings(a, { ...a, breakpoints: [480] })).toBe(true)
  })

  it('erkennt jeden Unterschied - Modus, Raster, Breakpoints, Skin', () => {
    const a = { mode: LAYOUT_PIXEL, grid: 8, breakpoints: [480], skin: null }
    expect(sameSettings(a, { ...a, mode: LAYOUT_RESPONSIVE })).toBe(false)
    expect(sameSettings(a, { ...a, grid: 20 })).toBe(false)
    expect(sameSettings(a, { ...a, breakpoints: [480, 768] })).toBe(false)
    expect(sameSettings(a, { ...a, breakpoints: [360] })).toBe(false)
    expect(sameSettings(a, { ...a, skin: 'ionic' })).toBe(false)
  })
})

describe('parseBreakpoints / formatBreakpoints (E17)', () => {
  it('liest eine Komma-Liste', () => {
    expect(parseBreakpoints('480, 768, 1024')).toEqual([480, 768, 1024])
  })

  it('vertraegt Leerzeichen, Semikola und leere Glieder', () => {
    expect(parseBreakpoints(' 480 ;768 , ,1024 ')).toEqual([480, 768, 1024])
  })

  it('wirft weg, was keine positive Zahl ist, und entdoppelt', () => {
    expect(parseBreakpoints('480, abc, -3, 0, 480, 768')).toEqual([480, 768])
  })

  it('sortiert aufsteigend, damit die Vorschau-Auswahl eine Ordnung hat', () => {
    expect(parseBreakpoints('1024,480,768')).toEqual([480, 768, 1024])
  })

  it('macht aus Unsinn eine leere Liste', () => {
    expect(parseBreakpoints('')).toEqual([])
    expect(parseBreakpoints(null)).toEqual([])
  })

  it('schreibt die Liste so, wie der Autor sie eingegeben hat', () => {
    expect(formatBreakpoints([480, 768, 1024])).toBe('480, 768, 1024')
    expect(formatBreakpoints([])).toBe('')
    expect(formatBreakpoints(null)).toBe('')
  })

  it('ist mit sich selbst vertraeglich (der Reload-Weg aus E17)', () => {
    expect(formatBreakpoints(parseBreakpoints('360, 900'))).toBe('360, 900')
  })
})

describe('renderedMode - der Editor zeigt JE SKIN, welcher Modus gerendert wird', () => {
  it('weiss, welcher Skin die Autoren-Box honoriert', () => {
    expect(skinHonorsPosition('edomi')).toBe(true)
    expect(skinHonorsPosition('ionic')).toBe(false)
    expect(skinHonorsPosition('terminal')).toBe(false)
  })

  it('nimmt ohne Skin-Wahl die Vorgabe', () => {
    expect(DEFAULT_SKIN).toBe('edomi')
    expect(skinHonorsPosition(null)).toBe(true)
  })

  it('rendert eine Pixel-Seite unter einem positionierenden Skin als Pixel', () => {
    expect(renderedMode(LAYOUT_PIXEL, 'edomi')).toBe(LAYOUT_PIXEL)
  })

  it('rendert eine Pixel-Seite unter einem responsiven Skin trotzdem responsiv', () => {
    // Die Richtung der Invariante: der SKIN entscheidet, was er honoriert - nicht
    // der Modus, welcher Skin genommen wird (so stand es in Runde 1, und es
    // kollidierte mit E19: Skin je Seite waehlbar).
    expect(renderedMode(LAYOUT_PIXEL, 'ionic')).toBe(LAYOUT_RESPONSIVE)
  })

  it('rendert eine responsive Seite immer responsiv - sie traegt ja nichts anderes', () => {
    expect(renderedMode(LAYOUT_RESPONSIVE, 'edomi')).toBe(LAYOUT_RESPONSIVE)
    expect(renderedMode(LAYOUT_RESPONSIVE, 'ionic')).toBe(LAYOUT_RESPONSIVE)
  })
})

describe('toPreviewDraft - was die Vorschau zu sehen bekommt (E2, E8, E19)', () => {
  const base = { pageId: 'p1', name: 'Seite', kind: 'normal' }

  it('traegt die Backend-Form und den Skin DER SEITE', () => {
    const draft = toPreviewDraft({ ...base, pageConfig: page([widget('a')]) })
    expect(draft.pageId).toBe('p1')
    expect(draft.skin).toBe(DEFAULT_SKIN)
    expect(draft.nodes).toHaveLength(1)
    expect(draft.nodes[0]).toMatchObject({ id: 'p1', parent_id: null, type: 'PAGE', kind: 'normal' })
  })

  it('nimmt den Skin der Seite, nicht einen aus dem Modus abgeleiteten', () => {
    const cfg = writePageSettings(page([widget('a')]), { mode: LAYOUT_RESPONSIVE, skin: 'terminal' })
    expect(toPreviewDraft({ ...base, pageConfig: cfg }).skin).toBe('terminal')
    const pixel = writePageSettings(page([widget('a')]), { mode: LAYOUT_PIXEL, skin: 'ionic' })
    expect(toPreviewDraft({ ...base, pageConfig: pixel }).skin).toBe('ionic')
  })

  it('reicht im Pixel-Modus die Koordinaten durch', () => {
    const draft = toPreviewDraft({
      ...base,
      pageConfig: page([widget('a', { x: 40, y: 60, w: 3, h: 2 })]),
    })
    expect(draft.nodes[0].page_config.widgets[0]).toMatchObject({ x: 40, y: 60, w: 3, h: 2 })
  })

  it('reicht auch im responsiven Modus die Koordinaten durch - samt Modus', () => {
    // Der Entwurf traegt die BACKEND-Form, und die Vorschau bildet ihn mit
    // denselben Funktionen ab wie die echte Visu (`mapTree`/`composeLayers`).
    // Die dortige Regel liest `layout_mode`; der Entwurf muss ihn also
    // mitbringen, statt vorher selbst zu loeschen - sonst zeigte die Vorschau
    // ein Bild, das der gespeicherte Stand nicht haette.
    const cfg = writePageSettings(page([widget('a', { x: 40, y: 60 })]), {
      mode: LAYOUT_RESPONSIVE,
    })
    const node = toPreviewDraft({ ...base, pageConfig: cfg }).nodes[0]
    expect(node.page_config.layout_mode).toBe(LAYOUT_RESPONSIVE)
    expect(node.page_config.widgets[0]).toMatchObject({ id: 'a', x: 40, y: 60, w: 3, h: 2 })
  })

  it('ist reine Daten - strukturiert klonbar, sonst kommt er nie an', () => {
    // Der `DataCloneError` aus Runde 2: die Bruecke schickt den Entwurf per
    // `postMessage`, und der Structured-Clone-Algorithmus lehnt einen Vue-Proxy
    // ab. Bis hierher hing dieser Fix allein an der manuellen E2E-Bahn.
    const cfg = writePageSettings(page([widget('a')]), { mode: LAYOUT_PIXEL })
    const draft = toPreviewDraft({
      ...base,
      pageConfig: reactive(cfg),
      layers: [reactive({ id: 'g1', name: 'Kopf', kind: 'globalInclude', page_config: page([widget('gw')]) })],
    })
    expect(() => structuredClone(draft)).not.toThrow()
  })

  it('haelt die Reihenfolge der Widgets - sie ist der Boden', () => {
    const cfg = writePageSettings(page([widget('a'), widget('b'), widget('c')]), {
      mode: LAYOUT_RESPONSIVE,
    })
    expect(
      toPreviewDraft({ ...base, pageConfig: cfg }).nodes[0].page_config.widgets.map((w) => w.id),
    ).toEqual(['a', 'b', 'c'])
  })

  it('laesst ein ausgeblendetes Widget aus dem Entwurf heraus (E8)', () => {
    const cfg = page([widget('a'), withWidgetFlags(widget('b'), { hidden: true }), widget('c')])
    const ids = toPreviewDraft({ ...base, pageConfig: cfg }).nodes[0].page_config.widgets.map(
      (w) => w.id,
    )
    expect(ids).toEqual(['a', 'c'])
  })

  it('laesst ein GESPERRTES Widget sehr wohl im Entwurf', () => {
    const cfg = page([withWidgetFlags(widget('a'), { locked: true })])
    expect(toPreviewDraft({ ...base, pageConfig: cfg }).nodes[0].page_config.widgets).toHaveLength(1)
  })

  it('gibt ohne Seite gar keinen Entwurf zurueck', () => {
    expect(toPreviewDraft({ ...base, pageId: null, pageConfig: page([]) })).toBeNull()
    expect(toPreviewDraft({ ...base, pageConfig: null })).toBeNull()
  })
})

describe('toPreviewDraft - Layer-Sichtbarkeit (§3, C2-Zeile)', () => {
  const base = { pageId: 'p1', name: 'Seite', kind: 'normal' }
  const layers = [
    { id: 'g1', name: 'Kopfzeile', kind: 'globalInclude', page_config: page([widget('gw')]) },
    { id: 'i1', name: 'Fusszeile', kind: 'normal', page_config: page([widget('iw')]) },
  ]

  it('stellt jeden sichtbaren Layer als eigenen Knoten in den Entwurf', () => {
    const draft = toPreviewDraft({ ...base, pageConfig: page([widget('a')]), layers })
    expect(draft.nodes.map((n) => n.id)).toEqual(['p1', 'g1', 'i1'])
    expect(draft.nodes[1].kind).toBe('globalInclude')
  })

  it('nimmt den globalen Boden ueber die BESTEHENDE Regel weg (R13)', () => {
    const draft = toPreviewDraft({
      ...base,
      pageConfig: page([widget('a')]),
      layers,
      showGlobalLayer: false,
    })
    expect(draft.nodes.map((n) => n.id)).toEqual(['p1', 'i1'])
    expect(draft.nodes[0].page_config.ignore_global_includes).toBe(true)
  })

  it('nimmt die individuellen Inkludeseiten ueber eine leere Liste weg (R14)', () => {
    const cfg = { ...page([widget('a')]), includes: ['i1'] }
    const draft = toPreviewDraft({ ...base, pageConfig: cfg, layers, showIncludeLayer: false })
    expect(draft.nodes.map((n) => n.id)).toEqual(['p1', 'g1'])
    expect(draft.nodes[0].page_config.includes).toEqual([])
  })

  it('laesst die Include-Liste stehen, solange der Layer sichtbar ist', () => {
    const cfg = { ...page([widget('a')]), includes: ['i1'] }
    const draft = toPreviewDraft({ ...base, pageConfig: cfg, layers })
    expect(draft.nodes[0].page_config.includes).toEqual(['i1'])
    expect(draft.nodes[0].page_config.ignore_global_includes).toBe(false)
  })

  it('vertraegt eine Seite ohne Layer', () => {
    const draft = toPreviewDraft({ ...base, pageConfig: page([widget('a')]) })
    expect(draft.nodes).toHaveLength(1)
  })
})
