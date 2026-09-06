import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { clearClipboard, readClipboard } from '@/utils/visuEditorClipboard'

/**
 * Die Ergonomie des WYSIWYG-Canvas (M5 C5, Issue #172).
 *
 * Diese Spec ist die Vitest-Haelfte der Abnahme; die andere sind die vier
 * Playwright-Szenarien E5, E6, E7 (`apps/visu/e2e/m5-editor-matrix.spec.ts`) und
 * E14 (`apps/visu/e2e/m5-editor-touch.spec.ts`). Was dort im Browser behauptet
 * wird, steht hier als Einzelfrage an den montierten Canvas:
 *
 *  - E5: der Rahmen trifft die umschlossenen Elemente, die Gruppe wandert als
 *    eine, „Gruppieren" fasst sie zusammen.
 *  - E6: Duplizieren, Kopieren und Einfuegen - auch ueber eine Seitengrenze,
 *    also ueber einen kompletten Neuaufbau des Canvas hinweg.
 *  - E7: eine Pfeiltaste ist genau ein Schritt, Undo stellt exakt wieder her,
 *    Redo hebt es auf.
 *  - E14: derselbe Zug per Finger bewegt und vergroessert um dieselbe Distanz
 *    wie mit der Maus - und das Groesserziehen verschiebt nichts.
 *
 * DER SERVER IST AUCH HIER EIN STAND, KEIN STUMPF (dieselbe Bauart wie in
 * `VisuEditorCanvas.spec.js`): `getPage` liefert, was `savePage` zuletzt abgelegt
 * hat, normalisiert wie das echte Backend.
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

const widget = (id, x, y, extra = {}) => ({
  id,
  name: `Kachel ${id}`,
  type: 'Toggle',
  datapoint_id: `dp-${id}`,
  status_datapoint_id: null,
  x,
  y,
  w: 10,
  h: 10,
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

const BOX_DEFAULTS = { x: 0, y: 0, w: 2, h: 2 }

/** Die Normalisierung des Backends (`obs/models/visu.py`), nachgezogen. */
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

const server = { pages: {}, tree: [] }

function wireServer() {
  getNode.mockImplementation(async (id) => ({ data: { id, name: `Seite ${id}`, kind: 'normal' } }))
  getPage.mockImplementation(async (id) => ({
    data: JSON.parse(JSON.stringify(server.pages[id] ?? pageConfig([]))),
  }))
  savePage.mockImplementation(async (id, config) => {
    server.pages[id] = normalizeOnServer(config)
    return { status: 204 }
  })
  getTree.mockImplementation(async () => ({ data: server.tree }))
}

/** Eine Seite auf dem Server ablegen. */
function seed(pageId, widgets) {
  server.pages[pageId] = normalizeOnServer(pageConfig(widgets))
}

async function mountCanvas(pageId = 'p1') {
  const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
  const wrapper = mount(VisuEditorCanvas, { props: { pageId }, attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return wrapper
}

const els = (w) => w.findAll('.editor-canvas [data-el]')
const ids = (w) => els(w).map((e) => e.attributes('data-el'))
const boxOf = (w, id) => {
  const el = els(w).find((e) => e.attributes('data-el') === id)
  return {
    x: Number(el.attributes('data-x')),
    y: Number(el.attributes('data-y')),
    w: Number(el.attributes('data-w')),
    h: Number(el.attributes('data-h')),
  }
}
const selectedIds = (w) =>
  els(w)
    .filter((e) => e.classes().includes('is-selected'))
    .map((e) => e.attributes('data-el'))

function byButton(wrapper, text) {
  return wrapper.findAll('button').find((b) => b.text() === text) ?? null
}

/** Ein Element waehlen, so wie ein echter Klick es tut (die Wahl haengt am `mousedown`). */
async function pick(wrapper, id, shiftKey = false) {
  const el = els(wrapper).find((e) => e.attributes('data-el') === id)
  el.element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, shiftKey, clientX: 0, clientY: 0 }),
  )
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
  await flushPromises()
}

/** Eine Taste am Fenster, so wie der Browser sie schickt. */
async function press(key, modifiers = {}) {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }))
  await flushPromises()
}

