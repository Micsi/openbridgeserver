import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { LAYOUT_PIXEL, LAYOUT_RESPONSIVE, readPageSettings } from '@/utils/visuEditorPage'

/**
 * Der WYSIWYG-Canvas des V2-Editors (M5 C2, Issue #169).
 *
 * Diese Spec ist die Vitest-Haelfte der Abnahme; die andere sind die fuenf
 * Playwright-Szenarien E1/E2/E4/E8/E17 in `apps/visu/e2e/m5-editor-matrix.spec.ts`.
 * Was dort im Browser behauptet wird, steht hier als Einzelfrage: Snap an
 * einstellbarer Rasterweite (E1), Reihenfolge per Drag ohne Koordinatenfeld und
 * ueber einen Neuladen hinweg stabil (E2), Ausrichtlinie/Verteilen/gleiche
 * Groesse (E4), Z-Ordnung, Sperren, Ausblenden (E8), Breakpoints in den
 * Seiteneigenschaften (E17).
 *
 * DER SERVER IST HIER EIN STAND, KEIN STUMPF. `getPage` liefert, was `savePage`
 * zuletzt abgelegt hat, und legt es mit denselben Regeln ab wie das echte
 * Backend (`PageConfig`: Rasterweite mindestens 1, Breakpoints positiv und
 * sortiert, jede Kachel mit vier ganzen Zahlen). Nur so sind die zwei Aussagen
 * pruefbar, an denen Runde 1 gescheitert ist: dass „Gespeichert" erst nach einem
 * erfolgreichen Ruecklesen erscheint, und dass ein Neuladen wirklich den
 * gespeicherten Stand zeigt statt den, den der Test sich wuenscht.
 *
 * Die BEDIEN-AFFORDANZEN sind mitgeprueft (Beschriftung + Zuordnung
 * Label→Bedienelement), weil der Playwright-Harness genau sie anspricht
 * (`getByLabel('Rasterweite')`, `getByRole('button', { name: 'Verteilen' })`).
 * Ein umbenanntes Label faellt damit hier auf und nicht erst im Browser.
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

const BOX_DEFAULTS = { x: 0, y: 0, w: 2, h: 2 }

/**
 * Die Normalisierung des Backends (`obs/models/visu.py` → `PageConfig`),
 * nachgezogen. Sie steht hier, damit der Stand, den der Canvas zurueckliest,
 * derselbe ist wie der aus der echten Spalte.
 *
 * SEIT RUNDE 3 nimmt sie einer responsiven Seite die Koordinaten NICHT mehr ab:
 * V1 liest dieselbe Zeile und erwartet vier `number` (R17). Ein `null` in der
 * Spalte heilt beim Lesen auf die V1-Vorgabe - genau wie im Backend
 * (`_a_missing_coordinate_is_the_v1_default`). Ob eine Koordinate WIRKT,
 * entscheidet der Modus, und das entscheidet der Host.
 */
function normalizeOnServer(config) {
  const next = JSON.parse(JSON.stringify(config ?? {}))
  next.layout_mode = [LAYOUT_PIXEL, LAYOUT_RESPONSIVE].includes(next.layout_mode)
    ? next.layout_mode
    : LAYOUT_PIXEL
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

/** Der Stand des Servers waehrend eines Tests. */
const server = { config: null, tree: [], pages: {} }

function wireServer() {
  getNode.mockImplementation(async (id) => ({
    data: { id, name: 'M5 Home', kind: server.kind ?? 'normal' },
  }))
  getPage.mockImplementation(async (id) =>
    id === 'p1'
      ? { data: JSON.parse(JSON.stringify(server.config)) }
      : { data: JSON.parse(JSON.stringify(server.pages[id] ?? pageConfig([]))) },
  )
  savePage.mockImplementation(async (id, config) => {
    server.config = normalizeOnServer(config)
    return { status: 204 }
  })
  getTree.mockImplementation(async () => ({ data: server.tree }))
}

/** Den Canvas gegen den aktuellen Serverstand montieren (auch als „Neuladen"). */
async function mountAgainstServer() {
  const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
  const wrapper = mount(VisuEditorCanvas, { props: { pageId: 'p1' }, attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return wrapper
}

async function mountCanvas(widgets = [widget('a', 0, 0), widget('b', 4, 0), widget('c', 4, 4)]) {
  server.config = normalizeOnServer(pageConfig(widgets))
  wireServer()
  return mountAgainstServer()
}

/** Die Marke, an der der Harness ein platziertes Element findet. */
const els = (w) => w.findAll('.editor-canvas [data-el]')
const order = (w) => els(w).map((e) => e.attributes('data-el'))
const boxOf = (w, id) => {
  const el = els(w).find((e) => e.attributes('data-el') === id)
  return {
    x: Number(el.attributes('data-x')),
    y: Number(el.attributes('data-y')),
    w: Number(el.attributes('data-w')),
    h: Number(el.attributes('data-h')),
  }
}
/**
 * Ein Bedienelement ueber seine sichtbare Beschriftung, wie im Browser.
 *
 * Aufgeloest wird ueber `for`/`id` - genau den Weg, den auch `getByLabel` im
 * Harness geht. Umschliessende Labels waeren hier bequemer, taugen aber nicht:
 * der zugaengliche Name eines umschlossenen `<select>` nimmt die Texte SEINER
 * OPTIONEN mit auf, und „Layout-Modus Pixel Responsiv" trifft dann eine Suche
 * nach „X" (gemessen, Szenario E2).
 */
function byLabel(wrapper, text) {
  const label = wrapper.findAll('label').find((l) => l.text().includes(text))
  if (!label) return null
  const target = label.attributes('for')
  if (!target) return label.find('input, select, textarea')
  const control = wrapper.find(`#${target}`)
  return control.exists() ? control : null
}
function byButton(wrapper, text) {
  return wrapper.findAll('button').find((b) => b.text().includes(text)) ?? null
}

/**
 * Ein Element waehlen - so, wie es ein echter Klick tut: die Wahl haengt am
 * `mousedown`. (Am `click` haengt sie bewusst NICHT mehr: mit Umschalttaste
 * haetten beide Ereignisse die additive Wahl zweimal umgeschaltet, und im
 * Browser waere die Mehrfachauswahl damit nach dem Loslassen wieder leer.)
 */
async function pick(el, shiftKey = false) {
  el.element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, shiftKey, clientX: 0, clientY: 0 }),
  )
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
  await flushPromises()
}

