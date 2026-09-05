import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

/**
 * Der Visu-Editor als Flaeche (M5 C1, Issue #168).
 *
 * C4 hat die Ansicht als Vorschau-Gate geliefert; C1 haengt Baum und
 * Seiteneigenschaften daneben. Geprueft wird hier NUR, was C1 dazugetan hat:
 * die Route mit Seiten-ID, die drei Flaechen, der Einhaengepunkt fuer den Canvas
 * (Teil C2) und der Entwurf, der in die Vorschau geht. Das Admin-Gate und der
 * Vorfahrenpfad des Vorschaurahmens stehen weiterhin in
 * `tests/components/visu/VisuEditorView.spec.js` und bleiben unberuehrt.
 */

const TREE = [
  { id: 'home', parent_id: null, name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
  { id: 'popupA', parent_id: null, name: 'M5 Popup Positioned', type: 'PAGE', kind: 'popup', order: 60, access: 'public' },
]

const CONFIGS = {
  home: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
  popupA: { widgets: [], includes: [], ignore_global_includes: false, popup: { x: 140, y: 90, w: null, h: null, auto_close_ms: null, modal: false, animate: false, shadow: false, dim_backdrop: false } },
}

let visuApi
let route

beforeEach(() => {
  vi.resetModules()
  setActivePinia(createPinia())
  // REAKTIV: die Ansicht beobachtet `route.params.pageId`; ein einfaches Objekt
  // wuerde den Beobachter nie ausloesen, und der Adresswechsel bliebe ungeprueft.
  route = reactive({ params: {} })
  visuApi = {
    tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getPage: vi.fn().mockImplementation((id) => Promise.resolve({ data: JSON.parse(JSON.stringify(CONFIGS[id])) })),
    savePage: vi.fn().mockResolvedValue({ status: 204 }),
    createNode: vi.fn().mockResolvedValue({ data: { id: 'neu' } }),
    updateNode: vi.fn().mockResolvedValue({ data: {} }),
    deleteNode: vi.fn().mockResolvedValue({ status: 204 }),
    moveNode: vi.fn().mockResolvedValue({ data: {} }),
    nodeUsers: vi.fn().mockResolvedValue({ data: [] }),
    usernames: vi.fn().mockResolvedValue({ data: [] }),
  }
  vi.doMock('@/api/visu', () => ({ visuApi }))
  vi.doMock('vue-router', () => ({
    useRoute: () => route,
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
  vi.doUnmock('vue-router')
  vi.doUnmock('@/stores/auth')
})

async function previewFrameComponent() {
  return (await import('@/components/visu/VisuPreviewFrame.vue')).default
}

async function mountEditor({ isAdmin = true, pageId } = {}) {
  if (pageId) route.params = { pageId }
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn: true, isAdmin, username: 'admin', loadMe: vi.fn() }),
  }))
  const { default: VisuEditorView } = await import('@/views/VisuEditorView.vue')
  const wrapper = mount(VisuEditorView)
  await flushPromises()
  return wrapper
}

describe('VisuEditorView - die Flaechen von C1', () => {
  it('zeigt Baum, Eigenschaften und den Einhaengepunkt fuer den Canvas', async () => {
    const wrapper = await mountEditor()
    expect(wrapper.find('.visu-page-tree').exists()).toBe(true)
    expect(wrapper.find('.visu-page-properties, [data-testid="visu-props-empty"]').exists()).toBe(true)
    expect(wrapper.find('.editor-canvas').exists()).toBe(true)
  })

  it('laedt den Baum genau einmal', async () => {
    await mountEditor()
    expect(visuApi.tree).toHaveBeenCalledTimes(1)
  })

  it('zeigt einem Nicht-Admin weder Baum noch Eigenschaften', async () => {
    const wrapper = await mountEditor({ isAdmin: false })
    expect(wrapper.find('.visu-page-tree').exists()).toBe(false)
    expect(wrapper.find('.editor-canvas').exists()).toBe(false)
    expect(visuApi.tree).not.toHaveBeenCalled()
  })
})

describe('VisuEditorView - die Seiten-ID in der Route', () => {
  it('waehlt die Seite aus der Adresse aus', async () => {
    const wrapper = await mountEditor({ pageId: 'popupA' })
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    expect(useVisuEditorStore().selectedId).toBe('popupA')
    expect(wrapper.find('[data-testid="visu-props-empty"]').exists()).toBe(false)
  })

  it('folgt einem Adresswechsel, ohne den Baum neu zu laden', async () => {
    await mountEditor({ pageId: 'popupA' })
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    route.params = { pageId: 'home' }
    await flushPromises()
    await flushPromises()
    expect(useVisuEditorStore().selectedId).toBe('home')
    expect(visuApi.tree).toHaveBeenCalledTimes(1)
  })

  it('vergisst die Auswahl, wenn die Adresse keine Seite mehr nennt', async () => {
    await mountEditor({ pageId: 'popupA' })
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    route.params = {}
    await flushPromises()
    await flushPromises()
    expect(useVisuEditorStore().selectedId).toBeNull()
  })

  it('kommt ohne Seiten-ID aus - der Baum steht trotzdem', async () => {
    const wrapper = await mountEditor()
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    expect(useVisuEditorStore().selectedId).toBeNull()
    expect(wrapper.find('.visu-page-tree').exists()).toBe(true)
  })
})

describe('VisuEditorView - der Entwurf geht in die Vorschau', () => {
  it('reicht den Entwurf der ausgewaehlten Seite an den Rahmen weiter', async () => {
    const wrapper = await mountEditor({ pageId: 'popupA' })
    const frame = wrapper.findComponent(await previewFrameComponent())
    expect(frame.props('draft')).toMatchObject({ pageId: 'popupA', skin: 'edomi' })
  })

  it('schickt ohne Auswahl gar keinen Entwurf', async () => {
    const wrapper = await mountEditor()
    expect(wrapper.findComponent(await previewFrameComponent()).props('draft')).toBeNull()
  })

  it('traegt der Rahmen die Marke, an der der Harness die Vorschau sucht', async () => {
    const wrapper = await mountEditor({ pageId: 'popupA' })
    expect(wrapper.find('iframe.editor-preview').exists()).toBe(true)
  })
})