/** Ein Rahmen ueber den Canvas: von (x0,y0) nach (x1,y1). */
async function marquee(wrapper, x0, y0, x1, y1) {
  const canvas = wrapper.find('.editor-canvas')
  canvas.element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: y0 }),
  )
  window.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true, clientX: x1, clientY: y1 }),
  )
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: x1, clientY: y1 }))
  await flushPromises()
}

/** Maus-Zug an einem Element (oder an seinem Anfasser). */
async function mouseDrag(target, dx, dy) {
  target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }))
  window.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }),
  )
  window.dispatchEvent(
    new window.MouseEvent('mouseup', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }),
  )
  await flushPromises()
}

/**
 * Ein Touch-Ereignis, wie der Browser es schickt.
 *
 * jsdom bringt keinen `TouchEvent`-Konstruktor mit; die Beruehrungspunkte werden
 * deshalb an ein gewoehnliches Ereignis gehaengt - unter genau den Namen, unter
 * denen der Canvas sie liest (`touches`, `changedTouches`, `targetTouches`).
 * Beim `touchend` ist `touches` leer und der Punkt steht in `changedTouches`,
 * so wie im Browser.
 */
function touchEvent(type, x, y) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true })
  const point = { identifier: 0, clientX: x, clientY: y, pageX: x, pageY: y }
  ev.touches = type === 'touchend' || type === 'touchcancel' ? [] : [point]
  ev.changedTouches = [point]
  ev.targetTouches = ev.touches
  return ev
}

/** Derselbe Zug wie {@link mouseDrag}, nur per Finger. */
async function touchDrag(target, dx, dy) {
  target.dispatchEvent(touchEvent('touchstart', 100, 100))
  window.dispatchEvent(touchEvent('touchmove', 100 + dx, 100 + dy))
  window.dispatchEvent(touchEvent('touchend', 100 + dx, 100 + dy))
  await flushPromises()
}

beforeEach(() => {
  vi.resetModules()
  getPage.mockReset()
  getNode.mockReset()
  savePage.mockReset()
  getTree.mockReset()
  server.pages = {}
  server.tree = []
  clearClipboard()
  window.localStorage.clear()
  wireServer()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Der Canvas steht erst, wenn die Seite wirklich geladen ist', () => {
  it('zeigt `.editor-canvas` nicht, solange die Seite noch unterwegs ist', async () => {
    let liefern
    getPage.mockImplementation(() => new Promise((resolve) => (liefern = resolve)))
    const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
    const wrapper = mount(VisuEditorCanvas, { props: { pageId: 'p1' }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('.editor-canvas').exists()).toBe(false)
    liefern({ data: pageConfig([widget('a', 0, 0)]) })
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('.editor-canvas').exists()).toBe(true)
    expect(ids(wrapper)).toEqual(['a'])
  })
})

describe('E5 - Mehrfachauswahl per Rahmen', () => {
  it('waehlt die vom Rahmen umschlossenen Elemente aus', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0), widget('c', 300, 300)])
    const w = await mountCanvas()
    await marquee(w, 0, 0, 100, 100)
    expect(selectedIds(w)).toEqual(['a', 'b'])
  })

  it('laesst ein nur angeschnittenes Element aus', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await marquee(w, 0, 0, 45, 100)
    expect(selectedIds(w)).toEqual(['a'])
  })

  it('ersetzt eine bestehende Auswahl, statt sie zu ergaenzen', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 300, 300)])
    const w = await mountCanvas()
    await pick(w, 'b')
    expect(selectedIds(w)).toEqual(['b'])
    await marquee(w, 0, 0, 100, 100)
    expect(selectedIds(w)).toEqual(['a'])
  })

  it('startet keinen Rahmen, wenn der Zug auf einem Element beginnt', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    const el = els(w).find((e) => e.attributes('data-el') === 'a')
    await mouseDrag(el.element, 16, 0)
    // Der Zug hat `a` VERSCHOBEN und nicht einen Rahmen ueber beide gezogen.
    expect(selectedIds(w)).toEqual(['a'])
    expect(boxOf(w, 'a').x).toBe(16)
  })

  it('zieht im responsiven Modus keinen Rahmen - dort gibt es keine Koordinaten', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    const modus = w.find('#editor-canvas-mode-select')
    await modus.setValue('responsive')
    await marquee(w, 0, 0, 500, 500)
    expect(selectedIds(w)).toEqual([])
  })
})