/**
 * Dasselbe, aber mit der VOLLEN Ereignisfolge eines echten Browsers:
 * `mousedown`, `mouseup` UND `click`.
 *
 * Der Unterschied ist der Waechter. Bis Runde 1 hing die Auswahl an beiden
 * Ereignissen; mit gedrueckter Umschalttaste schaltete die additive Wahl damit
 * zweimal um, und die Mehrfachauswahl war nach dem Loslassen wieder leer - im
 * Browser. Im Vitest nicht, weil {@link pick} nur `mousedown` schickt. Genau
 * diese Mutation (MG10 der Kritik zu Runde 2) ueberlebte den gesamten
 * vitest-Satz und starb erst im E2E. Mit dieser Folge stirbt sie hier.
 */
async function pickInABrowser(el, shiftKey = false) {
  for (const type of ['mousedown', 'mouseup', 'click']) {
    el.element.dispatchEvent(new window.MouseEvent(type, { bubbles: true, shiftKey, clientX: 0, clientY: 0 }))
  }
  await flushPromises()
}

/** Die Elemente, die der Canvas gerade als ausgewaehlt zeichnet. */
const selectedIds = (w) =>
  els(w)
    .filter((e) => e.classes().includes('is-selected'))
    .map((e) => e.attributes('data-el'))

/** Maus-Drag ohne Layout: die Verschiebung steckt in den Zeigerkoordinaten. */
async function drag(wrapper, id, dx, dy) {
  const el = els(wrapper).find((e) => e.attributes('data-el') === id)
  el.element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }),
  )
  window.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }),
  )
  window.dispatchEvent(
    new window.MouseEvent('mouseup', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }),
  )
  await flushPromises()
}

/** Ein Zug am Anfasser unten rechts des ausgewaehlten Elements. */
async function dragHandle(wrapper, id, dx, dy) {
  const el = els(wrapper).find((e) => e.attributes('data-el') === id)
  const handle = el.find('[data-resize="se"]')
  handle.element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }),
  )
  window.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }),
  )
  window.dispatchEvent(
    new window.MouseEvent('mouseup', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }),
  )
  await flushPromises()
}

/** Das Umsortieren des responsiven Modus: `from` faellt auf `to`. */
async function reorder(wrapper, fromId, toId) {
  const from = els(wrapper).find((e) => e.attributes('data-el') === fromId)
  const to = els(wrapper).find((e) => e.attributes('data-el') === toId)
  from.element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
  )
  to.element.dispatchEvent(
    new window.MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }),
  )
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
  await flushPromises()
  await flushPromises()
}

