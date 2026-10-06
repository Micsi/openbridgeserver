import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

/**
 * Der Klick im Seitenbaum oeffnet die Seite (Micsi/openbridgeserver#192).
 *
 * Der Canvas liest seine Seite allein aus der Adresse (`/visu-editor/<id>`).
 * Ein Klick im Baum setzte bisher nur die Auswahl im Store - die Eigenschaften
 * zeigten die Seite, der Canvas blieb leer und behauptete „sobald eine Seite
 * ausgewaehlt ist". Die E2E-Matrix kam nur per Deep-Link hin und sah das nie.
 */

const TREE = [
  { id: 'haus', parent_id: null, name: 'Haus', type: 'LOCATION', order: 0, access: 'public' },
  { id: 'home', parent_id: 'haus', name: 'Wohnzimmer', type: 'PAGE', kind: 'normal', order: 0, access: 'public' },
  { id: 'kueche', parent_id: 'haus', name: 'Küche', type: 'PAGE', kind: 'normal', order: 1, access: 'public' },
]

const LEER = { widgets: [], includes: [], ignore_global_includes: false, popup: null }

let visuApi
let route
let router

beforeEach(() => {
  vi.resetModules()
  setActivePinia(createPinia())
  route = reactive({ params: {} })
  // Der Router setzt die Adresse wie der echte: `push` aendert `route.params`.
  router = {
    push: vi.fn((ziel) => {
      const m = /^\/visu-editor(?:\/([^/]+))?$/.exec(ziel)
      route.params = m && m[1] ? { pageId: m[1] } : {}
      return Promise.resolve()
    }),
    replace: vi.fn(),
  }
  visuApi = {
    tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getNode: vi.fn().mockImplementation((id) => Promise.resolve({ data: TREE.find((n) => n.id === id) })),
    getPage: vi.fn().mockResolvedValue({ data: JSON.parse(JSON.stringify(LEER)) }),
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
    useRouter: () => router,
  }))
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn: true, isAdmin: true, username: 'admin', loadMe: vi.fn() }),
  }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
  vi.doUnmock('vue-router')
  vi.doUnmock('@/stores/auth')
})

async function mountEditor(pageId) {
  if (pageId) route.params = { pageId }
  const { default: VisuEditorView } = await import('@/views/VisuEditorView.vue')
  const wrapper = mount(VisuEditorView)
  await flushPromises()
  return wrapper
}

async function klick(wrapper, id) {
  await wrapper.find(`[data-node-id="${id}"] .visu-node-label`).trigger('click')
  await flushPromises()
  await flushPromises()
}

describe('VisuEditorView - der Klick im Seitenbaum (#192)', () => {
  it('oeffnet eine Seite: die Adresse nennt sie, und der Canvas-Hinweis verschwindet', async () => {
    const wrapper = await mountEditor()
    await klick(wrapper, 'home')
    expect(router.push).toHaveBeenCalledWith('/visu-editor/home')
    expect(wrapper.find('[data-testid="visu-editor-canvas-hint"]').exists()).toBe(false)
  }, 60000)

  it('wechselt von einer offenen Seite zur naechsten', async () => {
    const wrapper = await mountEditor('home')
    await klick(wrapper, 'kueche')
    expect(router.push).toHaveBeenLastCalledWith('/visu-editor/kueche')
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    expect(useVisuEditorStore().selectedId).toBe('kueche')
  }, 60000)

  it('navigiert nicht, wenn die angeklickte Seite schon offen ist', async () => {
    const wrapper = await mountEditor('home')
    await klick(wrapper, 'home')
    expect(router.push).not.toHaveBeenCalled()
  }, 60000)

  it('schliesst beim Ordner die Seite, behaelt den Ordner ausgewaehlt und sagt, warum kein Canvas da ist', async () => {
    const wrapper = await mountEditor('home')
    await klick(wrapper, 'haus')
    expect(router.push).toHaveBeenLastCalledWith('/visu-editor')
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    expect(useVisuEditorStore().selectedId).toBe('haus')
    expect(wrapper.find('[data-testid="visu-editor-folder-hint"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="visu-editor-canvas-hint"]').exists()).toBe(false)
  }, 60000)

  it('zeigt ohne Auswahl den Hinweis auf den Seitenbaum', async () => {
    const wrapper = await mountEditor()
    expect(wrapper.find('[data-testid="visu-editor-canvas-hint"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="visu-editor-folder-hint"]').exists()).toBe(false)
  }, 60000)
})