describe('E5 - Gruppenverschieben und Gruppieren', () => {
  it('bewegt jedes ausgewaehlte Element um DIESELBE Distanz', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 10), widget('c', 300, 300)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await press('ArrowRight')
    expect(boxOf(w, 'a')).toMatchObject({ x: 1, y: 0 })
    expect(boxOf(w, 'b')).toMatchObject({ x: 41, y: 10 })
    expect(boxOf(w, 'c')).toMatchObject({ x: 300, y: 300 })
  })

  it('bietet „Gruppieren" erst ab zwei ausgewaehlten Elementen an', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    expect(byButton(w, 'Gruppieren').attributes('disabled')).toBeDefined()
    await pick(w, 'a')
    expect(byButton(w, 'Gruppieren').attributes('disabled')).toBeDefined()
    await pick(w, 'b', true)
    expect(byButton(w, 'Gruppieren').attributes('disabled')).toBeUndefined()
  })

  it('fasst die Auswahl zu GENAU EINER Gruppe zusammen und zieht einen Rahmen', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0), widget('c', 300, 300)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await byButton(w, 'Gruppieren').trigger('click')
    expect(w.findAll('.editor-canvas [data-group]')).toHaveLength(1)
  })

  it('faengt mit einem Griff die ganze Gruppe - ein Klick waehlt alle Mitglieder', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0), widget('c', 300, 300)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await byButton(w, 'Gruppieren').trigger('click')
    await pick(w, 'c')
    expect(selectedIds(w)).toEqual(['c'])
    await pick(w, 'a')
    expect(selectedIds(w)).toEqual(['a', 'b'])
  })

  it('verschiebt beim Ziehen eines Mitglieds die ganze Gruppe um dieselbe Distanz', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 10)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await byButton(w, 'Gruppieren').trigger('click')
    const el = els(w).find((e) => e.attributes('data-el') === 'a')
    await mouseDrag(el.element, 16, 0)
    expect(boxOf(w, 'a')).toMatchObject({ x: 16, y: 0 })
    expect(boxOf(w, 'b')).toMatchObject({ x: 56, y: 10 })
  })

  it('hebt die Gruppierung wieder auf', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await byButton(w, 'Gruppieren').trigger('click')
    expect(w.findAll('.editor-canvas [data-group]')).toHaveLength(1)
    await byButton(w, 'Gruppierung aufheben').trigger('click')
    expect(w.findAll('.editor-canvas [data-group]')).toHaveLength(0)
  })

  it('speichert die Gruppe als Marke des Widgets, nicht neben der Seite', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await byButton(w, 'Gruppieren').trigger('click')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    const gruppen = server.pages.p1.widgets.map((x) => x.config?.editor?.group)
    expect(gruppen[0]).toBeTruthy()
    expect(gruppen[0]).toBe(gruppen[1])
  })
})

