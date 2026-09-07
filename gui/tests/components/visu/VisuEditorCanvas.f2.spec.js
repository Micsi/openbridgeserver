import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { LAYOUT_RESPONSIVE } from '@/utils/visuEditorPage'

/**
 * Die GEGENRICHTUNG von Micsi/openbridgeserver#187 (Folge-Welle F2, Issue
 * #187 „kein stiller Datenverlust beim Speichern").
 *
 * Live gemessen: Skin aendern und einen Include entfernen ueber die
 * Seiteneigenschaften, speichern; danach ein Widget im Canvas umbenennen und
 * dort speichern - Skin und die gesamte Include-Liste kippten still zurueck,
 * mit gruener Quittung. Ursache: der Canvas schrieb seine Teilsicht auf dem
 * Stand des LETZTEN LADENS (`base.value`) fort, statt seinen eigenen Anteil
 * (Modus, Raster, Breakpoints, Widgets) mit dem FRISCHEN Server-Stand
 * zusammenzufuehren.
 *
 * Die HINRICHTUNG (Canvas speichert Elemente -> die Seiteneigenschaften lesen
 * danach frisch, `refreshPageConfig`) war bereits geschlossen; ihre Probe
 * steht in `gui/tests/stores/visuEditor.spec.js`. Hier steht die
 * GEGENRICHTUNG: Seiteneigenschaften speichern -> der Canvas fuehrt seinen
 * Stand vor dem naechsten eigenen Schreiben mit dem frischen Server-Stand
 * zusammen, statt eine veraltete Momentaufnahme zu verlaengern.
 *
 * Der „Server" ist wie in `VisuEditorCanvas.spec.js` ein Stand und kein
 * Stumpf: `getPage` liefert, was `savePage` zuletzt abgelegt hat. Ein
 * Speichern der Seiteneigenschaften wird hier DIREKT ueber denselben
 * `savePage`-Mock simuliert - er ist im echten Editor derselbe Schreibweg
 * (`PUT /visu/pages/{id}`), den auch das Eigenschaftsformular benutzt
 * (`utils/visuPageSavePlan.js`).
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

function pageConfig(widgets, overrides = {}) {
  return {
    grid_cols: 12,
    grid_row_height: 80,
    grid_cell_width: 80,
    background: null,
    widgets,
    includes: [],
    ignore_global_includes: false,
    popup: null,
    layout_mode: 'pixel',
    grid: 8,
    breakpoints: [480, 768, 1024],
    skin: null,
    ...overrides,
  }
}

const BOX_DEFAULTS = { x: 0, y: 0, w: 2, h: 2 }

/** Dieselbe Normalisierung wie im echten Backend (`obs/models/visu.py`). */
function normalizeOnServer(config) {
  const next = JSON.parse(JSON.stringify(config ?? {}))
  next.layout_mode = ['pixel', 'responsive'].includes(next.layout_mode) ? next.layout_mode : 'pixel'
  next.grid = Math.max(1, Math.round(Number(next.grid ?? 8)) || 1)
  next.breakpoints = [...new Set((next.breakpoints ?? [480, 768, 1024]).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  )
  next.skin = (typeof next.skin === 'string' ? next.skin.trim() : '') || null
  next.includes = Array.isArray(next.includes) ? [...next.includes] : []
  next.ignore_global_includes = next.ignore_global_includes === true
  next.popup = next.popup ?? null
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
const server = { config: null, tree: [] }

function wireServer() {
  getNode.mockImplementation(async (id) => ({ data: { id, name: 'M5 Home', kind: 'normal' } }))
  getPage.mockImplementation(async () => ({ data: JSON.parse(JSON.stringify(server.config)) }))
  savePage.mockImplementation(async (id, config) => {
    server.config = normalizeOnServer(config)
    return { status: 204 }
  })
  getTree.mockImplementation(async () => ({ data: server.tree }))
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

async function mountCanvas(widgets, overrides = {}, authoredWidgets = null) {
  server.config = normalizeOnServer(pageConfig(widgets, overrides))
  wireServer()
  return mountAgainstServer(authoredWidgets)
}

const els = (w) => w.findAll('.editor-canvas [data-el]')
const order = (w) => els(w).map((e) => e.attributes('data-el'))

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

/** Das Umsortieren des responsiven Modus: `from` faellt auf `to` (persistOrder). */
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

/** Die Seiteneigenschaften „von aussen" speichern - derselbe Schreibweg, hier direkt simuliert. */
async function speichereEigenschaftenAnderswo(patch) {
  await savePage('p1', { ...server.config, ...patch })
}

const quittung = (w) => w.find('[data-testid="editor-canvas-saved"]').exists()
const fehler = (w) => w.find('[data-testid="editor-canvas-error"]').exists()

beforeEach(() => {
  vi.resetModules()
  getPage.mockReset()
  getNode.mockReset()
  savePage.mockReset()
  getTree.mockReset()
  server.config = null
  server.tree = []
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('VisuEditorCanvas - Seiteneigenschaften ueberleben ein Speichern danach (#187, Gegenrichtung)', () => {
  it('nimmt Skin und Include-Liste NICHT zurueck, wenn die Seiteneigenschaften vorher anderswo gespeichert haben', async () => {
    const w = await mountCanvas([widget('a')], { skin: 'edomi', includes: ['welcome'] })

    // Die Seiteneigenschaften speichern (Skin -> ionic, Include entfernt),
    // OHNE dass dieser Canvas davon erfaehrt - genau die Luecke aus #187.
    await speichereEigenschaftenAnderswo({ skin: 'ionic', includes: [] })
    expect(server.config.skin).toBe('ionic')
    expect(server.config.includes).toEqual([])

    // Danach: ein Widget im Canvas umbenennen (Autorenteil) und dort speichern.
    await w.setProps({ authoredWidgets: [widget('a', { name: 'Umbenannt' })] })
    await flushPromises()
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()

    expect(server.config.widgets[0].name).toBe('Umbenannt')
    // DER FUND: bisher kippten Skin und Include-Liste hier still zurueck.
    expect(server.config.skin).toBe('ionic')
    expect(server.config.includes).toEqual([])
    expect(quittung(w)).toBe(true)
    expect(fehler(w)).toBe(false)
  })

  it('nimmt auch „ignore_global_includes" und den Popup-Deskriptor nicht zurueck', async () => {
    const popup = { x: 10, y: 10, w: 200, h: 100, auto_close_ms: null, modal: false, animate: false, shadow: true, dim_backdrop: false }
    const w = await mountCanvas([widget('a')], { ignore_global_includes: false, popup: null })

    await speichereEigenschaftenAnderswo({ ignore_global_includes: true, popup })

    await w.setProps({ authoredWidgets: [widget('a', { name: 'Umbenannt' })] })
    await flushPromises()
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()

    expect(server.config.ignore_global_includes).toBe(true)
    expect(server.config.popup).toMatchObject(popup)
    expect(quittung(w)).toBe(true)
  })

  it('setzt dafuer weiterhin GENAU EINEN Schreibvorgang ab - kein neuer Schreiber entsteht', async () => {
    const w = await mountCanvas([widget('a')], { skin: 'edomi', includes: ['welcome'] })
    await speichereEigenschaftenAnderswo({ skin: 'ionic', includes: [] })

    savePage.mockClear()
    await w.setProps({ authoredWidgets: [widget('a', { name: 'Umbenannt' })] })
    await flushPromises()
    // Der Entwurf allein schreibt nichts.
    expect(savePage).not.toHaveBeenCalled()

    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()
    expect(savePage).toHaveBeenCalledTimes(1)
  })

  it('meldet KEIN „Gespeichert", wenn der frisch zusammengefuehrte Anteil (Skin) den Server nicht erreicht', async () => {
    // Die Quittung bleibt eine ECHTE Schranke: was nicht ankommt, ist kein Erfolg.
    const w = await mountCanvas([widget('a')], { skin: 'edomi', includes: ['welcome'] })
    await speichereEigenschaftenAnderswo({ skin: 'ionic', includes: [] })

    savePage.mockImplementation(async (id, config) => {
      const abgelegt = normalizeOnServer(config)
      abgelegt.skin = 'edomi' // der Server verwirft die frische Skin-Wahl
      server.config = abgelegt
      return { status: 204 }
    })

    await w.setProps({ authoredWidgets: [widget('a', { name: 'Umbenannt' })] })
    await flushPromises()
    await byButton(w, 'Speichern').trigger('click')
    await flushPromises()

    expect(quittung(w)).toBe(false)
    expect(fehler(w)).toBe(true)
  })

  it('nimmt Skin und Includes auch bei der SOFORT-Sicherung der Reihenfolge nicht zurueck (persistOrder)', async () => {
    const w = await mountCanvas(
      [widget('a'), widget('b'), widget('c')],
      { skin: 'edomi', includes: ['welcome'] },
    )
    await byLabel(w, 'Layout-Modus').setValue(LAYOUT_RESPONSIVE)
    await flushPromises()

    await speichereEigenschaftenAnderswo({ skin: 'ionic', includes: [] })

    await reorder(w, 'c', 'a')

    expect(order(w)).toEqual(['c', 'a', 'b'])
    expect(server.config.widgets.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(server.config.skin).toBe('ionic')
    expect(server.config.includes).toEqual([])
  })
  /**
   * DIE SCHRANKE GILT FUER JEDES DER MITGEFUEHRTEN FELDER, nicht nur fuer den
   * Skin. `confirmed()` prueft seit #187 auch `includes`,
   * `ignore_global_includes` und `popup` - drei Zeilen, die bislang von keiner
   * Probe negativ abgesichert waren: sie liessen sich streichen, ohne dass ein
   * einziger Test rot wurde. Genau dieselbe Luecke, die schon zweimal ein
   * falsches „Gespeichert" ueber einem Verlust stehen liess.
   *
   * Jeder Fall laesst den Server GENAU EIN Feld verwerfen und verlangt, dass
   * die Quittung ausbleibt.
   */
  const POPUP_STAND = {
    x: 10, y: 10, w: 200, h: 100,
    auto_close_ms: null, modal: false, animate: false, shadow: true, dim_backdrop: false,
  }
  const verworfeneFelder = [
    {
      feld: 'includes',
      frisch: { includes: ['welcome', 'footer'] },
      verwirf: (abgelegt) => { abgelegt.includes = [] },
    },
    {
      feld: 'ignore_global_includes',
      frisch: { ignore_global_includes: true },
      verwirf: (abgelegt) => { abgelegt.ignore_global_includes = false },
    },
    {
      feld: 'popup',
      frisch: { popup: POPUP_STAND },
      verwirf: (abgelegt) => { abgelegt.popup = null },
    },
  ]
  for (const fall of verworfeneFelder) {
    it(`meldet KEIN „Gespeichert", wenn der Server „${fall.feld}" verwirft`, async () => {
      const w = await mountCanvas(
        [widget('a')],
        { includes: [], ignore_global_includes: false, popup: null },
      )
      await speichereEigenschaftenAnderswo(fall.frisch)

      savePage.mockImplementation(async (id, config) => {
        const abgelegt = normalizeOnServer(config)
        fall.verwirf(abgelegt)
        server.config = abgelegt
        return { status: 204 }
      })

      await w.setProps({ authoredWidgets: [widget('a', { name: 'Umbenannt' })] })
      await flushPromises()
      await byButton(w, 'Speichern').trigger('click')
      await flushPromises()

      expect(quittung(w)).toBe(false)
      expect(fehler(w)).toBe(true)
    })
  }
})
