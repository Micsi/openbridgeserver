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
 * Die BEDIEN-AFFORDANZEN sind mitgeprueft (Beschriftung + Zuordnung
 * Label→Bedienelement), weil der Playwright-Harness genau sie anspricht
 * (`getByLabel('Rasterweite')`, `getByRole('button', { name: 'Verteilen' })`).
 * Ein umbenanntes Label faellt damit hier auf und nicht erst im Browser.
 */

const getPage = vi.fn()
const getNode = vi.fn()
const savePage = vi.fn()

vi.mock('@/api/visu', () => ({
  visuApi: {
    getPage: (...args) => getPage(...args),
    getNode: (...args) => getNode(...args),
    savePage: (...args) => savePage(...args),
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

async function mountCanvas(widgets = [widget('a', 0, 0), widget('b', 4, 0), widget('c', 4, 4)]) {
  getPage.mockResolvedValue({ data: pageConfig(widgets) })
  getNode.mockResolvedValue({ data: { id: 'p1', name: 'M5 Home', kind: 'normal' } })
  savePage.mockResolvedValue({ status: 204 })
  const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
  const wrapper = mount(VisuEditorCanvas, { props: { pageId: 'p1' }, attachTo: document.body })
  await flushPromises()
  return wrapper
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

/** Maus-Drag ohne Layout: die Verschiebung steckt in den Zeigerkoordinaten. */
async function drag(wrapper, id, dx, dy) {
  const el = els(wrapper).find((e) => e.attributes('data-el') === id)
  el.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }))
  window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }))
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 100 + dx, clientY: 100 + dy }))
  await flushPromises()
}

beforeEach(() => {
  vi.resetModules()
  getPage.mockReset()
  getNode.mockReset()
  savePage.mockReset()
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
    expect(readPageSettings(savePage.mock.calls.at(-1)[1]).grid).toBe(20)
  })

  it('zeigt die Koordinaten des gewaehlten Elements als X/Y-Felder', async () => {
    const w = await mountCanvas()
    await els(w)[1].trigger('click')
    expect(byLabel(w, 'X').element.value).toBe('4')
    await byLabel(w, 'X').setValue('60')
    expect(boxOf(w, 'b').x).toBe(60)
  })
})

describe('E4 - Ausrichtlinie, Verteilen, gleiche Groesse', () => {
  it('zeigt waehrend des Ziehens eine Ausrichtlinie bei Kantendeckung', async () => {
    const w = await mountCanvas()
    const el = els(w).find((e) => e.attributes('data-el') === 'c')
    el.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 102 }))
    await flushPromises()
    expect(w.findAll('.editor-guide').length).toBeGreaterThan(0)
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 102 }))
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
    await els(w)[0].trigger('click')
    await byButton(w, 'Nach vorne').trigger('click')
    expect(order(w).at(-1)).toBe('a')
    await byButton(w, 'Nach hinten').trigger('click')
    expect(order(w)[0]).toBe('a')
  })

  it('bewegt ein gesperrtes Element nicht mehr', async () => {
    const w = await mountCanvas()
    await els(w)[0].trigger('click')
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
    await els(w)[0].trigger('click')
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(boxOf(w, 'a').x).toBe(1)
  })

  it('nimmt ein ausgeblendetes Element aus dem Entwurf, laesst es aber im Canvas', async () => {
    const w = await mountCanvas()
    await els(w)[0].trigger('click')
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

  it('sagt, welcher Modus gerendert wird', async () => {
    const w = await mountCanvas()
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('edomi')
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-mode"]').text()).toContain('ionic')
  })

  it('setzt die Reihenfolge per Drag und speichert sie sofort', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    savePage.mockClear()

    const from = els(w).find((e) => e.attributes('data-el') === 'c')
    const to = els(w).find((e) => e.attributes('data-el') === 'a')
    from.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }))
    to.element.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }))
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
    await flushPromises()

    expect(order(w)).toEqual(['c', 'a', 'b'])
    expect(savePage).toHaveBeenCalled()
    expect(savePage.mock.calls.at(-1)[1].widgets.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('haelt das Order-Array ueber ein Neuladen hinweg identisch', async () => {
    const first = await mountCanvas()
    await byLabel(first, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    const from = els(first).find((e) => e.attributes('data-el') === 'c')
    const to = els(first).find((e) => e.attributes('data-el') === 'a')
    from.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }))
    to.element.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }))
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
    await flushPromises()
    const after = order(first)
    const gespeichert = savePage.mock.calls.at(-1)[1]
    first.unmount()

    // „Neuladen" heisst: dieselbe Seite noch einmal vom Server holen.
    const second = await mountCanvas(gespeichert.widgets)
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

    const from = els(w).find((e) => e.attributes('data-el') === 'c')
    const to = els(w).find((e) => e.attributes('data-el') === 'a')
    from.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }))
    to.element.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }))
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
    await flushPromises()

    const strukturell = savePage.mock.calls.at(-1)[1]
    expect(strukturell.widgets.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(readPageSettings(strukturell).mode).toBe(LAYOUT_PIXEL)

    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(readPageSettings(savePage.mock.calls.at(-1)[1]).mode).toBe(LAYOUT_RESPONSIVE)
  })

  it('schickt der Vorschau im responsiven Modus keine Koordinaten', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    const draft = w.emitted('draft').at(-1)[0]
    expect(draft.skin).toBe('ionic')
    for (const item of draft.nodes[0].page_config.widgets) {
      expect(item.x).toBeUndefined()
      expect(item.y).toBeUndefined()
    }
  })
})

describe('E17 - Breakpoints in den Seiteneigenschaften', () => {
  it('nimmt eine Breakpoint-Liste an und speichert sie', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Breakpoints').setValue('480, 768, 1024')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(readPageSettings(savePage.mock.calls.at(-1)[1]).breakpoints).toEqual([480, 768, 1024])
    expect(w.find('[data-testid="editor-canvas-saved"]').text()).toContain('Gespeichert')
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
    await byLabel(w, 'Breakpoints').setValue('480, 768, 1024')
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    const gespeichert = savePage.mock.calls.at(-1)[1]
    w.unmount()

    const second = await mountCanvas(gespeichert.widgets)
    expect(byLabel(second, 'Breakpoints').element.value).toBe('480, 768, 1024')
  })

  it('meldet einen Speicherfehler sichtbar, statt „Gespeichert" zu behaupten', async () => {
    const w = await mountCanvas()
    savePage.mockRejectedValue(new Error('nein'))
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="editor-canvas-saved"]').exists()).toBe(false)
    expect(w.find('[data-testid="editor-canvas-error"]').exists()).toBe(true)
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
    await els(w)[0].trigger('click')
    savePage.mockClear()
    await byButton(w, 'Nach vorne').trigger('click')
    await byLabel(w, 'Gesperrt').setValue(true)
    await flushPromises()
    expect(savePage).not.toHaveBeenCalled()

    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    const gespeichert = savePage.mock.calls.at(-1)[1]
    expect(gespeichert.widgets.at(-1).id).toBe('a')
    expect(gespeichert.widgets.at(-1).config.editor.locked).toBe(true)
  })

  it('sichert das Umsortieren im responsiven Modus dagegen sofort', async () => {
    const w = await mountCanvas()
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()
    savePage.mockClear()
    const from = els(w).find((e) => e.attributes('data-el') === 'c')
    const to = els(w).find((e) => e.attributes('data-el') === 'a')
    from.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }))
    to.element.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }))
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }))
    await flushPromises()
    expect(savePage).toHaveBeenCalledTimes(1)
  })
})
