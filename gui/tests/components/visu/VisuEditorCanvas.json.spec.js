import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * Die JSON-Dualitaet des V2-Editors (M5 C6, Issue #173, Messlatte E13).
 *
 * „Seite als JSON/Text UND visuell editierbar, beide Ansichten synchron" - und
 * zwar in BEIDE Richtungen. Die Playwright-Haelfte ist E13; hier steht dieselbe
 * Behauptung als Einzelfrage, dazu der Fehlerpfad, den ein Browser-Szenario
 * nicht sauber herstellt: ungueltiges JSON wird ABGEFANGEN statt gespeichert.
 *
 * WARUM DIE TEXTANSICHT IM CANVAS WOHNT und nicht daneben: sie ist kein zweiter
 * Schreiber, sondern eine zweite ANSICHT auf denselben Entwurf. Auf
 * `page_config` schreiben im Editor schon zwei Stellen unabhaengig voneinander
 * (Micsi/openbridgeserver#187); eine dritte, die selbst speichert, waere die
 * naechste Stelle mit „der letzte gewinnt". Deshalb pinnt diese Datei
 * ausdruecklich, dass Tippen in der Textansicht NIE ein `savePage` ausloest -
 * gespeichert wird ueber denselben einen Knopf wie zuvor.
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

const widget = (id, x, y) => ({
  id,
  name: `Kachel ${id}`,
  type: 'Toggle',
  datapoint_id: `dp-${id}`,
  status_datapoint_id: null,
  x,
  y,
  w: 3,
  h: 2,
  config: {},
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

/** Die Normalisierung des Backends, nachgezogen (wie in `VisuEditorCanvas.spec.js`). */
function normalizeOnServer(config) {
  const next = JSON.parse(JSON.stringify(config ?? {}))
  next.layout_mode = ['pixel', 'responsive'].includes(next.layout_mode) ? next.layout_mode : 'pixel'
  next.grid = Math.max(1, Math.round(Number(next.grid ?? 8)) || 1)
  next.breakpoints = [...new Set((next.breakpoints ?? [480, 768, 1024]).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  )
  next.skin = (typeof next.skin === 'string' ? next.skin.trim() : '') || null
  next.widgets = (next.widgets ?? []).map((w) => {
    const copy = { ...w }
    for (const key of ['x', 'y', 'w', 'h']) {
      copy[key] = typeof copy[key] === 'number' ? copy[key] : BOX_DEFAULTS[key]
    }
    return copy
  })
  return next
}

const server = { config: null }

async function mountCanvas(widgets = [widget('a', 10, 10), widget('b', 40, 10)]) {
  server.config = normalizeOnServer(pageConfig(widgets))
  getNode.mockImplementation(async (id) => ({ data: { id, name: 'M5 Solo', kind: 'normal' } }))
  getPage.mockImplementation(async () => ({ data: JSON.parse(JSON.stringify(server.config)) }))
  savePage.mockImplementation(async (_id, config) => {
    server.config = normalizeOnServer(config)
    return { status: 204 }
  })
  getTree.mockImplementation(async () => ({ data: [] }))
  const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
  const wrapper = mount(VisuEditorCanvas, { props: { pageId: 'p1' }, attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return wrapper
}

const els = (w) => w.findAll('.editor-canvas [data-el]')
const boxOf = (w, id) => {
  const el = els(w).find((e) => e.attributes('data-el') === id)
  return { x: Number(el.attributes('data-x')), y: Number(el.attributes('data-y')) }
}
const tab = (w, name) => w.findAll('[role="tab"]').find((t) => t.text().trim() === name) ?? null
const json = (w) => w.find('.editor-json')
const byButton = (w, text) => w.findAll('button').find((b) => b.text().includes(text)) ?? null

async function pick(el) {
  el.element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
  )
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
  await flushPromises()
}

async function nudgeRight(wrapper, id) {
  await pick(els(wrapper).find((e) => e.attributes('data-el') === id))
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await flushPromises()
}

/** Eine Taste am Fenster, so wie der Browser sie schickt (fuer Strg+Z/Y). */
async function press(key, modifiers = {}) {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }))
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('VisuEditorCanvas - JSON-Dualitaet (E13)', () => {
  it('steht zuerst auf der visuellen Ansicht', async () => {
    const wrapper = await mountCanvas()

    expect(wrapper.find('.editor-canvas').exists()).toBe(true)
    expect(json(wrapper).exists()).toBe(false)
    expect(tab(wrapper, 'Visuell').attributes('aria-selected')).toBe('true')
    expect(tab(wrapper, 'JSON').attributes('aria-selected')).toBe('false')
  })

  it('bietet beide Ansichten als Reiter an - mit den Namen, die der Harness sucht', async () => {
    const wrapper = await mountCanvas()

    expect(tab(wrapper, 'Visuell')).not.toBeNull()
    expect(tab(wrapper, 'JSON')).not.toBeNull()
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
  })

  /* ------------------------------------------------------- visuell → Text */

  it('zeigt die Seite als JSON, sobald der Reiter gewaehlt ist', async () => {
    const wrapper = await mountCanvas()

    await tab(wrapper, 'JSON').trigger('click')

    const doc = JSON.parse(json(wrapper).element.value)
    expect(doc.widgets.map((w) => w.id)).toEqual(['a', 'b'])
    expect(doc.widgets[0].x).toBe(10)
  })

  it('traegt eine Verschiebung sofort in den Text - ohne Speichern', async () => {
    const wrapper = await mountCanvas()

    await nudgeRight(wrapper, 'a')
    await tab(wrapper, 'JSON').trigger('click')

    expect(JSON.parse(json(wrapper).element.value).widgets[0].x).toBe(11)
    expect(savePage).not.toHaveBeenCalled()
  })

  it('zieht den Text auch nach, waehrend er offen steht', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    const vorher = JSON.parse(json(wrapper).element.value).widgets[0].x

    await tab(wrapper, 'Visuell').trigger('click')
    await nudgeRight(wrapper, 'a')
    await tab(wrapper, 'JSON').trigger('click')

    expect(JSON.parse(json(wrapper).element.value).widgets[0].x).toBe(vorher + 1)
  })

  /* ------------------------------------------------------- Text → visuell */

  it('schlaegt eine Aenderung im Text auf den Canvas durch', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    const doc = JSON.parse(json(wrapper).element.value)
    doc.widgets[0].x = 77

    await json(wrapper).setValue(JSON.stringify(doc))
    await tab(wrapper, 'Visuell').trigger('click')

    expect(boxOf(wrapper, 'a').x).toBe(77)
  })

  /**
   * #189.3 - eine Uebernahme aus der Textansicht zeichnete bisher NICHT auf
   * den Undo-Stapel von C5 auf (kein Datenverlust: der aktuelle Stand landet
   * beim naechsten Undo einfach auf der Redo-Seite - aber inkonsistent, denn
   * jede andere Aenderung im Editor IST ein Schritt). Strg+Z nach einer reinen
   * JSON-Bearbeitung tat deshalb nichts.
   */
  it('legt eine Uebernahme aus dem Text als eigenen Undo-Schritt ab (#189.3)', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    const doc = JSON.parse(json(wrapper).element.value)
    doc.widgets[0].x = 77

    await json(wrapper).setValue(JSON.stringify(doc))
    await tab(wrapper, 'Visuell').trigger('click')
    expect(boxOf(wrapper, 'a').x).toBe(77)

    await press('z', { ctrlKey: true })

    expect(boxOf(wrapper, 'a').x).toBe(10)
  })

  it('nimmt auch eine neue Kachel aus dem Text an', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    const doc = JSON.parse(json(wrapper).element.value)
    doc.widgets.push(widget('c', 90, 90))

    await json(wrapper).setValue(JSON.stringify(doc))
    await tab(wrapper, 'Visuell').trigger('click')

    expect(els(wrapper).map((e) => e.attributes('data-el'))).toEqual(['a', 'b', 'c'])
  })

  it('uebernimmt auch Seiteneigenschaften aus dem Text', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    const doc = JSON.parse(json(wrapper).element.value)
    doc.grid = 24

    await json(wrapper).setValue(JSON.stringify(doc))
    await tab(wrapper, 'Visuell').trigger('click')

    const grid = wrapper.find('#editor-canvas-grid')
    expect(grid.element.value).toBe('24')
  })

  /* ------------------------------------------------------------- Ablehnung */

  it('faengt ungueltiges JSON ab, statt es zu uebernehmen', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')

    await json(wrapper).setValue('{ "widgets": [')
    await tab(wrapper, 'Visuell').trigger('click')

    expect(boxOf(wrapper, 'a').x).toBe(10)
  })

  it('sagt es, wenn der Text nicht lesbar ist', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')

    await json(wrapper).setValue('{ "widgets": [')

    expect(wrapper.find('[data-testid="editor-json-error"]').exists()).toBe(true)
  })

  it('lehnt ein Dokument ohne Widget-Liste ab', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')

    await json(wrapper).setValue('{"grid": 8}')
    await tab(wrapper, 'Visuell').trigger('click')

    expect(wrapper.find('[data-testid="editor-json-error"]').exists()).toBe(true)
    expect(els(wrapper)).toHaveLength(2)
  })

  it('nimmt die Meldung zurueck, sobald der Text wieder stimmt', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    await json(wrapper).setValue('{ kaputt')
    expect(wrapper.find('[data-testid="editor-json-error"]').exists()).toBe(true)

    const doc = pageConfig([widget('a', 55, 10), widget('b', 40, 10)])
    await json(wrapper).setValue(JSON.stringify(doc))
    await tab(wrapper, 'Visuell').trigger('click')

    expect(wrapper.find('[data-testid="editor-json-error"]').exists()).toBe(false)
    expect(boxOf(wrapper, 'a').x).toBe(55)
  })

  /* ------------------------------------------- kein dritter Schreiber (#187) */

  it('speichert beim Tippen NICHTS - die Textansicht ist kein Schreiber', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    const doc = JSON.parse(json(wrapper).element.value)
    doc.widgets[0].x = 77

    await json(wrapper).setValue(JSON.stringify(doc))
    await flushPromises()

    expect(savePage).not.toHaveBeenCalled()
  })

  it('schreibt eine Text-Aenderung ueber DENSELBEN Speichern-Knopf wie der Canvas', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    const doc = JSON.parse(json(wrapper).element.value)
    doc.widgets[0].x = 77
    await json(wrapper).setValue(JSON.stringify(doc))

    await byButton(wrapper, 'Speichern').trigger('click')
    await flushPromises()

    expect(savePage).toHaveBeenCalledTimes(1)
    expect(server.config.widgets[0].x).toBe(77)
    expect(wrapper.find('[data-testid="editor-canvas-saved"]').exists()).toBe(true)
  })

  /* --------------------------------------- die Quittung als echte Schranke */

  /**
   * „Gespeichert" heisst seit Runde 1 des Canvas: der Server TRAEGT es. Mit
   * Teil C6 heisst es zusaetzlich: der Editor ZEIGT es - auch im Verlauf (E12).
   * Deshalb wartet die Quittung auf `afterSave`. Ohne diese Reihenfolge zeigte
   * ein Blick in den Verlauf unmittelbar nach dem Speichern die Liste von vor
   * dem Speichern.
   */
  it('wartet mit der Quittung, bis das Nachziehen fertig ist', async () => {
    const reihenfolge = []
    let freigeben
    const nachziehen = vi.fn(
      () =>
        new Promise((resolve) => {
          reihenfolge.push('nachziehen')
          freigeben = resolve
        }),
    )
    server.config = normalizeOnServer(pageConfig([widget('a', 10, 10)]))
    getNode.mockImplementation(async (id) => ({ data: { id, name: 'M5 Solo', kind: 'normal' } }))
    getPage.mockImplementation(async () => ({ data: JSON.parse(JSON.stringify(server.config)) }))
    savePage.mockImplementation(async (_id, config) => {
      server.config = normalizeOnServer(config)
      return { status: 204 }
    })
    getTree.mockImplementation(async () => ({ data: [] }))
    const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
    const wrapper = mount(VisuEditorCanvas, {
      props: { pageId: 'p1', afterSave: nachziehen },
      attachTo: document.body,
    })
    await flushPromises()

    byButton(wrapper, 'Speichern').trigger('click')
    await flushPromises()
    expect(nachziehen).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="editor-canvas-saved"]').exists()).toBe(false)

    freigeben()
    await flushPromises()
    expect(wrapper.find('[data-testid="editor-canvas-saved"]').exists()).toBe(true)
  })

  it('zieht nach einem GESCHEITERTEN Speichern nichts nach', async () => {
    const nachziehen = vi.fn()
    server.config = normalizeOnServer(pageConfig([widget('a', 10, 10)]))
    getNode.mockImplementation(async (id) => ({ data: { id, name: 'M5 Solo', kind: 'normal' } }))
    getPage.mockImplementation(async () => ({ data: JSON.parse(JSON.stringify(server.config)) }))
    savePage.mockRejectedValue(new Error('403'))
    getTree.mockImplementation(async () => ({ data: [] }))
    const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
    const wrapper = mount(VisuEditorCanvas, {
      props: { pageId: 'p1', afterSave: nachziehen },
      attachTo: document.body,
    })
    await flushPromises()

    await byButton(wrapper, 'Speichern').trigger('click')
    await flushPromises()

    expect(nachziehen).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="editor-canvas-saved"]').exists()).toBe(false)
  })

  /**
   * Solange der Text nicht lesbar ist, wird gar nicht gespeichert - und der
   * Knopf sagt das auch. Ein „Speichern", das waehrend eines halb getippten
   * Dokuments klaglos den Stand VOR der Bearbeitung wegschreibt, waere die
   * unangenehmste Sorte Erfolgsmeldung: sie stimmt und meint etwas anderes.
   */
  it('speichert gar nicht, solange der Text ungueltig ist', async () => {
    const wrapper = await mountCanvas()
    await tab(wrapper, 'JSON').trigger('click')
    await json(wrapper).setValue('{ "widgets": [')

    expect(byButton(wrapper, 'Speichern').attributes('disabled')).toBeDefined()
    await byButton(wrapper, 'Speichern').trigger('click')
    await flushPromises()

    expect(savePage).not.toHaveBeenCalled()
    expect(server.config.widgets[0].x).toBe(10)
  })
})
