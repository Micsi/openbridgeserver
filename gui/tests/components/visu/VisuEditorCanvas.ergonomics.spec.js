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

/**
 * Maus-Zug an einem Element (oder an seinem Anfasser), mit frei gewaehltem
 * Aufsetzpunkt.
 *
 * WO der Zeiger aufsetzt, zaehlt seit Runde 2: der Anfasser sitzt ausserhalb
 * seiner Kachel und kann dort ueber einer NACHBARKACHEL liegen - dann gehoert
 * der Zeiger der Nachbarin. `getBoundingClientRect` liefert in jsdom lauter
 * Nullen; Fenster- und Flaechenkoordinaten sind hier also dieselbe Zahl.
 */
async function mouseDragFrom(target, x0, y0, dx, dy) {
  target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: y0 }))
  window.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }),
  )
  window.dispatchEvent(
    new window.MouseEvent('mouseup', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }),
  )
  await flushPromises()
}

/** Maus-Zug an einem Element (oder an seinem Anfasser). */
async function mouseDrag(target, dx, dy) {
  await mouseDragFrom(target, 100, 100, dx, dy)
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

/** Derselbe Rahmen wie {@link marquee}, nur per Finger. */
async function touchMarquee(wrapper, x0, y0, x1, y1) {
  const canvas = wrapper.find('.editor-canvas')
  canvas.element.dispatchEvent(touchEvent('touchstart', x0, y0))
  window.dispatchEvent(touchEvent('touchmove', x1, y1))
  window.dispatchEvent(touchEvent('touchend', x1, y1))
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

describe('E5 - eine Mehrfachauswahl laesst sich MIT DER MAUS als Ganzes verschieben', () => {
  /**
   * Der Befund aus Runde 1, als Zeile.
   *
   * Bis dahin waehlte jeder Zug an einer Kachel zuerst NEU (`select`) und las
   * die Mitzieher erst danach - die Auswahl war zu diesem Zeitpunkt schon auf
   * eine Kachel geschrumpft. Ergebnis: die angefasste Kachel wanderte, die
   * uebrigen blieben stehen, und die Auswahl war still verloren. Das
   * Gruppenverschieben aus E5 gab es damit nur per Pfeiltaste (das faehrt der
   * Playwright-Teil) oder nach einem zusaetzlichen Klick auf „Gruppieren".
   */
  it('bewegt die ganze RAHMEN-Auswahl und laesst sie bestehen', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 10), widget('c', 300, 300)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    expect(selectedIds(w)).toEqual(['a', 'b'])

    const el = els(w).find((e) => e.attributes('data-el') === 'a')
    await mouseDrag(el.element, 16, 0)

    expect(boxOf(w, 'a')).toMatchObject({ x: 16, y: 0 })
    expect(boxOf(w, 'b')).toMatchObject({ x: 56, y: 10 })
    expect(boxOf(w, 'c')).toMatchObject({ x: 300, y: 300 })
    expect(selectedIds(w)).toEqual(['a', 'b'])
  })

  it('bewegt auch eine UMSCHALT-Auswahl als Ganzes', async () => {
    seed('p1', [widget('a', 0, 16), widget('b', 40, 26)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await pick(w, 'b', true)
    expect(selectedIds(w)).toEqual(['a', 'b'])

    const el = els(w).find((e) => e.attributes('data-el') === 'b')
    await mouseDrag(el.element, 16, 0)

    // Der GEZOGENE bestimmt die Distanz samt Einrasten (Raster 8: 26 → 24), die
    // uebrigen folgen ihm um genau diesen Betrag.
    expect(boxOf(w, 'b')).toMatchObject({ x: 56, y: 24 })
    expect(boxOf(w, 'a')).toMatchObject({ x: 16, y: 14 })
    expect(selectedIds(w)).toEqual(['a', 'b'])
  })

  it('waehlt neu, wenn der Zug an einem Element AUSSERHALB der Auswahl beginnt', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 10), widget('c', 300, 300)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)

    const el = els(w).find((e) => e.attributes('data-el') === 'c')
    await mouseDrag(el.element, 16, 0)

    expect(selectedIds(w)).toEqual(['c'])
    expect(boxOf(w, 'a')).toMatchObject({ x: 0, y: 0 })
    expect(boxOf(w, 'b')).toMatchObject({ x: 40, y: 10 })
  })

  /**
   * Die Gegenprobe zur Zeile darueber: ein KLICK (ohne Bewegung) auf ein
   * Mitglied der Auswahl sammelt sie auf genau dieses eine Element ein - so
   * verhalten sich die belegten Champions, und ohne das gaebe es keinen Weg
   * mehr von einer Mehrfachauswahl zurueck zu einer einzelnen Kachel.
   */
  it('sammelt die Auswahl bei einem Klick OHNE Bewegung auf das angefasste Element ein', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 10)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    expect(selectedIds(w)).toEqual(['a', 'b'])
    await pick(w, 'a')
    expect(selectedIds(w)).toEqual(['a'])
    expect(boxOf(w, 'b')).toMatchObject({ x: 40, y: 10 })
  })

  it('zieht eine gesperrte Kachel nicht mit, auch nicht als Teil der Auswahl', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 10, { config: { editor: { locked: true } } })])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    const el = els(w).find((e) => e.attributes('data-el') === 'a')
    await mouseDrag(el.element, 16, 0)
    expect(boxOf(w, 'a')).toMatchObject({ x: 16 })
    expect(boxOf(w, 'b')).toMatchObject({ x: 40, y: 10 })
  })
})