describe('E6 - Duplizieren, Kopieren, Einfuegen', () => {
  it('dupliziert das ausgewaehlte Element und waehlt die Kopie aus', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('d', { ctrlKey: true })
    expect(els(w)).toHaveLength(2)
    expect(selectedIds(w)).toHaveLength(1)
    expect(selectedIds(w)[0]).not.toBe('a')
    expect(els(w)[1].text()).toContain('Kachel a')
  })

  it('dupliziert eine ganze Mehrfachauswahl', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await press('d', { ctrlKey: true })
    expect(els(w)).toHaveLength(4)
    expect(selectedIds(w)).toHaveLength(2)
  })

  it('dupliziert nichts, wenn nichts ausgewaehlt ist', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    await press('d', { ctrlKey: true })
    expect(els(w)).toHaveLength(1)
  })

  it('kopiert die Auswahl in die Ablage und fuegt sie auf derselben Seite ein', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('c', { ctrlKey: true })
    expect(readClipboard().map((x) => x.name)).toEqual(['Kachel a'])
    await press('v', { ctrlKey: true })
    expect(els(w)).toHaveLength(2)
  })

  it('fuegt dieselbe Ablage auf einer ANDEREN Seite ein - der Seitenwechsel traegt sie', async () => {
    seed('p1', [widget('a', 0, 0)])
    seed('p2', [widget('z', 0, 0)])
    const erste = await mountCanvas('p1')
    await pick(erste, 'a')
    await press('c', { ctrlKey: true })
    erste.unmount()

    const zweite = await mountCanvas('p2')
    expect(els(zweite)).toHaveLength(1)
    await press('v', { ctrlKey: true })
    expect(els(zweite)).toHaveLength(2)
    expect(zweite.text()).toContain('Kachel a')
  })

  it('gibt der eingefuegten Kachel eine frische Id, damit zwei Seiten sich nicht ins Gehege kommen', async () => {
    seed('p1', [widget('a', 0, 0)])
    seed('p2', [])
    const erste = await mountCanvas('p1')
    await pick(erste, 'a')
    await press('c', { ctrlKey: true })
    erste.unmount()
    const zweite = await mountCanvas('p2')
    await press('v', { ctrlKey: true })
    expect(ids(zweite)).toHaveLength(1)
    expect(ids(zweite)[0]).not.toBe('a')
  })

  it('fuegt ohne Ablage nichts ein', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    await press('v', { ctrlKey: true })
    expect(els(w)).toHaveLength(1)
  })

  it('speichert die eingefuegte Kachel erst auf „Speichern" - nicht von selbst', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('d', { ctrlKey: true })
    expect(savePage).not.toHaveBeenCalled()
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(server.pages.p1.widgets).toHaveLength(2)
  })
})

describe('E7 - Nudging, Undo und Redo', () => {
  it('bewegt das ausgewaehlte Element um genau einen Schritt je Pfeiltaste', async () => {
    seed('p1', [widget('a', 10, 10)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('ArrowRight')
    await press('ArrowRight')
    await press('ArrowDown')
    expect(boxOf(w, 'a')).toMatchObject({ x: 12, y: 11 })
  })

  it('nimmt jeden Schritt EINZELN zurueck und landet exakt am Ausgangswert', async () => {
    seed('p1', [widget('a', 10, 10)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('ArrowRight')
    await press('ArrowRight')
    await press('ArrowDown')
    await press('z', { ctrlKey: true })
    expect(boxOf(w, 'a')).toMatchObject({ x: 12, y: 10 })
    await press('z', { ctrlKey: true })
    await press('z', { ctrlKey: true })
    expect(boxOf(w, 'a')).toMatchObject({ x: 10, y: 10 })
  })

  it('fuehrt einen zurueckgenommenen Schritt per Redo wieder aus', async () => {
    seed('p1', [widget('a', 10, 10)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('ArrowRight')
    await press('z', { ctrlKey: true })
    expect(boxOf(w, 'a')).toMatchObject({ x: 10 })
    await press('Z', { ctrlKey: true, shiftKey: true })
    expect(boxOf(w, 'a')).toMatchObject({ x: 11 })
  })

  it('nimmt auch einen Maus-Zug als EINEN Schritt zurueck, nicht als viele', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    const el = els(w).find((e) => e.attributes('data-el') === 'a')
    el.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }))
    for (const dx of [8, 16, 24]) {
      window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 100 + dx, clientY: 100 }))
    }
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 124, clientY: 100 }))
    await flushPromises()
    expect(boxOf(w, 'a').x).toBe(24)
    await press('z', { ctrlKey: true })
    expect(boxOf(w, 'a').x).toBe(0)
  })

  it('legt fuer einen Klick OHNE Bewegung keinen Schritt auf den Stapel', async () => {
    seed('p1', [widget('a', 10, 10)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('ArrowRight')
    await pick(w, 'a')
    await press('z', { ctrlKey: true })
    expect(boxOf(w, 'a')).toMatchObject({ x: 10 })
  })

  it('nimmt ein Duplizieren, ein Einfuegen und ein Gruppieren zurueck', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('d', { ctrlKey: true })
    expect(els(w)).toHaveLength(3)
    await press('z', { ctrlKey: true })
    expect(ids(w)).toEqual(['a', 'b'])

    await press('c', { ctrlKey: true })
    await press('v', { ctrlKey: true })
    expect(els(w)).toHaveLength(3)
    await press('z', { ctrlKey: true })
    expect(ids(w)).toEqual(['a', 'b'])

    await marquee(w, -5, -5, 100, 100)
    await byButton(w, 'Gruppieren').trigger('click')
    expect(w.findAll('.editor-canvas [data-group]')).toHaveLength(1)
    await press('z', { ctrlKey: true })
    expect(w.findAll('.editor-canvas [data-group]')).toHaveLength(0)
  })

  it('haelt die Auswahl ueber ein Undo hinweg, damit der Anfasser nicht verschwindet', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('ArrowRight')
    await press('z', { ctrlKey: true })
    expect(selectedIds(w)).toEqual(['a'])
    expect(w.findAll('[data-resize="se"]')).toHaveLength(1)
  })

  it('bietet Rueckgaengig und Wiederherstellen auch als Schaltflaechen an', async () => {
    seed('p1', [widget('a', 10, 10)])
    const w = await mountCanvas()
    expect(byButton(w, 'Rückgängig').attributes('disabled')).toBeDefined()
    await pick(w, 'a')
    await press('ArrowRight')
    expect(byButton(w, 'Rückgängig').attributes('disabled')).toBeUndefined()
    await byButton(w, 'Rückgängig').trigger('click')
    expect(boxOf(w, 'a')).toMatchObject({ x: 10 })
    await byButton(w, 'Wiederherstellen').trigger('click')
    expect(boxOf(w, 'a')).toMatchObject({ x: 11 })
  })

  it('nudgt nicht, waehrend in einem Feld getippt wird', async () => {
    seed('p1', [widget('a', 10, 10)])
    const w = await mountCanvas()
    await pick(w, 'a')
    const feld = w.find('#editor-canvas-x')
    feld.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(boxOf(w, 'a')).toMatchObject({ x: 10 })
  })

  it('bewegt ein gesperrtes Element auch per Pfeiltaste nicht', async () => {
    seed('p1', [widget('a', 10, 10, { config: { editor: { locked: true } } })])
    const w = await mountCanvas()
    await pick(w, 'a')
    await press('ArrowRight')
    expect(boxOf(w, 'a')).toMatchObject({ x: 10 })
  })
})

