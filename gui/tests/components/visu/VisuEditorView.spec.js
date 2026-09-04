import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Admin-Gate des Visu-Editors (C4, Issue #171).
 *
 * Der Editor lebt in der Admin-GUI, weil hier die Berechtigungen ausgewertet
 * werden (§2.4). Ein Nicht-Admin sieht den Bereich nicht — weder die Vorschau
 * noch den Menuepunkt.
 */

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('@/stores/auth')
  vi.doUnmock('vue-router')
  vi.doUnmock('@/components/ui/VisuIcon.vue')
  vi.doUnmock('@/stores/websocket')
  vi.doUnmock('@/stores/navLinks')
  vi.doUnmock('@/stores/adapters')
})

async function mountEditor({ isLoggedIn = true, isAdmin = true } = {}) {
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn, isAdmin, username: 'admin', loadMe: vi.fn() }),
  }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const { default: VisuEditorView } = await import('@/views/VisuEditorView.vue')
  const wrapper = mount(VisuEditorView, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

describe('VisuEditorView — Admin-Gate', () => {
  it('zeigt einem Admin die Vorschau', async () => {
    const w = await mountEditor({ isAdmin: true })
    expect(w.find('[data-testid="visu-editor"]').exists()).toBe(true)
    expect(w.find('[data-testid="visu-preview-frame"]').exists()).toBe(true)
  })

  it('zeigt einem Nicht-Admin nichts vom Editor', async () => {
    const w = await mountEditor({ isLoggedIn: true, isAdmin: false })
    expect(w.find('[data-testid="visu-editor"]').exists()).toBe(false)
    expect(w.find('[data-testid="visu-preview-frame"]').exists()).toBe(false)
    expect(w.find('iframe').exists()).toBe(false)
  })

  it('zeigt einem Gast nichts vom Editor', async () => {
    const w = await mountEditor({ isLoggedIn: false, isAdmin: false })
    expect(w.find('[data-testid="visu-editor"]').exists()).toBe(false)
    expect(w.find('iframe').exists()).toBe(false)
  })

  it('haengt die Session nie an die iframe-URL', async () => {
    globalThis.localStorage.setItem('access_token', 'admin-token-xyz')
    const w = await mountEditor({ isAdmin: true })
    const src = w.find('[data-testid="visu-preview-frame"]').attributes('src')
    expect(src).toBeTruthy()
    expect(src).not.toContain('admin-token-xyz')
    expect(src).not.toContain('token')
    globalThis.localStorage.removeItem('access_token')
  })
})

async function mountSidebar({ isLoggedIn = true, isAdmin = true } = {}) {
  vi.doMock('vue-router', () => ({ useRoute: () => ({ path: '/', name: 'Dashboard' }) }))
  vi.doMock('@/components/ui/VisuIcon.vue', () => ({ default: { template: '<span class="visu-icon" />' } }))
  vi.doMock('@/stores/websocket', () => ({ useWebSocketStore: () => ({ connected: true }) }))
  vi.doMock('@/stores/navLinks', () => ({ useNavLinksStore: () => ({ links: [], load: vi.fn().mockResolvedValue([]) }) }))
  vi.doMock('@/stores/adapters', () => ({
    useAdapterStore: () => ({ instances: [], fetchAdapters: vi.fn().mockResolvedValue([]) }),
  }))
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn, isAdmin, username: 'admin' }),
  }))

  const pinia = createPinia()
  setActivePinia(pinia)
  const { default: Sidebar } = await import('@/components/layout/Sidebar.vue')
  const wrapper = mount(Sidebar, {
    props: { collapsed: false },
    global: {
      plugins: [pinia],
      stubs: { RouterLink: { template: '<a :href="to" v-bind="$attrs"><slot /></a>', props: ['to'] } },
    },
  })
  await flushPromises()
  return wrapper
}

describe('Sidebar — Menuepunkt Visu-Editor', () => {
  it('zeigt einem Admin den Menuepunkt', async () => {
    const w = await mountSidebar({ isAdmin: true })
    expect(w.find('[data-testid="nav-visu-editor"]').exists()).toBe(true)
  })

  it('zeigt einem Nicht-Admin den Menuepunkt nicht', async () => {
    const w = await mountSidebar({ isLoggedIn: true, isAdmin: false })
    expect(w.find('[data-testid="nav-visu-editor"]').exists()).toBe(false)
  })

  it('zeigt einem Gast den Menuepunkt nicht', async () => {
    const w = await mountSidebar({ isLoggedIn: false, isAdmin: false })
    expect(w.find('[data-testid="nav-visu-editor"]').exists()).toBe(false)
  })

  it('laesst die bestehenden Menuepunkte unberuehrt', async () => {
    const w = await mountSidebar({ isAdmin: false })
    expect(w.find('[data-testid="nav-home"]').exists()).toBe(true)
    expect(w.find('[data-testid="nav-datapoints"]').exists()).toBe(true)
  })
})
