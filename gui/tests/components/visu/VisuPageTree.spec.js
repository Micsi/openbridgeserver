import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Der Seitenbaum des V2-Editors (M5 C1, Issue #168).
 *
 * Geprueft wird, was der Autor am Baum TUN kann - anlegen, auswaehlen,
 * verschieben, umordnen, loeschen - und was er SIEHT: Ordner und Seiten sind
 * unterscheidbar, und jede Seite traegt ihren Seitentyp als Abzeichen (R1).
 */

const TREE = [
  { id: 'eg', parent_id: null, name: 'M5 Ordner', type: 'LOCATION', kind: 'normal', order: 0, access: null },
  { id: 'gamma', parent_id: 'eg', name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal', order: 30, access: 'public' },
  { id: 'home', parent_id: 'eg', name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
  { id: 'globalA', parent_id: null, name: 'M5 Global A', type: 'PAGE', kind: 'globalInclude', order: 10, access: 'public' },
  { id: 'popupA', parent_id: null, name: 'M5 Popup Positioned', type: 'PAGE', kind: 'popup', order: 60, access: 'public' },
]

const CONFIGS = {
  gamma: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
  home: { widgets: [], includes: ['gamma'], ignore_global_includes: false, popup: null },
  globalA: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
  popupA: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
}

let visuApi
let pinia

beforeEach(() => {
  vi.resetModules()
  // Die Montage installiert IHRE eigene Pinia (aus `config.global.plugins`, siehe
  // `tests/setup.js`). Ohne dieselbe Instanz haetten Test und Komponente je einen
  // eigenen Store - und die Ansicht saehe den geladenen Baum nie.
  pinia = createPinia()
  setActivePinia(pinia)
  visuApi = {
    tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getPage: vi.fn().mockImplementation((id) => Promise.resolve({ data: { ...CONFIGS[id] } })),
    savePage: vi.fn().mockResolvedValue({ status: 204 }),
    createNode: vi.fn().mockResolvedValue({ data: { id: 'neu' } }),
    updateNode: vi.fn().mockResolvedValue({ data: {} }),
    deleteNode: vi.fn().mockResolvedValue({ status: 204 }),
    moveNode: vi.fn().mockResolvedValue({ data: {} }),
    nodeUsers: vi.fn().mockResolvedValue({ data: [] }),
    usernames: vi.fn().mockResolvedValue({ data: [] }),
  }
  vi.doMock('@/api/visu', () => ({ visuApi }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
})

async function mountTree() {
  const { useVisuEditorStore } = await import('@/stores/visuEditor')
  const store = useVisuEditorStore()
  await store.load()
  const { default: VisuPageTree } = await import('@/components/visu/VisuPageTree.vue')
  const wrapper = mount(VisuPageTree, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, store }
}

const row = (wrapper, id) => wrapper.find(`[data-node-id="${id}"]`)

describe('VisuPageTree - was der Baum zeigt', () => {
  it('zeigt jeden Knoten unter seinem Elternknoten', async () => {
    const { wrapper } = await mountTree()
    expect(row(wrapper, 'eg').exists()).toBe(true)
    expect(row(wrapper, 'eg').find('[data-node-id="home"]').exists()).toBe(true)
    expect(row(wrapper, 'eg').find('[data-node-id="popupA"]').exists()).toBe(false)
  })

  it('ordnet Geschwister nach `order` (§2.2)', async () => {
    const { wrapper } = await mountTree()
    const ids = wrapper.findAll('[data-node-id]').map((el) => el.attributes('data-node-id'))
    expect(ids.indexOf('gamma')).toBeLessThan(ids.indexOf('home'))
    expect(ids.indexOf('globalA')).toBeLessThan(ids.indexOf('popupA'))
  })

  it('unterscheidet Ordner und Seite', async () => {
    const { wrapper } = await mountTree()
    expect(row(wrapper, 'eg').attributes('data-node-type')).toBe('LOCATION')
    expect(row(wrapper, 'home').attributes('data-node-type')).toBe('PAGE')
  })

  it('traegt an jeder Seite ihren Seitentyp als Abzeichen (R1)', async () => {
    const { wrapper } = await mountTree()
    const badge = (id) => row(wrapper, id).find('.visu-node-badge').attributes('data-badge')
    expect(badge('eg')).toBe('location')
    expect(badge('home')).toBe('normal')
    expect(badge('gamma')).toBe('include')
    expect(badge('globalA')).toBe('globalInclude')
    expect(badge('popupA')).toBe('popup')
  })

  it('beschriftet jedes Abzeichen uebersetzt, nie hartcodiert', async () => {
    const { wrapper } = await mountTree()
    expect(row(wrapper, 'popupA').find('.visu-node-badge').text()).toBe('Popup')
    expect(row(wrapper, 'gamma').find('.visu-node-badge').text()).toBe('Inkludeseite')
  })

  it('markiert den ausgewaehlten Knoten', async () => {
    const { wrapper, store } = await mountTree()
    await store.select('home')
    await flushPromises()
    expect(row(wrapper, 'home').attributes('aria-selected')).toBe('true')
    expect(row(wrapper, 'gamma').attributes('aria-selected')).toBe('false')
  })
})

describe('VisuPageTree - was der Autor am Baum tun kann', () => {
  it('waehlt einen Knoten per Klick aus', async () => {
    const { wrapper, store } = await mountTree()
    await row(wrapper, 'popupA').find('.visu-node-label').trigger('click')
    await flushPromises()
    expect(store.selectedId).toBe('popupA')
  })

  it('legt eine Seite unter dem ausgewaehlten Ordner an', async () => {
    const { wrapper, store } = await mountTree()
    await store.select('eg')
    await flushPromises()
    await wrapper.find('[data-testid="visu-tree-new-page"]').trigger('click')
    expect(store.draft).toMatchObject({ id: null, type: 'PAGE', parentId: 'eg' })
  })

  it('legt eine Seite neben der ausgewaehlten Seite an, nicht darunter', async () => {
    const { wrapper, store } = await mountTree()
    await store.select('home')
    await flushPromises()
    await wrapper.find('[data-testid="visu-tree-new-page"]').trigger('click')
    expect(store.draft.parentId).toBe('eg')
  })

  it('legt einen Ordner an', async () => {
    const { wrapper, store } = await mountTree()
    await wrapper.find('[data-testid="visu-tree-new-folder"]').trigger('click')
    expect(store.draft).toMatchObject({ id: null, type: 'LOCATION', parentId: null })
  })

  it('schiebt einen Knoten in der Reihenfolge nach oben', async () => {
    const { wrapper } = await mountTree()
    await row(wrapper, 'home').find('[data-action="up"]').trigger('click')
    await flushPromises()
    expect(visuApi.updateNode).toHaveBeenCalledWith('home', { order: 30 })
  })

  it('schiebt einen Knoten in der Reihenfolge nach unten', async () => {
    const { wrapper } = await mountTree()
    await row(wrapper, 'gamma').find('[data-action="down"]').trigger('click')
    await flushPromises()
    expect(visuApi.updateNode).toHaveBeenCalledWith('gamma', { order: 40 })
  })

  it('verschiebt einen Knoten unter einen anderen Elternknoten', async () => {
    const { wrapper } = await mountTree()
    const select = row(wrapper, 'popupA').find('[data-action="move"]')
    await select.setValue('eg')
    await flushPromises()
    expect(visuApi.moveNode).toHaveBeenCalledWith('popupA', { new_parent_id: 'eg', order: 60 })
  })

  it('bietet keinen Knoten aus dem eigenen Teilbaum als Ziel an', async () => {
    const { wrapper } = await mountTree()
    const values = row(wrapper, 'eg')
      .find('[data-action="move"]')
      .findAll('option')
      .map((o) => o.attributes('value'))
    // '' ist die Wurzel; `eg`, `gamma` und `home` fehlen - der eigene Teilbaum.
    expect(values).toEqual(['', 'globalA', 'popupA'])
  })

  it('loescht einen Knoten erst nach einer Rueckfrage', async () => {
    const { wrapper } = await mountTree()
    await row(wrapper, 'popupA').find('[data-action="delete"]').trigger('click')
    await flushPromises()
    expect(visuApi.deleteNode).not.toHaveBeenCalled()

    await wrapper.find('[data-testid="visu-tree-delete-confirm"]').trigger('click')
    await flushPromises()
    expect(visuApi.deleteNode).toHaveBeenCalledWith('popupA')
  })

  it('nimmt die Rueckfrage zurueck, ohne zu loeschen', async () => {
    const { wrapper } = await mountTree()
    await row(wrapper, 'popupA').find('[data-action="delete"]').trigger('click')
    await wrapper.find('[data-testid="visu-tree-delete-cancel"]').trigger('click')
    await flushPromises()
    expect(visuApi.deleteNode).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="visu-tree-delete-confirm"]').exists()).toBe(false)
  })

  it('nennt in der Rueckfrage den Namen, damit niemand die falsche Seite loescht', async () => {
    const { wrapper } = await mountTree()
    await row(wrapper, 'popupA').find('[data-action="delete"]').trigger('click')
    expect(wrapper.find('[data-testid="visu-tree-delete-dialog"]').text()).toContain(
      'M5 Popup Positioned',
    )
  })
})

describe('VisuPageTree - der leere Baum', () => {
  it('zeigt einen Hinweis statt einer leeren Flaeche', async () => {
    visuApi.tree.mockResolvedValue({ data: [] })
    const { wrapper } = await mountTree()
    expect(wrapper.find('[data-testid="visu-tree-empty"]').exists()).toBe(true)
  })

  it('laesst trotzdem eine Seite anlegen', async () => {
    visuApi.tree.mockResolvedValue({ data: [] })
    const { wrapper, store } = await mountTree()
    await wrapper.find('[data-testid="visu-tree-new-page"]').trigger('click')
    expect(store.draft).toMatchObject({ id: null, type: 'PAGE', parentId: null })
  })
})