beforeEach(() => {
  vi.resetModules()
  getPage.mockReset()
  getNode.mockReset()
  savePage.mockReset()
  getTree.mockReset()
  server.config = null
  server.tree = []
  server.pages = {}
  server.kind = 'normal'
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('VisuEditorCanvas - laden und zeichnen', () => {
  it('zeichnet jedes Widget als platziertes Element mit seinen Autoren-Massen', async () => {
    const w = await mountCanvas()
    expect(w.find('.editor-canvas').exists()).toBe(true)
    expect(order(w)).toEqual(['a', 'b', 'c'])
    expect(boxOf(w, 'b')).toEqual({ x: 4, y: 0, w: 3, h: 2 })
  })

  it('traegt den Namen des Widgets, damit man es im Canvas wiederfindet', async () => {
    const w = await mountCanvas()
    expect(els(w)[0].text()).toContain('Kachel a')
  })

  it('fragt ohne Seiten-Id gar nichts ab und zeigt keinen Canvas', async () => {
    const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
    const w = mount(VisuEditorCanvas, { props: { pageId: null } })
    await flushPromises()
    expect(getPage).not.toHaveBeenCalled()
    expect(w.find('.editor-canvas').exists()).toBe(false)
  })

  it('meldet einen Ladefehler sichtbar, statt leer zu bleiben', async () => {
    getPage.mockRejectedValue(new Error('kaputt'))
    getNode.mockRejectedValue(new Error('kaputt'))
    const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
    const w = mount(VisuEditorCanvas, { props: { pageId: 'p1' } })
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-error"]').exists()).toBe(true)
  })
})

describe('E1 - Drag auf eine Pixel-Koordinate, Snap an einstellbarer Rasterweite', () => {
  it('bietet die Rasterweite als beschriftetes Bedienelement an', async () => {
    const w = await mountCanvas()
    expect(byLabel(w, 'Rasterweite')).not.toBeNull()
  })

  it('rastet die gezogene Kachel auf ein Vielfaches der gewaehlten Rasterweite', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Rasterweite').setValue('20')
    await drag(w, 'a', 47, 33)
    expect(boxOf(w, 'a')).toMatchObject({ x: 40, y: 40 })
    expect(boxOf(w, 'a').x % 20).toBe(0)
  })

  it('merkt sich die Rasterweite in den Seiteneigenschaften', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Rasterweite').setValue('20')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(readPageSettings(server.config).grid).toBe(20)
  })

  it('zeigt die Koordinaten des gewaehlten Elements als X/Y-Felder', async () => {
    const w = await mountCanvas()
    await pick(els(w)[1])
    expect(byLabel(w, 'X').element.value).toBe('4')
    await byLabel(w, 'X').setValue('60')
    expect(boxOf(w, 'b').x).toBe(60)
  })
})

describe('Resize - der Anfasser zieht die Masse, nicht die Lage', () => {
  it('zeigt den Anfasser am ausgewaehlten Element', async () => {
    const w = await mountCanvas()
    expect(w.findAll('[data-resize="se"]')).toHaveLength(0)
    await pick(els(w)[0])
    expect(w.findAll('[data-resize="se"]')).toHaveLength(1)
  })

  it('macht die Kachel groesser und rastet dabei ein', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Rasterweite').setValue('20')
    await pick(els(w)[0])
    await dragHandle(w, 'a', 47, 33)
    expect(boxOf(w, 'a')).toMatchObject({ w: 60, h: 40 })
  })

  it('verschiebt die Kachel dabei NICHT', async () => {
    // Bis Runde 1 hatte der Anfasser keinen Handler: der Zug blubberte an das
    // Elternelement und verschob das Widget - eine Affordanz, die etwas anderes
    // tut, als sie zeigt.
    const w = await mountCanvas([widget('a', 40, 40)])
    await pick(els(w)[0])
    await dragHandle(w, 'a', 47, 33)
    expect(boxOf(w, 'a')).toMatchObject({ x: 40, y: 40 })
  })

  it('bietet an einem gesperrten Element gar keinen Anfasser an', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    await byLabel(w, 'Gesperrt').setValue(true)
    await flushPromises()
    expect(w.findAll('[data-resize="se"]')).toHaveLength(0)
  })

  it('bietet im responsiven Modus keinen Anfasser an - dort gibt es keine Masse', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    expect(w.findAll('[data-resize="se"]')).toHaveLength(0)
  })
})

