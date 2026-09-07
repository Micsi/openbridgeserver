import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import VisuEditorView from '@/views/VisuEditorView.vue'

/**
 * DER WEG, DEN E10 IM BROWSER GEHT - hier ohne Browser (Nachzug M5 C3, #170).
 *
 * Der Fund: Element im Canvas anklicken, umbenennen, Datenpunkt binden,
 * Sichtbarkeitsregel setzen, ein Widget aus der Palette holen, „Speichern" im
 * Canvas -> Quittung „Gespeichert", und `GET /visu/pages/<id>` danach byteweise
 * der alte Stand. Der Autorenteil hatte keinen Schreibweg, und die Quittung war
 * ein falscher Erfolg.
 *
 * Diese Probe faehrt genau diese Reihenfolge an der ZUSAMMENGESETZTEN Ansicht
 * (nicht an den Einzelteilen) gegen einen „Server", der wie das echte Backend
 * ablegt und wieder herausgibt. Sie ist die Vitest-Haelfte von E10; die andere
 * ist das Playwright-Szenario, das seit diesem Nachzug faehrt.
 */

const PAGE = 'node-vorlage'

const TREE = [
  { id: PAGE, parent_id: null, name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal', order: 30, access: 'public' },
]

const DP = { id: 'dp-1', name: 'dp-m5-solo', data_type: 'FLOAT', unit: '°C', value: 21.5, quality: 'good' }

const WIDGET = {
  id: 'w-gamma',
  name: 'M5 Gamma Item',
  type: 'Toggle',
  datapoint_id: null,
  status_datapoint_id: null,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  config: {},
}

const BOX_DEFAULTS = { x: 0, y: 0, w: 2, h: 2 }

/** Die Ablage des Backends, nachgezogen (`obs/models/visu.py` -> `PageConfig`). */
function normalizeOnServer(config) {
  const next = JSON.parse(JSON.stringify(config ?? {}))
  next.layout_mode = ['pixel', 'responsive'].includes(next.layout_mode) ? next.layout_mode : 'pixel'
  next.grid = Math.max(1, Math.round(Number(next.grid ?? 8)) || 1)
  next.breakpoints = [...new Set((next.breakpoints ?? [480, 768, 1024]).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  )
  next.skin = (typeof next.skin === 'string' ? next.skin.trim() : '') || null
  next.includes = [...new Set(next.includes ?? [])]
  next.ignore_global_includes = next.ignore_global_includes === true
  next.popup = next.popup ?? null
  next.widgets = (next.widgets ?? []).map((w) => {
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

const welt = vi.hoisted(() => ({ routeParams: {}, page: null, puts: 0 }))

vi.mock('vue-router', () => ({ useRoute: () => ({ params: welt.routeParams, meta: {} }) }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isLoggedIn: true, isAdmin: true, username: 'admin', loadMe: vi.fn() }),
}))
vi.mock('@/api/visu', () => {
  const getPage = vi.fn(async (id) => {
    if (id !== PAGE) throw new Error('404')
    return { data: JSON.parse(JSON.stringify(welt.page)) }
  })
  const getTree = vi.fn(async () => ({ data: TREE }))
  const getNode = vi.fn(async (id) => ({ data: TREE.find((n) => n.id === id) }))
  return {
    visuApi: {
      tree: getTree,
      getTree,
      page: getPage,
      getPage,
      node: getNode,
      getNode,
      savePage: vi.fn(async (id, config) => {
        welt.puts += 1
        welt.page = normalizeOnServer(config)
        return { status: 204 }
      }),
      usernames: vi.fn(async () => ({ data: [] })),
      nodeUsers: vi.fn(async () => ({ data: [] })),
      pageVersions: vi.fn(async () => ({ data: [] })),
      createNode: vi.fn(),
      updateNode: vi.fn(),
      deleteNode: vi.fn(),
      moveNode: vi.fn(),
    },
  }
})
vi.mock('@/api/client', () => ({
  default: {},
  dpApi: { value: vi.fn(async () => ({ data: { value: 21.5 } })) },
  searchApi: {
    search: vi.fn(async ({ q }) => ({ data: { items: !q || DP.name.includes(q) ? [DP] : [] } })),
  },
  systemApi: { datatypes: vi.fn(async () => ({ data: [{ name: 'FLOAT' }] })) },
}))
vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => ({
    connect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onValue: () => () => {},
  }),
}))

beforeEach(() => {
  welt.routeParams = { pageId: PAGE }
  welt.puts = 0
  welt.page = normalizeOnServer({
    grid_cols: 12,
    grid_row_height: 80,
    grid_cell_width: 80,
    background: null,
    widgets: [{ ...WIDGET }],
    includes: [],
    ignore_global_includes: true,
    popup: null,
  })
})

