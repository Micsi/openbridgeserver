import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BREAKPOINTS,
  LAYOUT_MODES,
  LAYOUT_PIXEL,
  LAYOUT_RESPONSIVE,
  formatBreakpoints,
  parseBreakpoints,
  readPageSettings,
  skinForMode,
  toPreviewDraft,
  widgetFlags,
  withWidgetFlags,
  writePageSettings,
} from '@/utils/visuEditorPage'

/**
 * Das Seitenmodell des Editors (M5 C2, Issue #169) - wo der Modus, die
 * Rasterweite, die Breakpoints und die Marken „gesperrt"/„ausgeblendet" wohnen.
 *
 * DIE NAHT, die diese Datei traegt: das Backend-Modell (`obs/models/visu.py`)
 * hat KEIN Feld fuer Layout-Modus, Rasterweite oder Breakpoints, und pydantic
 * wirft unbekannte Felder einer `PageConfig` beim Speichern still weg (nachgemessen).
 * Der einzige frei formbare, dauerhafte Platz ist `WidgetInstance.config` - dort
 * liegen die Seiteneinstellungen deshalb, auf JEDEM Widget der Seite gespiegelt,
 * damit das Loeschen eines einzelnen Widgets sie nicht mitnimmt. `obs/` gehoert
 * nicht zu Teil C2; die Spiegelung ist die Folge davon und keine Vorliebe.
 *
 * Der Entwurf fuer die Vorschau ist die zweite Haelfte: **im responsiven Modus
 * traegt er gar keine Koordinaten** (Design-Invariante §1.1 - „Pixel ist ein
 * Angebot"), und der Host emittiert dann auch kein `position`
 * (`readPosition` in `apps/visu/src/core/obs/mapping.ts`: eine unvollstaendige
 * Box ist keine Box).
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

describe('readPageSettings / writePageSettings - die Seiteneigenschaften (E1, E2, E17)', () => {
  it('liefert fuer eine unberuehrte Seite die Vorgaben', () => {
    const settings = readPageSettings(page([widget('a')]))
    expect(settings.mode).toBe(LAYOUT_PIXEL)
    expect(settings.breakpoints).toEqual(DEFAULT_BREAKPOINTS)
    expect(settings.grid).toBeGreaterThan(0)
  })

  it('kennt genau zwei Modi', () => {
    expect(LAYOUT_MODES).toEqual([LAYOUT_PIXEL, LAYOUT_RESPONSIVE])
  })

  it('schreibt die Einstellungen auf JEDES Widget der Seite', () => {
    const next = writePageSettings(page([widget('a'), widget('b')]), {
      mode: LAYOUT_RESPONSIVE,
      breakpoints: [480, 768],
      grid: 20,
    })
    for (const w of next.widgets) {
      expect(w.config.editor_page).toEqual({
        mode: LAYOUT_RESPONSIVE,
        breakpoints: [480, 768],
        grid: 20,
      })
    }
  })

  it('liest zurueck, was es geschrieben hat', () => {
    const next = writePageSettings(page([widget('a'), widget('b')]), {
      mode: LAYOUT_RESPONSIVE,
      breakpoints: [480, 768],
      grid: 20,
    })
    expect(readPageSettings(next)).toEqual({
      mode: LAYOUT_RESPONSIVE,
      breakpoints: [480, 768],
      grid: 20,
    })
  })

  it('liest auch dann noch, wenn ein Widget die Spiegelung nicht hat', () => {
    const cfg = page([widget('a'), widget('b')])
    const next = writePageSettings(cfg, { mode: LAYOUT_RESPONSIVE })
    next.widgets[0] = widget('a') // die Spiegelung an EINER Stelle verloren
    expect(readPageSettings(next).mode).toBe(LAYOUT_RESPONSIVE)
  })

  it('weist einen unbekannten Modus ab, statt ihn zu speichern', () => {
    const next = writePageSettings(page([widget('a')]), { mode: 'zauberei' })
    expect(readPageSettings(next).mode).toBe(LAYOUT_PIXEL)
  })

  it('haelt die Rasterweite bei mindestens 1', () => {
    expect(readPageSettings(writePageSettings(page([widget('a')]), { grid: 0 })).grid).toBe(1)
    expect(readPageSettings(writePageSettings(page([widget('a')]), { grid: -8 })).grid).toBe(1)
  })

  it('laesst die Seite unveraendert und gibt eine neue zurueck', () => {
    const cfg = page([widget('a')])
    const next = writePageSettings(cfg, { grid: 20 })
    expect(next).not.toBe(cfg)
    expect(cfg.widgets[0].config.editor_page).toBeUndefined()
  })

  it('vertraegt eine Seite ganz ohne Widgets', () => {
    expect(readPageSettings(page([])).mode).toBe(LAYOUT_PIXEL)
    expect(writePageSettings(page([]), { grid: 20 }).widgets).toEqual([])
    expect(readPageSettings(null).mode).toBe(LAYOUT_PIXEL)
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
    expect(formatBreakpoints(parseBreakpoints('480, 768, 1024'))).toBe('480, 768, 1024')
  })
})

describe('skinForMode - der Editor zeigt, welcher Modus gerendert wird', () => {
  it('waehlt fuer den Pixel-Modus einen Skin, der Positionen honoriert', () => {
    expect(skinForMode(LAYOUT_PIXEL)).toBe('edomi')
  })

  it('waehlt fuer den responsiven Modus einen Skin ohne Koordinaten', () => {
    expect(skinForMode(LAYOUT_RESPONSIVE)).toBe('ionic')
  })

  it('faellt bei Unsinn auf den Pixel-Skin zurueck', () => {
    expect(skinForMode('zauberei')).toBe('edomi')
  })
})

describe('toPreviewDraft - was die Vorschau zu sehen bekommt (E2, E8)', () => {
  const base = { pageId: 'p1', name: 'Seite', kind: 'normal' }

  it('traegt die Backend-Form und den Skin des Modus', () => {
    const draft = toPreviewDraft({ ...base, pageConfig: page([widget('a')]) })
    expect(draft.pageId).toBe('p1')
    expect(draft.skin).toBe('edomi')
    expect(draft.nodes).toHaveLength(1)
    expect(draft.nodes[0]).toMatchObject({ id: 'p1', parent_id: null, type: 'PAGE', kind: 'normal' })
  })

  it('reicht im Pixel-Modus die Koordinaten durch', () => {
    const draft = toPreviewDraft({
      ...base,
      pageConfig: page([widget('a', { x: 40, y: 60, w: 3, h: 2 })]),
    })
    expect(draft.nodes[0].page_config.widgets[0]).toMatchObject({ x: 40, y: 60, w: 3, h: 2 })
  })

  it('laesst im responsiven Modus JEDE Koordinate weg', () => {
    const cfg = writePageSettings(page([widget('a', { x: 40, y: 60 })]), {
      mode: LAYOUT_RESPONSIVE,
    })
    const w = toPreviewDraft({ ...base, pageConfig: cfg }).nodes[0].page_config.widgets[0]
    expect(w.x).toBeUndefined()
    expect(w.y).toBeUndefined()
    expect(w.w).toBeUndefined()
    expect(w.h).toBeUndefined()
    expect(w.id).toBe('a')
  })

  it('haelt die Reihenfolge der Widgets - sie ist der Boden', () => {
    const cfg = writePageSettings(page([widget('a'), widget('b'), widget('c')]), {
      mode: LAYOUT_RESPONSIVE,
    })
    expect(toPreviewDraft({ ...base, pageConfig: cfg }).nodes[0].page_config.widgets.map((w) => w.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('laesst ein ausgeblendetes Widget aus dem Entwurf heraus (E8)', () => {
    const cfg = page([widget('a'), withWidgetFlags(widget('b'), { hidden: true }), widget('c')])
    const ids = toPreviewDraft({ ...base, pageConfig: cfg }).nodes[0].page_config.widgets.map((w) => w.id)
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