describe('E4 - Ausrichtlinie, Verteilen, gleiche Groesse', () => {
  it('zeigt waehrend des Ziehens eine Ausrichtlinie bei Kantendeckung', async () => {
    const w = await mountCanvas()
    const el = els(w).find((e) => e.attributes('data-el') === 'c')
    el.element.dispatchEvent(
      new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }),
    )
    window.dispatchEvent(
      new window.MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 102 }),
    )
    await flushPromises()
    expect(w.findAll('.editor-guide').length).toBeGreaterThan(0)
    window.dispatchEvent(
      new window.MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 102 }),
    )
    await flushPromises()
    expect(w.findAll('.editor-guide')).toHaveLength(0)
  })

  it('verteilt erst ab drei Elementen und macht die Abstaende gleich', async () => {
    const w = await mountCanvas()
    expect(byButton(w, 'Verteilen').attributes('disabled')).toBeDefined()
    await w.find('.editor-canvas').trigger('keydown', { key: 'a', ctrlKey: true })
    expect(byButton(w, 'Verteilen').attributes('disabled')).toBeUndefined()
    await byButton(w, 'Verteilen').trigger('click')
    const xs = order(w).map((id) => boxOf(w, id).x)
    const gaps = xs.slice(1).map((x, i) => x - xs[i])
    expect(new Set(gaps).size).toBe(1)
  })

  it('verteilt bei GENAU ZWEI Elementen nicht - da gibt es nur einen Abstand', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    await pick(els(w)[1], true)
    expect(byButton(w, 'Verteilen').attributes('disabled')).toBeDefined()
    const vorher = order(w).map((id) => boxOf(w, id).x)
    await byButton(w, 'Verteilen').trigger('click')
    expect(order(w).map((id) => boxOf(w, id).x)).toEqual(vorher)
  })

  it('haelt eine Umschalt-Mehrfachauswahl auch bei der vollen Browser-Ereignisfolge', async () => {
    const w = await mountCanvas()
    await pickInABrowser(els(w)[0])
    expect(selectedIds(w)).toEqual(['a'])
    await pickInABrowser(els(w)[1], true)
    expect(selectedIds(w)).toEqual(['a', 'b'])
    // Und die Umschalttaste schaltet weiterhin AB, wenn dasselbe Element noch
    // einmal kommt - genau einmal, nicht zweimal.
    await pickInABrowser(els(w)[1], true)
    expect(selectedIds(w)).toEqual(['a'])
  })

  it('uebernimmt bei „Gleiche Groesse" die Masse des zuerst gewaehlten Elements', async () => {
    const w = await mountCanvas([widget('a', 0, 0, { w: 5, h: 7 }), widget('b', 4, 0), widget('c', 4, 4)])
    await w.find('.editor-canvas').trigger('keydown', { key: 'a', ctrlKey: true })
    await byButton(w, 'Gleiche Größe').trigger('click')
    const sizes = order(w).map((id) => `${boxOf(w, id).w}x${boxOf(w, id).h}`)
    expect(new Set(sizes)).toEqual(new Set(['5x7']))
  })
})

describe('E8 - Z-Ordnung, sperren, ausblenden', () => {
  it('bringt das gewaehlte Element nach vorne und nach hinten', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    await byButton(w, 'Nach vorne').trigger('click')
    expect(order(w).at(-1)).toBe('a')
    await byButton(w, 'Nach hinten').trigger('click')
    expect(order(w)[0]).toBe('a')
  })

  it('bewegt ein gesperrtes Element weder per Drag noch per Pfeiltaste', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    await byLabel(w, 'Gesperrt').setValue(true)
    const before = boxOf(w, 'a')
    await drag(w, 'a', 47, 33)
    expect(boxOf(w, 'a')).toEqual(before)
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(boxOf(w, 'a')).toEqual(before)
  })

  it('nudgt ein nicht gesperrtes Element pixelweise', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(boxOf(w, 'a').x).toBe(1)
  })

  it('nimmt ein ausgeblendetes Element aus dem Entwurf, laesst es aber im Canvas', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    await byLabel(w, 'Ausgeblendet').setValue(true)
    await flushPromises()
    expect(order(w)).toContain('a')
    const draft = w.emitted('draft').at(-1)[0]
    expect(draft.nodes[0].page_config.widgets.map((x) => x.id)).toEqual(['b', 'c'])
  })
})