describe('E14 - der Anfasser sitzt AUSSERHALB der Kachel', () => {
  /**
   * Der zweite Befund aus Runde 1.
   *
   * Eine Kachel der M5-Beispielwelt misst 3x2 Autoreneinheiten, also 3x2
   * CSS-Pixel. Ein 8x8 grosser Anfasser AUF dieser Ecke verdeckte sie
   * vollstaendig: ein Zug in ihrer Mitte vergroesserte sie, statt sie zu
   * verschieben (gemessen 3x2 → 40x1). Er liegt deshalb jetzt vollstaendig
   * ausserhalb - links oben genau auf der aeusseren Ecke.
   *
   * Die Kachel traegt 1 px Rahmen und rechnet in `border-box`; der Bezug eines
   * absolut gesetzten Kindes ist ihr INNENkasten. `w - 1` / `h - 1` schiebt den
   * Anfasser damit auf x+w bzw. y+h - die Aussenkante, ohne einen Pixel
   * Ueberdeckung.
   */
  it('setzt ihn bei einer 3x2-Kachel auf die aeussere Ecke, nicht auf die Flaeche', async () => {
    seed('p1', [widget('klein', 10, 10, { w: 3, h: 2 })])
    const w = await mountCanvas()
    await pick(w, 'klein')
    const griff = els(w)
      .find((e) => e.attributes('data-el') === 'klein')
      .find('[data-resize="se"]')
    // 3 - 1 = 2 und 2 - 1 = 1: zusammen mit dem 1 px Rahmen liegt die linke
    // obere Ecke des Anfassers auf (x+3, y+2), also GENAU auf der Kachelecke.
    expect(griff.element.style.left).toBe('2px')
    expect(griff.element.style.top).toBe('1px')
  })

  /**
   * Ausserhalb heisst: er kann ueber einer NACHBARKACHEL liegen. Verschwindet
   * sie GANZ unter ihm, gehoert der Zeiger ihr - sonst faenge der Anfasser der
   * ausgewaehlten Kachel den Klick auf die daneben ab, und die Nachbarin waere
   * mit der Maus ueberhaupt nicht mehr erreichbar (in Runde 1 zweimal
   * reproduziert). Genau dieser Fall ist die M5-Beispielwelt: ihre Kacheln
   * messen 3x2 Autoreneinheiten, der Anfasser 8x8 - er schluckt eine ganze
   * Kachel.
   */
  it('gibt den Zeiger an die Nachbarkachel weiter, wenn sie GANZ unter ihm verschwindet', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 10, 10, { w: 3, h: 2 })])
    const w = await mountCanvas()
    await pick(w, 'a')
    const griff = els(w)
      .find((e) => e.attributes('data-el') === 'a')
      .find('[data-resize="se"]')
    // Der Anfasser von `a` beginnt auf (10,10) und misst 8x8; (11,11) liegt auf
    // ihm UND auf `b`, und `b` liegt mit 3x2 vollstaendig unter ihm - haette
    // also keinen freien Pixel mehr.
    await mouseDragFrom(griff.element, 11, 11, 16, 0)
    expect(boxOf(w, 'a')).toMatchObject({ x: 0, y: 0, w: 10, h: 10 })
    expect(selectedIds(w)).toEqual(['b'])
    expect(boxOf(w, 'b').x).toBeGreaterThan(10)
  })

  it('zieht dort gross, wo keine Nachbarkachel liegt', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 100, 100)])
    const w = await mountCanvas()
    await pick(w, 'a')
    const griff = els(w)
      .find((e) => e.attributes('data-el') === 'a')
      .find('[data-resize="se"]')
    await mouseDragFrom(griff.element, 12, 12, 40, 40)
    expect(boxOf(w, 'a').w).toBeGreaterThan(10)
    expect(boxOf(w, 'a')).toMatchObject({ x: 0, y: 0 })
    expect(boxOf(w, 'b')).toMatchObject({ x: 100, y: 100 })
  })

  /**
   * DAS LUECKENLOSE RASTER - der Befund aus Runde 2, und der Normalfall dieses
   * Editors: sein Einrasten erzeugt genau solche Anordnungen.
   *
   * Vier Kacheln 40x40 an (0,0), (40,0), (0,40), (40,40). Der Anfasser der
   * ersten beginnt exakt auf (40,40) und liegt damit vollstaendig auf der
   * diagonalen Nachbarin - kein einziger seiner 64 Pixel ist frei. Bis Runde 2
   * trat er deshalb zurueck: die Kachel war am Anfasser gar nicht mehr
   * vergroesserbar, und der Zug daran VERSCHOB die Nachbarin (gemessen: `GA`
   * unveraendert, `GD:40,40 → 80,80`).
   *
   * Jetzt gilt: die Nachbarin ist 40x40 gross und verschwindet nicht unter dem
   * 8x8 grossen Anfasser - er behaelt den Zeiger. Die EIGENE Kachel waechst,
   * und keine fremde ruehrt sich.
   */
  it('zieht im lueckenlosen Raster die EIGENE Kachel gross und bewegt keine fremde', async () => {
    seed('p1', [
      widget('ga', 0, 0, { w: 40, h: 40 }),
      widget('gb', 40, 0, { w: 40, h: 40 }),
      widget('gc', 0, 40, { w: 40, h: 40 }),
      widget('gd', 40, 40, { w: 40, h: 40 }),
    ])
    const w = await mountCanvas()
    await pick(w, 'ga')
    const griff = els(w)
      .find((e) => e.attributes('data-el') === 'ga')
      .find('[data-resize="se"]')
    // Seine linke obere Ecke liegt auf (40,40) - mitten in `gd`, und er
    // verspricht dort `se-resize`, was jetzt auch stimmt.
    expect(griff.element.style.left).toBe('39px')
    expect(griff.element.style.top).toBe('39px')
    expect(griff.classes()).toContain('cursor-se-resize')

    await mouseDragFrom(griff.element, 42, 42, 40, 40)

    expect(selectedIds(w)).toEqual(['ga'])
    expect(boxOf(w, 'ga')).toMatchObject({ x: 0, y: 0 })
    expect(boxOf(w, 'ga').w).toBeGreaterThan(40)
    expect(boxOf(w, 'ga').h).toBeGreaterThan(40)
    expect(boxOf(w, 'gb')).toMatchObject({ x: 40, y: 0, w: 40, h: 40 })
    expect(boxOf(w, 'gc')).toMatchObject({ x: 0, y: 40, w: 40, h: 40 })
    expect(boxOf(w, 'gd')).toMatchObject({ x: 40, y: 40, w: 40, h: 40 })
  })

  /**
   * Und dasselbe von der anderen Seite: was HINTER der eigenen Kachel liegt,
   * darf den Anfasser nie verdraengen. Eine Unterlage (ein grosses Panel ganz
   * hinten) ist der Grund, auf dem gearbeitet wird - bis Runde 2 zog der Zug am
   * Anfasser einer Kachel darauf das ganze Panel weg (`PANEL:0,0 → 40,40`), und
   * bei gesperrter Unterlage war der Anfasser vollends tot.
   */
  it('laesst sich von einer Kachel HINTER der eigenen nicht verdraengen', async () => {
    seed('p1', [widget('panel', 0, 0, { w: 400, h: 200 }), widget('ka', 40, 40, { w: 40, h: 30 })])
    const w = await mountCanvas()
    await pick(w, 'ka')
    const griff = els(w)
      .find((e) => e.attributes('data-el') === 'ka')
      .find('[data-resize="se"]')
    await mouseDragFrom(griff.element, 82, 72, 40, 40)
    expect(selectedIds(w)).toEqual(['ka'])
    expect(boxOf(w, 'ka')).toMatchObject({ x: 40, y: 40 })
    expect(boxOf(w, 'ka').w).toBeGreaterThan(40)
    expect(boxOf(w, 'panel')).toMatchObject({ x: 0, y: 0, w: 400, h: 200 })
  })

  /**
   * Und der Gegenprobe-Fall zum Raster: eine Nachbarkachel, die der Anfasser
   * ganz zudeckt, bekommt den Zeiger AN GENAU DEM PUNKT, an dem sie liegt - der
   * Rest des Anfassers vergroessert weiterhin die eigene Kachel. Genau so liegt
   * die M5-Beispielwelt: 3x2 grosse Kacheln, dazwischen der 8x8 grosse
   * Anfasser, dessen Mitte gerade noch frei ist (E1 zieht dort gross).
   */
  it('behaelt an seinem freien Teil den Zeiger, auch wenn er anderswo zurueckweicht', async () => {
    seed('p1', [widget('a', 0, 0, { w: 3, h: 2 }), widget('b', 4, 2, { w: 3, h: 2 })])
    const w = await mountCanvas()
    await pick(w, 'a')
    const griff = els(w)
      .find((e) => e.attributes('data-el') === 'a')
      .find('[data-resize="se"]')
    // Der Anfasser spannt [3,11)x[2,10); `b` liegt darin auf [4,7)x[2,4).
    // (5,3) gehoert `b` - dort tritt er zurueck.
    await mouseDragFrom(griff.element, 5, 3, 16, 0)
    expect(selectedIds(w)).toEqual(['b'])
    expect(boxOf(w, 'a')).toMatchObject({ x: 0, y: 0, w: 3, h: 2 })

    // (8,6) gehoert keiner Kachel - dort zieht er die eigene gross.
    await pick(w, 'a')
    const griffB = els(w)
      .find((e) => e.attributes('data-el') === 'a')
      .find('[data-resize="se"]')
    await mouseDragFrom(griffB.element, 8, 6, 40, 40)
    expect(selectedIds(w)).toEqual(['a'])
    expect(boxOf(w, 'a')).toMatchObject({ x: 0, y: 0 })
    expect(boxOf(w, 'a').w).toBeGreaterThan(3)
  })
})

