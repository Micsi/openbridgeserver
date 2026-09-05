import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import de from '@/locales/de.json'

/**
 * Der Autorenteil des Visu-Editors, zusammengesetzt (M5 C3, Issue #170).
 *
 * Die Einzelteile haben ihre eigenen Proben; hier laeuft der Weg, den ein Autor
 * wirklich geht, an der echten Ansicht - und mit ihm die beiden Messlatten,
 * soweit sie ohne Browser entscheidbar sind:
 *
 *   **E11** - Datenpunkt binden -> die Bindung steht im ENTWURF, den die Bruecke
 *   in die Vorschau schickt. Den Wert holt die Vorschau selbst am Backend; was
 *   diese Probe zeigt, ist die Naht davor: ohne die Id im Entwurf gibt es
 *   drueben nichts zu holen.
 *
 *   **E16** - Sichtbarkeitsregel setzen -> das Element verschwindet aus dem
 *   Entwurf, und ein LIVE-Wert ueber der Schwelle bringt es zurueck, ohne dass
 *   irgendetwas neu geladen wird.
 */

const PAGE = 'node-solo'

const TREE = [
  { id: PAGE, parent_id: null, name: 'M5 Solo', type: 'PAGE', kind: 'normal', order: 50, access: 'public' },
]

const WIDGET = {
  id: 'w-solo',
  name: 'M5 Solo Epsilon',
  type: 'Toggle',
  datapoint_id: null,
  status_datapoint_id: null,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  config: {},
}

const DP = { id: 'dp-1', name: 'dp-m5-solo', data_type: 'FLOAT', unit: '°C', value: 21.5, quality: 'good' }

let pageConfig
let werteHandler
let subscribeMock

beforeEach(() => {
  vi.resetModules()
  pageConfig = { widgets: [{ ...WIDGET }], includes: [], ignore_global_includes: true, popup: null }
  werteHandler = null
  subscribeMock = vi.fn()

  vi.doMock('vue-router', () => ({ useRoute: () => ({ params: { pageId: PAGE }, meta: {} }) }))
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn: true, isAdmin: true, username: 'admin', loadMe: vi.fn() }),
  }))
  vi.doMock('@/api/visu', () => ({
    visuApi: {
      tree: vi.fn(async () => ({ data: TREE })),
      page: vi.fn(async (id) => {
        if (id !== PAGE) throw new Error('404')
        return { data: pageConfig }
      }),
    },
  }))
  vi.doMock('@/api/client', () => ({
    default: {},
    dpApi: { value: vi.fn(async () => ({ data: { value: 21.5 } })) },
    searchApi: { search: vi.fn(async ({ q }) => ({ data: { items: !q || DP.name.includes(q) ? [DP] : [] } })) },
    systemApi: { datatypes: vi.fn(async () => ({ data: [{ name: 'FLOAT' }] })) },
  }))
  vi.doMock('@/stores/websocket', () => ({
    useWebSocketStore: () => ({
      connect: vi.fn(),
      subscribe: subscribeMock,
      unsubscribe: vi.fn(),
      onValue: (fn) => {
        werteHandler = fn
        return () => {
          werteHandler = null
        }
      },
    }),
  }))
})

afterEach(() => {
  vi.doUnmock('vue-router')
  vi.doUnmock('@/stores/auth')
  vi.doUnmock('@/api/visu')
  vi.doUnmock('@/api/client')
  vi.doUnmock('@/stores/websocket')
})

async function mountEditor() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { default: VisuEditorView } = await import('@/views/VisuEditorView.vue')
  const w = mount(VisuEditorView, {
    global: {
      plugins: [pinia],
      // Der Rahmen selbst gehoert C4 und hat seine eigene Probe; hier zaehlt
      // nur, WAS er als Entwurf bekommt.
      stubs: { VisuPreviewFrame: { name: 'VisuPreviewFrame', props: ['draft'], template: '<div />' } },
    },
  })
  await flushPromises()
  return w
}