describe('E2 - responsiver Modus: Reihenfolge statt Koordinaten', () => {
  it('bietet den Modus je Seite an und blendet die Koordinatenfelder aus', async () => {
    const w = await mountCanvas()
    expect(byLabel(w, 'X')).not.toBeNull()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    expect(byLabel(w, 'X')).toBeNull()
    expect(byLabel(w, 'Layout-Modus').element.value).toBe(LAYOUT_RESPONSIVE)
  })

  it('sagt, welcher Modus JE SKIN gerendert wird', async () => {
    const w = await mountCanvas()
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('edomi')
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('Pixel')
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('Responsiv')
    // Der Skin bleibt der der SEITE - er wird nicht aus dem Modus abgeleitet.
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('edomi')
  })

  it('rendert eine Pixel-Seite unter einem responsiven Skin als responsiv', async () => {
    server.config = normalizeOnServer({ ...pageConfig([widget('a', 0, 0)]), skin: 'ionic' })
    wireServer()
    const w = await mountAgainstServer()
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('ionic')
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('Responsiv')
  })

  it('setzt die Reihenfolge per Drag und speichert sie sofort', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    savePage.mockClear()

    await reorder(w, 'c', 'a')

    expect(order(w)).toEqual(['c', 'a', 'b'])
    expect(savePage).toHaveBeenCalled()
    expect(server.config.widgets.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('haelt das Order-Array ueber ein Neuladen hinweg identisch', async () => {
    const first = await mountCanvas()
    await byLabel(first, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    await reorder(first, 'c', 'a')
    const after = order(first)
    first.unmount()

    // „Neuladen" heisst: dieselbe Seite noch einmal vom Server holen.
    const second = await mountAgainstServer()
    expect(order(second)).toEqual(after)
  })

  it('speichert den Moduswechsel erst mit „Speichern", nicht schon beim Umschalten', async () => {
    // Sonst schriebe jeder Blick in den anderen Modus die Seite um - und ein
    // Szenario, das nur die Reihenfolge prueft, haette die Seite danach
    // dauerhaft umgestellt (im E2E-Harness gemessen: E4 lief danach im falschen
    // Modus). Die Reihenfolge wird trotzdem sofort gesichert.
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    savePage.mockClear()

    await reorder(w, 'c', 'a')

    expect(server.config.widgets.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(readPageSettings(server.config).mode).toBe(LAYOUT_PIXEL)

    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(readPageSettings(server.config).mode).toBe(LAYOUT_RESPONSIVE)
  })

  it('laesst der gespeicherten Seite im responsiven Modus jede Koordinate (R17)', async () => {
    // Die Korrektur aus Runde 3. §1.1 heisst „im responsiven Modus WIRKT keine
    // Koordinate" - durchgesetzt wird das im Host ueber `layout_mode`, nicht
    // dadurch, dass jemand die Zahlen aus der Spalte nimmt. V1 liest dieselbe
    // Seite und rechnet `w.x * CELL_W`; aus `null` wuerde dort `0`.
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(readPageSettings(server.config).mode).toBe(LAYOUT_RESPONSIVE)
    expect(server.config.widgets.map((x) => [x.id, x.x, x.y, x.w, x.h])).toEqual([
      ['a', 0, 0, 3, 2],
      ['b', 4, 0, 3, 2],
      ['c', 4, 4, 3, 2],
    ])
  })

  it('sagt im responsiven Modus an, dass die Koordinaten nicht wirken - und bleibt dabei', async () => {
    const w = await mountCanvas()
    expect(w.find('[data-testid="editor-canvas-mode-hint"]').exists()).toBe(false)
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-mode-hint"]').text()).toContain('wirken')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    // Der Hinweis beschreibt einen ZUSTAND, keine bevorstehende Loeschung - er
    // bleibt deshalb stehen, solange die Seite responsiv ist.
    expect(w.find('[data-testid="editor-canvas-mode-hint"]').exists()).toBe(true)
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_PIXEL)
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-mode-hint"]').exists()).toBe(false)
  })

  it('gibt beim Wechsel zurueck auf Pixel genau die alte Lage zurueck', async () => {
    // Der schwerste Fund aus Runde 2: der Rueckweg dichtete JEDER Kachel
    // `0/0/2/2` an - sieben Kacheln uebereinander auf demselben Punkt -, und der
    // naechste „Speichern"-Klick schrieb das fest. Es gibt nichts zu erfinden,
    // wenn nichts verworfen wurde.
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    w.unmount()

    const zweiter = await mountAgainstServer()
    await byLabel(zweiter, 'Layout-Modus').setValue(LAYOUT_PIXEL)
    await flushPromises()
    expect(boxOf(zweiter, 'a')).toEqual({ x: 0, y: 0, w: 3, h: 2 })
    expect(boxOf(zweiter, 'b')).toEqual({ x: 4, y: 0, w: 3, h: 2 })
    expect(boxOf(zweiter, 'c')).toEqual({ x: 4, y: 4, w: 3, h: 2 })
    // Und kein Hinweis auf eine erfundene Lage - es wurde keine erfunden.
    expect(zweiter.find('[data-testid="editor-canvas-placed-hint"]').exists()).toBe(false)
  })

  it('sagt es an, wenn er einer Kachel doch eine Vorgabe-Lage geben muss', async () => {
    // Die letzte Sicherung: eine Zeile, die am Modell vorbei geschrieben wurde
    // (direkter DB-Zugriff, ein altes Restore). Der Editor darf sie zeichnen -
    // aber nicht so tun, als haette der Autor diese Lage gesetzt.
    server.config = { ...pageConfig([widget('a', 0, 0), { id: 'b', name: 'Kachel b', type: 'Toggle', config: {} }]) }
    wireServer()
    const w = await mountAgainstServer()
    expect(boxOf(w, 'b')).toEqual({ x: 0, y: 0, w: 2, h: 2 })
    const hinweis = w.find('[data-testid="editor-canvas-placed-hint"]')
    expect(hinweis.exists()).toBe(true)
    expect(hinweis.text()).toContain('1')
  })

  it('schickt der Vorschau den Modus mit, statt ihr die Koordinaten wegzunehmen', async () => {
    // Die Vorschau bildet den Entwurf mit denselben Funktionen ab wie die echte
    // Visu (`mapTree`/`composeLayers`), und die lesen `layout_mode`. Wer hier
    // vorher loescht, zeigt ein Bild, das der gespeicherte Stand nicht haette.
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    const draft = w.emitted('draft').at(-1)[0]
    expect(draft.skin).toBe('edomi')
    expect(draft.nodes[0].page_config.layout_mode).toBe(LAYOUT_RESPONSIVE)
    expect(draft.nodes[0].page_config.widgets[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 3, h: 2 })
  })

  it('schickt der Vorschau reine Daten - ein Vue-Proxy kaeme nie an', async () => {
    // MG9 aus der Kritik zu Runde 2: der `DataCloneError`-Fix hing allein an der
    // manuellen E2E-Bahn. `postMessage` klont strukturiert, und der Algorithmus
    // lehnt einen reaktiven Proxy ab - der Entwurf kommt aus `ref()`/`reactive()`.
    // C1 hat fuer denselben Fehler denselben Waechter; hier ist er nachgezogen.
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    for (const [draft] of w.emitted('draft')) {
      expect(() => structuredClone(draft)).not.toThrow()
    }
  })
})

describe('E17 - Breakpoints in den Seiteneigenschaften', () => {
  it('nimmt eine Breakpoint-Liste an und speichert sie', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Breakpoints').setValue('360, 900')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(readPageSettings(server.config).breakpoints).toEqual([360, 900])
    expect(w.find('[data-testid="editor-canvas-saved"]').text()).toContain('Gespeichert')
  })

  it('haelt die Seiteneigenschaften auch auf einer Seite OHNE Widgets', async () => {
    // Genau der Fall, den das alte Modell nicht konnte: es gab keinen Traeger,
    // und der Editor meldete trotzdem „Gespeichert".
    const w = await mountCanvas([])
    await byLabel(w, 'Breakpoints').setValue('333, 666')
    await byLabel(w, 'Rasterweite').setValue('37')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-saved"]').exists()).toBe(true)
    expect(readPageSettings(server.config).breakpoints).toEqual([333, 666])
    expect(readPageSettings(server.config).grid).toBe(37)

    w.unmount()
    const second = await mountAgainstServer()
    expect(byLabel(second, 'Breakpoints').element.value).toBe('333, 666')
    expect(byLabel(second, 'Rasterweite').element.value).toBe('37')
  })

  it('bietet jeden Breakpoint als Vorschau-Breite an', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Breakpoints').setValue('480, 768, 1024')
    await flushPromises()
    const values = byLabel(w, 'Vorschau-Breite')
      .findAll('option')
      .map((o) => o.attributes('value'))
    expect(values).toEqual(['', '480', '768', '1024'])
  })

  it('meldet die gewaehlte Vorschau-Breite nach aussen', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Breakpoints').setValue('480, 768, 1024')
    await flushPromises()
    await byLabel(w, 'Vorschau-Breite').setValue('480')
    expect(w.emitted('preview-width').at(-1)).toEqual([480])
    await byLabel(w, 'Vorschau-Breite').setValue('')
    expect(w.emitted('preview-width').at(-1)).toEqual([null])
  })

  it('liest die gespeicherten Breakpoints beim naechsten Laden wieder', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Breakpoints').setValue('360, 900')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    w.unmount()

    const second = await mountAgainstServer()
    expect(byLabel(second, 'Breakpoints').element.value).toBe('360, 900')
  })

  it('meldet einen Speicherfehler sichtbar, statt „Gespeichert" zu behaupten', async () => {
    const w = await mountCanvas()
    savePage.mockRejectedValue(new Error('nein'))
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-saved"]').exists()).toBe(false)
    expect(w.find('[data-testid="editor-canvas-error"]').exists()).toBe(true)
  })

  it('meldet KEIN „Gespeichert", wenn dem Server eine KOORDINATE abhanden kommt', async () => {
    // Die Kante aus der Kritik zu Runde 2: `confirmed()` verglich nur die
    // Seiteneigenschaften und die Id-Reihenfolge. Ginge im Pixel-Modus eine
    // Koordinate verloren, stuende trotzdem „Gespeichert" da - dieselbe Klasse
    // Fehler, gegen die diese Runde angetreten ist, nur eine Ebene tiefer.
    const w = await mountCanvas()
    savePage.mockImplementation(async (id, config) => {
      const abgelegt = normalizeOnServer(config)
      abgelegt.widgets[0] = { ...abgelegt.widgets[0], x: abgelegt.widgets[0].x + 1 }
      server.config = abgelegt
      return { status: 204 }
    })
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-saved"]').exists()).toBe(false)
    expect(w.find('[data-testid="editor-canvas-error"]').exists()).toBe(true)
  })

  it('meldet KEIN „Gespeichert", wenn die Seite danach etwas anderes traegt', async () => {
    // Der Kern des Fundes aus Runde 1: ein 204 ist kein Beleg. Hier nimmt der
    // „Server" die Einstellung stillschweigend nicht an - der Editor muss das
    // merken, statt Erfolg zu melden.
    const w = await mountCanvas()
    savePage.mockImplementation(async () => ({ status: 204 }))
    await byLabel(w, 'Breakpoints').setValue('360, 900')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-saved"]').exists()).toBe(false)
    expect(w.find('[data-testid="editor-canvas-error"]').exists()).toBe(true)
  })
})