describe('E14 - Touch bewegt und vergroessert um dieselbe Distanz wie die Maus', () => {
  it('verschiebt per Finger genau so weit wie per Maus', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    const el = () => els(w).find((e) => e.attributes('data-el') === 'a').element

    await mouseDrag(el(), 60, 0)
    const perMaus = boxOf(w, 'a')
    expect(perMaus.x).toBeGreaterThan(0)

    await press('z', { ctrlKey: true })
    expect(boxOf(w, 'a')).toMatchObject({ x: 0, y: 0 })

    await touchDrag(el(), 60, 0)
    expect(boxOf(w, 'a')).toEqual(perMaus)
  })

  it('zieht per Finger am Anfasser genau so gross wie per Maus - ohne zu verschieben', async () => {
    seed('p1', [widget('a', 20, 20)])
    const w = await mountCanvas()
    await pick(w, 'a')
    const start = boxOf(w, 'a')
    const griff = () =>
      els(w).find((e) => e.attributes('data-el') === 'a').find('[data-resize="se"]').element

    await mouseDrag(griff(), 60, 0)
    const perMaus = boxOf(w, 'a')
    expect(perMaus.w).toBeGreaterThan(start.w)
    expect(perMaus).toMatchObject({ x: start.x, y: start.y })

    await press('z', { ctrlKey: true })
    expect(boxOf(w, 'a')).toMatchObject({ w: start.w, h: start.h })

    await touchDrag(griff(), 60, 0)
    expect(boxOf(w, 'a')).toEqual(perMaus)
  })

  it('bewegt ein gesperrtes Element auch per Finger nicht', async () => {
    seed('p1', [widget('a', 20, 20, { config: { editor: { locked: true } } })])
    const w = await mountCanvas()
    const el = els(w).find((e) => e.attributes('data-el') === 'a').element
    await touchDrag(el, 60, 0)
    expect(boxOf(w, 'a')).toMatchObject({ x: 20, y: 20 })
  })
})