/** Der Entwurf, den die Ansicht der Bruecke reicht. */
function entwurf(w) {
  return w.findComponent({ name: 'VisuPreviewFrame' }).props('draft')
}

function widgetsImEntwurf(w) {
  const d = entwurf(w)
  if (!d) return []
  return d.nodes.find((n) => n.id === PAGE).page_config.widgets
}

describe('Visu-Editor — der Autorenteil an der Seite', () => {
  it('laedt die Seite und zeigt ihre Elemente', async () => {
    const w = await mountEditor()
    expect(w.find('[data-testid="visu-widget-palette"]').exists()).toBe(true)
    expect(w.find('.editor-widget-item').text()).toBe('M5 Solo Epsilon')
    expect(entwurf(w).pageId).toBe(PAGE)
  })

  it('sagt es, wenn gar keine Seite gewaehlt ist, statt eine leere Palette zu zeigen', async () => {
    vi.doMock('vue-router', () => ({ useRoute: () => ({ params: {}, meta: {} }) }))
    const w = await mountEditor()
    expect(w.find('[data-testid="visu-editor-no-page"]').text()).toBe(de.visuEditor.pageMissing)
    expect(w.find('[data-testid="visu-editor-authoring"]').exists()).toBe(false)
  })

  it('legt ein Element aus der Palette in den Entwurf', async () => {
    const w = await mountEditor()
    await w.find('.widget-palette-item[data-type="sensor"]').trigger('click')
    await flushPromises()

    const namen = widgetsImEntwurf(w).map((widget) => widget.type)
    expect(namen).toEqual(['Toggle', 'ValueDisplay'])
    // Und das neue Element ist gleich ausgewaehlt - der Autor will es benennen.
    expect(w.find('[data-testid="visu-binding-form"]').exists()).toBe(true)
  })

  it('E11: die gewaehlte Bindung landet im Entwurf', async () => {
    const w = await mountEditor()
    await w.find('.editor-widget-item').trigger('click')
    await flushPromises()

    await w.find('.binding-field[data-field="datapoint_id"] .dp-picker-open').trigger('click')
    await flushPromises()
    await w.find('.binding-field[data-field="datapoint_id"] .dp-picker-search').setValue('dp-m5-solo')
    await flushPromises()
    expect(w.findAll('.binding-field[data-field="datapoint_id"] .dp-picker-item')).toHaveLength(1)
    await w.find('.binding-field[data-field="datapoint_id"] .dp-picker-item').trigger('click')
    await flushPromises()

    expect(widgetsImEntwurf(w)[0].datapoint_id).toBe('dp-1')
    // Der Editor abonniert den Wert, den er ab jetzt beobachtet.
    expect(subscribeMock).toHaveBeenCalledWith(['dp-1'])
  })

  it('E16: die Regel nimmt das Element aus dem Entwurf, ein Live-Wert bringt es zurueck', async () => {
    const w = await mountEditor()
    await w.find('.editor-widget-item').trigger('click')
    await flushPromises()
    await w.find('.visibility-toggle').trigger('click')
    await flushPromises()

    await w.find('.visibility-datapoint').setValue('dp-m5-solo')
    await flushPromises()
    await w.find('.visibility-op').setValue('gt')
    await w.find('.visibility-threshold').setValue('30')
    await flushPromises()

    // Der Anfangswert (21.5) kommt per REST - Bedingung nicht erfuellt.
    expect(widgetsImEntwurf(w)).toEqual([])

    // Ein Wert ueber der Schwelle kommt per WebSocket - kein Neuladen.
    expect(werteHandler).toBeTypeOf('function')
    werteHandler('dp-1', 42, 'good', Date.now())
    await flushPromises()
    expect(widgetsImEntwurf(w).map((widget) => widget.name)).toEqual(['M5 Solo Epsilon'])

    // Und wieder darunter: das Element verschwindet erneut.
    werteHandler('dp-1', 12, 'good', Date.now())
    await flushPromises()
    expect(widgetsImEntwurf(w)).toEqual([])
  })
})