describe('Layer-Sichtbarkeit - was unter dieser Seite liegt', () => {
  async function mountWithLayers() {
    server.config = normalizeOnServer({ ...pageConfig([widget('a', 0, 0)]), includes: ['i1'] })
    server.tree = [
      { id: 'p1', name: 'M5 Home', kind: 'normal' },
      { id: 'g1', name: 'Kopfzeile', kind: 'globalInclude' },
      { id: 'i1', name: 'Fusszeile', kind: 'normal' },
    ]
    server.pages = {
      g1: normalizeOnServer(pageConfig([widget('gw', 10, 10)])),
      i1: normalizeOnServer(pageConfig([widget('iw', 20, 20)])),
    }
    wireServer()
    return mountAgainstServer()
  }

  it('bietet beide Layer als beschriftete Schalter an', async () => {
    const w = await mountWithLayers()
    expect(byLabel(w, 'Globale Layer')).not.toBeNull()
    expect(byLabel(w, 'Include-Layer')).not.toBeNull()
  })

  it('stellt die Layer-Knoten in den Entwurf, damit die Vorschau sie stapelt', async () => {
    const w = await mountWithLayers()
    const draft = w.emitted('draft').at(-1)[0]
    expect(draft.nodes.map((n) => n.id)).toEqual(['p1', 'g1', 'i1'])
  })

  it('zeichnet die fremden Kacheln als nicht anfassbare Umrisse, nicht als eigene', async () => {
    const w = await mountWithLayers()
    expect(order(w)).toEqual(['a'])
    expect(w.findAll('.editor-canvas [data-layer-el]')).toHaveLength(2)
  })

  it('blendet den globalen Layer aus - Canvas und Entwurf zugleich', async () => {
    const w = await mountWithLayers()
    await byLabel(w, 'Globale Layer').setValue(false)
    await flushPromises()
    const draft = w.emitted('draft').at(-1)[0]
    expect(draft.nodes.map((n) => n.id)).toEqual(['p1', 'i1'])
    expect(draft.nodes[0].page_config.ignore_global_includes).toBe(true)
    expect(w.findAll('.editor-canvas [data-layer-el]')).toHaveLength(1)
  })

  it('blendet den Include-Layer aus', async () => {
    const w = await mountWithLayers()
    await byLabel(w, 'Include-Layer').setValue(false)
    await flushPromises()
    const draft = w.emitted('draft').at(-1)[0]
    expect(draft.nodes.map((n) => n.id)).toEqual(['p1', 'g1'])
    expect(draft.nodes[0].page_config.includes).toEqual([])
  })

  it('holt fuer ein Popup keinen globalen Boden (R9)', async () => {
    server.kind = 'popup'
    const w = await mountWithLayers()
    const draft = w.emitted('draft').at(-1)[0]
    expect(draft.nodes.map((n) => n.id)).toEqual(['p1', 'i1'])
  })

  it('meldet einen Fehlschlag, statt „diese Seite hat keine Layer" vorzutaeuschen', async () => {
    server.config = normalizeOnServer(pageConfig([widget('a', 0, 0)]))
    wireServer()
    getTree.mockRejectedValue(new Error('kaputt'))
    const w = await mountAgainstServer()
    expect(w.find('[data-testid="editor-canvas-layers-error"]').exists()).toBe(true)
    // Der Canvas steht trotzdem - die Layer sind eine Zugabe, keine Vorbedingung.
    expect(order(w)).toEqual(['a'])
  })
})