async function mountEditor() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const w = mount(VisuEditorView, {
    global: {
      plugins: [pinia],
      stubs: { VisuPreviewFrame: { name: 'VisuPreviewFrame', props: ['draft'], template: '<div />' } },
    },
    attachTo: document.body,
  })
  await flushPromises()
  await flushPromises()
  return w
}

const canvasEls = (w) => w.findAll('.editor-canvas [data-el]')
const bindungsformular = (w) => w.find('[data-testid="visu-binding-form"]')

/** „Speichern" der Canvas-Werkzeugleiste - nicht das der Seiteneigenschaften. */
function saveCanvas(w) {
  const canvas = w.find('[data-testid="visu-editor-canvas"]')
  return canvas.findAll('button').find((b) => b.text().includes('Speichern'))
}
const canvasQuittung = (w) => w.find('[data-testid="editor-canvas-saved"]')

async function speichern(w) {
  await saveCanvas(w).trigger('click')
  await flushPromises()
  await flushPromises()
}

/** Ein Element im Canvas anklicken, so wie es ein echter Zeiger tut. */
async function klickeImCanvas(w, index = 0) {
  canvasEls(w)[index].element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
  )
  await flushPromises()
}

describe('E10 ohne Browser - der Autorenteil erreicht die Spalte', () => {
  it('oeffnet das Bindungsformular des Elements, das im Canvas angeklickt wurde', async () => {
    const w = await mountEditor()
    expect(bindungsformular(w).exists()).toBe(false)

    await klickeImCanvas(w)
    expect(bindungsformular(w).exists()).toBe(true)
    expect(bindungsformular(w).find('.binding-name').element.value).toBe('M5 Gamma Item')
  })

  it('speichert einen umbenannten Namen und liest ihn nach einem Neuladen zurueck', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.binding-name').setValue('M5 Gamma Umbenannt')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets[0].name).toBe('M5 Gamma Umbenannt')

    w.unmount()
    const zweiter = await mountEditor()
    expect(canvasEls(zweiter)[0].text()).toContain('M5 Gamma Umbenannt')
  })

  it('speichert die Datenpunkt-Bindung (E11)', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.binding-field[data-field="datapoint_id"] .dp-picker-open').trigger('click')
    await flushPromises()
    await bindungsformular(w)
      .find('.binding-field[data-field="datapoint_id"] .dp-picker-search')
      .setValue('dp-m5-solo')
    await flushPromises()
    await bindungsformular(w).find('.binding-field[data-field="datapoint_id"] .dp-picker-item').trigger('click')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets[0].datapoint_id).toBe('dp-1')
  })

  it('speichert die Sichtbarkeitsregel (E16)', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.visibility-toggle').trigger('click')
    await flushPromises()
    await bindungsformular(w).find('.visibility-datapoint').setValue('dp-m5-solo')
    await flushPromises()
    await bindungsformular(w).find('.visibility-op').setValue('gt')
    await bindungsformular(w).find('.visibility-threshold').setValue('30')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets[0].config.visible_when).toEqual({
      datapoint_id: 'dp-1',
      op: 'gt',
      value: 30,
    })
  })

  it('speichert ein Element, das gerade erst aus der Palette kam', async () => {
    const w = await mountEditor()
    await w.find('.widget-palette-item[data-type="sensor"]').trigger('click')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets.map((x) => x.type)).toEqual(['Toggle', 'ValueDisplay'])

    w.unmount()
    const zweiter = await mountEditor()
    expect(canvasEls(zweiter)).toHaveLength(2)
  })

  it('setzt fuer die ganze Bearbeitung GENAU EINEN Schreibweg ab (#187)', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.binding-name').setValue('M5 Gamma Umbenannt')
    await flushPromises()
    await w.find('.widget-palette-item[data-type="sensor"]').trigger('click')
    await flushPromises()

    // Bis hierher ist nichts hinausgegangen - der Entwurf ist kein Schreiber.
    expect(welt.puts).toBe(0)
    await speichern(w)
    expect(welt.puts).toBe(1)
  })

  it('nimmt dem Canvas seine Lage nicht weg, wenn der Autorenteil etwas aendert', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    // Der Canvas setzt die X-Koordinate ueber sein Zahlenfeld ...
    const xFeld = w.find('#editor-canvas-x')
    expect(xFeld.exists()).toBe(true)
    await xFeld.setValue('40')
    await flushPromises()
    // ... und das Bindungsformular benennt danach um.
    await bindungsformular(w).find('.binding-name').setValue('M5 Gamma Umbenannt')
    await flushPromises()

    await speichern(w)
    expect(welt.page.widgets[0]).toMatchObject({ name: 'M5 Gamma Umbenannt', x: 40 })
  })
})
