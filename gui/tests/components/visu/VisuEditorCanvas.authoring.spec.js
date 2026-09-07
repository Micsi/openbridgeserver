import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * Der SCHREIBWEG des Autorenteils (Nachzug M5 C3, Issue #170).
 *
 * Der Fund, gegen den diese Datei angetreten ist: Name, Datenpunkt-Bindung,
 * Sichtbarkeitsregel und ein frisch aus der Palette gelegtes Element erreichten
 * nur den ENTWURF. „Speichern" im Canvas schrieb Seiteneigenschaften und Boxen
 * und quittierte trotzdem „Gespeichert" - `GET /visu/pages/<id>` danach war
 * byteweise der alte Stand. Ein falscher Erfolg also, dieselbe Fehlerklasse, an
 * der C2 (Runde 1) und C6 (Runde 2) gescheitert sind.
 *
 * Zwei Aussagen stehen hier, und beide sind ohne Browser entscheidbar:
 *
 *  1. **Der Schreibweg.** Was der Autorenteil setzt, steht in der Nutzlast des
 *     EINEN Speicherwegs (des Canvas) und ueberlebt ein Neuladen. Ein zweiter
 *     Schreiber auf `page_config` entsteht dabei nicht (#187) - der Canvas
 *     schreibt mit, er bekommt keinen Nachbarn.
 *  2. **Die Schranke.** Die Quittung erscheint erst, wenn der zurueckgelesene
 *     Stand die Aenderung WIRKLICH traegt - Boxen UND Widget-Konfiguration.
 *
 * Der „Server" ist wie in `VisuEditorCanvas.spec.js` ein Stand und kein Stumpf:
 * `getPage` liefert, was `savePage` zuletzt abgelegt hat, mit den
 * Normalisierungen des echten Backends (`obs/models/visu.py`).
 */

const getPage = vi.fn()
const getNode = vi.fn()
const savePage = vi.fn()
const getTree = vi.fn()

vi.mock('@/api/visu', () => ({
  visuApi: {
    getPage: (...args) => getPage(...args),
    getNode: (...args) => getNode(...args),
    savePage: (...args) => savePage(...args),
    getTree: (...args) => getTree(...args),
  },
}))

const BOX_DEFAULTS = { x: 0, y: 0, w: 2, h: 2 }

const widget = (id, extra = {}) => ({
  id,
  name: `Kachel ${id}`,
  type: 'Toggle',
  datapoint_id: null,
  status_datapoint_id: null,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  config: {},
  ...extra,
})

function pageConfig(widgets) {
  return {
    grid_cols: 12,
    grid_row_height: 80,
    grid_cell_width: 80,
    background: null,
    widgets,
    includes: [],
    ignore_global_includes: false,
    popup: null,
  }
}

/** Die Normalisierung des Backends, nachgezogen (siehe `VisuEditorCanvas.spec.js`). */
function normalizeOnServer(config) {
  const next = JSON.parse(JSON.stringify(config ?? {}))
  next.layout_mode = ['pixel', 'responsive'].includes(next.layout_mode) ? next.layout_mode : 'pixel'
  next.grid = Math.max(1, Math.round(Number(next.grid ?? 8)) || 1)
  next.breakpoints = [...new Set((next.breakpoints ?? [480, 768, 1024]).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  )
  next.skin = (typeof next.skin === 'string' ? next.skin.trim() : '') || null
  next.widgets = (next.widgets ?? []).map((w) => {
    // Das Backend-Modell traegt genau diese Felder; alles andere faellt weg.
    const copy = {
      id: w.id,
      name: typeof w.name === 'string' ? w.name : '',
      type: w.type,
      datapoint_id: w.datapoint_id ?? null,
      status_datapoint_id: w.status_datapoint_id ?? null,
      config: w.config ?? {},
    }
    for (const key of ['x', 'y', 'w', 'h']) {
      copy[key] = typeof w[key] === 'number' ? w[key] : BOX_DEFAULTS[key]
    }
    return copy
  })
  return next
}

const server = { config: null }

function wireServer() {
  getNode.mockImplementation(async (id) => ({ data: { id, name: 'M5 Home', kind: 'normal' } }))
  getPage.mockImplementation(async () => ({ data: JSON.parse(JSON.stringify(server.config)) }))
  savePage.mockImplementation(async (id, config) => {
    server.config = normalizeOnServer(config)
    return { status: 204 }
  })
  getTree.mockImplementation(async () => ({ data: [] }))
}

async function mountAgainstServer(authoredWidgets = null) {
  const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
  const wrapper = mount(VisuEditorCanvas, {
    props: { pageId: 'p1', authoredWidgets },
    attachTo: document.body,
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

async function mountCanvas(widgets, authoredWidgets = null) {
  server.config = normalizeOnServer(pageConfig(widgets))
  wireServer()
  return mountAgainstServer(authoredWidgets)
}

function byButton(wrapper, text) {
  return wrapper.findAll('button').find((b) => b.text().includes(text)) ?? null
}

async function speichern(wrapper) {
  await byButton(wrapper, 'Speichern').trigger('click')
  await flushPromises()
  await flushPromises()
}

const quittung = (w) => w.find('[data-testid="editor-canvas-saved"]').exists()
const fehler = (w) => w.find('[data-testid="editor-canvas-error"]').exists()
/** Die zuletzt abgeschickte Nutzlast. */
const nutzlast = () => savePage.mock.calls[savePage.mock.calls.length - 1][1]

beforeEach(() => {
  vi.resetModules()
  getPage.mockReset()
  getNode.mockReset()
  savePage.mockReset()
  getTree.mockReset()
  server.config = null
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Der Autorenteil hat einen Schreibweg - und es ist der des Canvas', () => {
  it('schreibt einen NAMEN aus dem Bindungsformular mit und ueberlebt ein Neuladen', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({ authoredWidgets: [widget('a', { name: 'M5 Gamma Umbenannt' })] })
    await flushPromises()

    await speichern(w)

    expect(nutzlast().widgets[0].name).toBe('M5 Gamma Umbenannt')
    expect(quittung(w)).toBe(true)
    expect(server.config.widgets[0].name).toBe('M5 Gamma Umbenannt')

    w.unmount()
    const zweiter = await mountAgainstServer()
    expect(zweiter.findAll('.editor-canvas [data-el]')[0].text()).toContain('M5 Gamma Umbenannt')
  })

  it('schreibt die DATENPUNKT-BINDUNG mit, an der Wurzel wie in der Konfig', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({
      authoredWidgets: [
        widget('a', { datapoint_id: 'dp-1', config: { dp_dim: 'dp-7', mode: 'dimm' } }),
      ],
    })
    await flushPromises()

    await speichern(w)

    expect(server.config.widgets[0].datapoint_id).toBe('dp-1')
    expect(server.config.widgets[0].config).toMatchObject({ dp_dim: 'dp-7', mode: 'dimm' })
    expect(quittung(w)).toBe(true)
  })

  it('schreibt die SICHTBARKEITSREGEL mit (E16)', async () => {
    const regel = { datapoint_id: 'dp-1', op: 'gt', value: 30 }
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({ authoredWidgets: [widget('a', { config: { visible_when: regel } })] })
    await flushPromises()

    await speichern(w)

    expect(server.config.widgets[0].config.visible_when).toEqual(regel)
    expect(quittung(w)).toBe(true)
  })

  it('schreibt ein NEUES Element aus der Palette mit und zeichnet es sofort', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    const neu = widget('neu', { type: 'ValueDisplay', name: 'Frisch', config: { unit: '°C' } })
    await w.setProps({ authoredWidgets: [widget('a'), neu] })
    await flushPromises()

    expect(w.findAll('.editor-canvas [data-el]').map((e) => e.attributes('data-el'))).toEqual([
      'a',
      'neu',
    ])

    await speichern(w)

    expect(server.config.widgets.map((x) => x.id)).toEqual(['a', 'neu'])
    expect(server.config.widgets[1]).toMatchObject({ type: 'ValueDisplay', name: 'Frisch' })
    expect(quittung(w)).toBe(true)
  })

  it('setzt fuer all das GENAU EINEN Schreibweg ab - kein zweiter Schreiber (#187)', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({
      authoredWidgets: [widget('a', { name: 'Neu', datapoint_id: 'dp-1' }), widget('neu')],
    })
    await flushPromises()

    // Der Entwurf allein schreibt nichts: bis hierher ist keine Anfrage gelaufen.
    expect(savePage).not.toHaveBeenCalled()

    await speichern(w)
    expect(savePage).toHaveBeenCalledTimes(1)
  })

  it('laesst die Autoren-Box beim Mitschreiben dem Canvas, nicht dem Formular', async () => {
    const w = await mountCanvas([widget('a', { x: 40, y: 8 })], [widget('a', { x: 40, y: 8 })])
    // Der Autorenteil haelt die Lage, die beim Oeffnen galt (0/0) - er darf sie
    // nicht zurueckschreiben, sonst spraenge jede Kachel beim Umbenennen.
    await w.setProps({ authoredWidgets: [widget('a', { name: 'Neu', x: 0, y: 0 })] })
    await flushPromises()

    await speichern(w)
    expect(server.config.widgets[0]).toMatchObject({ name: 'Neu', x: 40, y: 8 })
  })
})

describe('Die Quittung ist eine Schranke, keine Dekoration', () => {
  it('meldet KEIN „Gespeichert", wenn der NAME nicht angekommen ist', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({ authoredWidgets: [widget('a', { name: 'Neu' })] })
    await flushPromises()
    savePage.mockImplementation(async (id, config) => {
      const abgelegt = normalizeOnServer(config)
      abgelegt.widgets[0] = { ...abgelegt.widgets[0], name: 'Kachel a' }
      server.config = abgelegt
      return { status: 204 }
    })

    await speichern(w)

    expect(quittung(w)).toBe(false)
    expect(fehler(w)).toBe(true)
  })

  it('meldet KEIN „Gespeichert", wenn die BINDUNG nicht angekommen ist', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({ authoredWidgets: [widget('a', { datapoint_id: 'dp-1' })] })
    await flushPromises()
    savePage.mockImplementation(async (id, config) => {
      const abgelegt = normalizeOnServer(config)
      abgelegt.widgets[0] = { ...abgelegt.widgets[0], datapoint_id: null }
      server.config = abgelegt
      return { status: 204 }
    })

    await speichern(w)

    expect(quittung(w)).toBe(false)
    expect(fehler(w)).toBe(true)
  })

  it('meldet KEIN „Gespeichert", wenn die SICHTBARKEITSREGEL still weggefallen ist', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({
      authoredWidgets: [
        widget('a', { config: { visible_when: { datapoint_id: 'dp-1', op: 'gt', value: 30 } } }),
      ],
    })
    await flushPromises()
    savePage.mockImplementation(async (id, config) => {
      const abgelegt = normalizeOnServer(config)
      abgelegt.widgets[0] = { ...abgelegt.widgets[0], config: {} }
      server.config = abgelegt
      return { status: 204 }
    })

    await speichern(w)

    expect(quittung(w)).toBe(false)
    expect(fehler(w)).toBe(true)
  })

  it('meldet KEIN „Gespeichert", wenn das NEUE Element der Palette nicht angekommen ist', async () => {
    const w = await mountCanvas([widget('a')], [widget('a')])
    await w.setProps({ authoredWidgets: [widget('a'), widget('neu')] })
    await flushPromises()
    savePage.mockImplementation(async (id, config) => {
      const abgelegt = normalizeOnServer(config)
      abgelegt.widgets = abgelegt.widgets.filter((x) => x.id !== 'neu')
      server.config = abgelegt
      return { status: 204 }
    })

    await speichern(w)

    expect(quittung(w)).toBe(false)
    expect(fehler(w)).toBe(true)
  })
})

describe('Die Auswahl im Canvas ist dieselbe wie die des Bindungsformulars', () => {
  it('meldet das angeklickte Element nach oben, damit sein Formular aufgeht', async () => {
    const w = await mountCanvas([widget('a'), widget('b')], [widget('a'), widget('b')])
    const zweites = w.findAll('.editor-canvas [data-el]')[1]
    zweites.element.dispatchEvent(
      new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
    )
    await flushPromises()

    expect(w.emitted('select')?.at(-1)).toEqual(['b'])
  })
})