describe('Bedien-Affordanzen - was der Harness anspricht', () => {
  it('verbindet jede Beschriftung ueber for/id mit ihrem Bedienelement', async () => {
    const w = await mountCanvas()
    const labels = w.findAll('label')
    expect(labels.length).toBeGreaterThanOrEqual(8)
    for (const label of labels) {
      const target = label.attributes('for')
      expect(target, `Label „${label.text()}" ohne for-Attribut`).toBeTruthy()
      expect(w.find(`#${target}`).exists()).toBe(true)
    }
  })

  it('traegt im responsiven Modus keine Beschriftung mehr, die „X" enthaelt', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    const treffer = w.findAll('label').filter((l) => /x/i.test(l.text()))
    expect(treffer.map((l) => l.text())).toEqual([])
  })

  it('nennt jede Schaltflaeche so, wie der Harness sie sucht', async () => {
    const w = await mountCanvas()
    for (const name of ['Verteilen', 'Gleiche Größe', 'Nach vorne', 'Nach hinten', 'Speichern']) {
      expect(byButton(w, name), `Schaltflaeche „${name}" fehlt`).not.toBeNull()
    }
  })
})

describe('Wann gespeichert wird - und wann nicht', () => {
  it('schreibt eine Verschiebung im Pixel-Modus NICHT von selbst auf den Server', async () => {
    // Der Pixel-Modus ist eine Bearbeitung, kein Ablegen: die Champions dieser
    // Zeilen (Grafana, ioBroker vis-2) uebernehmen mit „Speichern". Jeder Zug
    // einzeln auf den Server naehme dem spaeteren Undo-Stapel (C5/E7) den Boden -
    // und im E2E-Harness stellte eine sofort gesicherte Verschiebung die
    // Beispielwelt fuer das naechste Szenario um (gemessen).
    const w = await mountCanvas()
    savePage.mockClear()
    await byLabel(w, 'Rasterweite').setValue('20')
    await drag(w, 'a', 47, 33)
    expect(boxOf(w, 'a')).toMatchObject({ x: 40, y: 40 })
    expect(savePage).not.toHaveBeenCalled()
  })

  it('speichert Z-Ordnung und Marken ebenfalls erst mit „Speichern"', async () => {
    const w = await mountCanvas()
    await pick(els(w)[0])
    savePage.mockClear()
    await byButton(w, 'Nach vorne').trigger('click')
    await byLabel(w, 'Gesperrt').setValue(true)
    await flushPromises()
    expect(savePage).not.toHaveBeenCalled()

    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(server.config.widgets.at(-1).id).toBe('a')
    expect(server.config.widgets.at(-1).config.editor.locked).toBe(true)
  })

  it('sichert das Umsortieren im responsiven Modus dagegen sofort', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    savePage.mockClear()
    await reorder(w, 'c', 'a')
    expect(savePage).toHaveBeenCalledTimes(1)
  })

  it('nimmt beim Umsortieren KEINE ungespeicherte Aenderung mit', async () => {
    // Der Fund aus Runde 1: fuenf Pfeiltasten und ein Umsortieren spaeter stand
    // `x=9` auf dem Server, obwohl niemand gespeichert hatte. Gesichert wird
    // ausschliesslich die Reihenfolge, und zwar auf dem GESPEICHERTEN Stand.
    const w = await mountCanvas()
    await pick(els(w)[0])
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    }
    await flushPromises()
    expect(boxOf(w, 'a').x).toBe(5)

    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    await reorder(w, 'c', 'a')

    expect(server.config.widgets.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(server.config.widgets.find((x) => x.id === 'a').x).toBe(0)
  })

  it('meldet es, wenn der Server die neue Reihenfolge still nicht annimmt', async () => {
    // Die zweite Kante aus der Kritik zu Runde 2: `persistOrder` las nicht
    // zurueck, sondern setzte `storedWidgets` aus der eigenen Nutzlast. Der
    // Beleg-Anspruch aus dem Kopf galt damit nur fuer die Schaltflaeche - und ein
    // stiller Fehlschlag blieb unsichtbar, obwohl genau dieser Pfad sofort
    // speichert und deshalb nie ein „Speichern" hinterher kommt.
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    const eingefroren = JSON.parse(JSON.stringify(server.config))
    savePage.mockImplementation(async () => {
      server.config = eingefroren
      return { status: 204 }
    })

    await reorder(w, 'c', 'a')

    expect(order(w)).toEqual(['c', 'a', 'b'])
    expect(w.find('[data-testid="editor-canvas-error"]').exists()).toBe(true)
  })

  it('faehrt waehrend eines Zuges hoechstens eine Anfrage zugleich', async () => {
    // Ohne Serialisierung setzte ein Drag ueber drei Nachbarn drei Anfragen ab;
    // eine verspaetete Antwort liess dann eine veraltete Reihenfolge gewinnen.
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()

    let laufend = 0
    let hoechstens = 0
    let freigeben = null
    savePage.mockImplementation(async (id, config) => {
      laufend += 1
      hoechstens = Math.max(hoechstens, laufend)
      await new Promise((resolve) => {
        freigeben = resolve
      })
      server.config = normalizeOnServer(config)
      laufend -= 1
      return { status: 204 }
    })

    const from = els(w).find((e) => e.attributes('data-el') === 'c')
    from.element.dispatchEvent(
      new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
    )
    for (const overId of ['b', 'a']) {
      const over = els(w).find((e) => e.attributes('data-el') === overId)
      over.element.dispatchEvent(
        new window.MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }),
      )
      await flushPromises()
    }
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
    freigeben()
    await flushPromises()
    freigeben()
    await flushPromises()

    expect(hoechstens).toBe(1)
    expect(server.config.widgets.map((x) => x.id)).toEqual(order(w))
  })
})