describe('E5 - der Rahmen laesst sich auch mit dem Finger aufziehen', () => {
  /**
   * Der Harness fuehrt den Editor bei 393x851 und nimmt ihn in E14
   * ausdruecklich als Touch-Geraet ab. Ohne den Finger-Rahmen gaebe es dort
   * ueberhaupt keine Mehrfachauswahl per Zeiger - und „Gruppieren" waere eine
   * Schaltflaeche, die man nie benutzen kann.
   */
  it('waehlt die umschlossenen Elemente auch per Finger', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0), widget('c', 300, 300)])
    const w = await mountCanvas()
    await touchMarquee(w, -5, -5, 100, 100)
    expect(selectedIds(w)).toEqual(['a', 'b'])
  })

  it('startet auch per Finger keinen Rahmen, wenn der Zug auf einer Kachel beginnt', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    const el = els(w).find((e) => e.attributes('data-el') === 'a')
    await touchDrag(el.element, 16, 0)
    expect(selectedIds(w)).toEqual(['a'])
    expect(boxOf(w, 'a').x).toBe(16)
  })
})

describe('E7 - eine Aktion, die nichts aendert, kommt nicht auf den Stapel', () => {
  /**
   * Fuer den ZUG stimmte das schon in Runde 1 (`noteDragChange`), fuer die
   * Schaltflaechen nicht: dreimal „Gruppieren" derselben Auswahl legte drei
   * Schritte ab, obwohl sich ab dem zweiten nichts mehr aenderte. Wer einen
   * Fehlgriff zuruecknehmen will, druecke sonst mehrfach auf „Rueckgaengig"
   * und sehe dabei nichts geschehen.
   */
  it('bietet „Gruppieren" nicht mehr an, wenn die Auswahl schon genau diese Gruppe ist', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await marquee(w, -5, -5, 100, 100)
    await byButton(w, 'Gruppieren').trigger('click')
    expect(w.findAll('.editor-canvas [data-group]')).toHaveLength(1)
    expect(byButton(w, 'Gruppieren').attributes('disabled')).toBeDefined()
    // EIN Undo genuegt, um die Gruppe wieder aufzuloesen.
    await press('z', { ctrlKey: true })
    expect(w.findAll('.editor-canvas [data-group]')).toHaveLength(0)
  })

  it('zeichnet „Nach vorne" an der schon vordersten Kachel nicht auf', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await pick(w, 'b')
    await byButton(w, 'Nach vorne').trigger('click')
    expect(ids(w)).toEqual(['a', 'b'])
    expect(byButton(w, 'Rückgängig').attributes('disabled')).toBeDefined()
  })

  it('zeichnet „Nach hinten" an der schon hintersten Kachel nicht auf', async () => {
    seed('p1', [widget('a', 0, 0), widget('b', 40, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await byButton(w, 'Nach hinten').trigger('click')
    expect(ids(w)).toEqual(['a', 'b'])
    expect(byButton(w, 'Rückgängig').attributes('disabled')).toBeDefined()
  })

  /**
   * Das Ankreuzfeld haengt an `:checked` und `@change`, nicht an `v-model` - es
   * kann also ein `change` erreichen, das den Wert traegt, der schon steht.
   * `setValue` von `@vue/test-utils` schickt genau das NICHT (es kehrt still um,
   * wenn `element.checked` bereits stimmt); das Ereignis steht hier deshalb von
   * Hand.
   */
  it('zeichnet eine Marke auf ihren jetzigen Wert nicht auf', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    const gesperrt = () => w.find('#editor-canvas-locked').element
    const ankreuzen = async (checked) => {
      gesperrt().checked = checked
      gesperrt().dispatchEvent(new window.Event('change', { bubbles: true }))
      await flushPromises()
    }
    await ankreuzen(true)
    await ankreuzen(true)
    await ankreuzen(true)
    // Genau EIN Schritt liegt auf dem Stapel, nicht drei.
    await press('z', { ctrlKey: true })
    expect(gesperrt().checked).toBe(false)
    expect(byButton(w, 'Rückgängig').attributes('disabled')).toBeDefined()
  })

  it('zeichnet eine Koordinate auf ihren jetzigen Wert nicht auf', async () => {
    seed('p1', [widget('a', 24, 0)])
    const w = await mountCanvas()
    await pick(w, 'a')
    await w.find('#editor-canvas-x').setValue('24')
    expect(byButton(w, 'Rückgängig').attributes('disabled')).toBeDefined()
  })
})

describe('Der Seitenwechsel INNERHALB der Anwendung', () => {
  /**
   * `.editor-canvas` ist die Marke, an der der Harness „der Editor steht"
   * abliest. Sie deckte bis Runde 2 nur den ERSTAUFBAU: `loaded` wurde nie
   * wieder `false`, und beim Wechsel auf eine andere Seite stand unter der
   * Marke weiter die alte Seite - mit ihren Kacheln, ihren Tasten und ihrem
   * Stapel.
   */
  it('nimmt die alte Seite vom Schirm, bis die neue wirklich da ist', async () => {
    seed('p1', [widget('a', 0, 0)])
    const w = await mountCanvas('p1')
    expect(ids(w)).toEqual(['a'])

    let liefern
    getPage.mockImplementation((id) =>
      id === 'p2'
        ? new Promise((resolve) => (liefern = resolve))
        : Promise.resolve({ data: pageConfig([widget('a', 0, 0)]) }),
    )
    await w.setProps({ pageId: 'p2' })
    await flushPromises()
    expect(w.find('.editor-canvas').exists()).toBe(false)

    liefern({ data: pageConfig([widget('z', 0, 0)]) })
    await flushPromises()
    await flushPromises()
    expect(ids(w)).toEqual(['z'])
  })
})
