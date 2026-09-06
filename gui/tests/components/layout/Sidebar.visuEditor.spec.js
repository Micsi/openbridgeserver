import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Der Menuepunkt zum Visu-Editor in der Admin-Navigation (M5 Teil D, #174).
 *
 * Die Zusage aus CONTRIBUTING-visu-m5.md §2.4 hat zwei Haelften, und beide
 * werden hier gefahren:
 *
 *  1. Ein angemeldeter Admin FINDET den Bereich - ueber das Menue, nicht nur
 *     ueber eine getippte Adresse.
 *  2. Ein Nicht-Admin SIEHT ihn nicht. Nicht ausgegraut, nicht mit Hinweis:
 *     gar nicht.
 *
 * `Sidebar.spec.js` deckt das nicht ab - sein Auth-Attrappe kennt kein
 * `isAdmin`, der Eintrag faellt dort also immer weg, und ein „immer sichtbar"
 * waere ihm nicht aufgefallen.
 */

const NAV_TESTID = '[data-testid="nav-visu-editor"]'
/** Der Wortlaut aus `de.json`. Exakt geprueft: `nav.visu` heisst „Visu". */
const LABEL = 'Visu-Editor'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/components/ui/VisuIcon.vue', () => ({
    default: { template: '<span class="visu-icon" />' },
  }))
})

afterEach(() => {
  vi.doUnmock('vue-router')
  vi.doUnmock('@/stores/websocket')
  vi.doUnmock('@/stores/navLinks')
  vi.doUnmock('@/stores/auth')
  vi.doUnmock('@/stores/adapters')
  vi.doUnmock('@/components/ui/VisuIcon.vue')
})

const ROUTER_LINK_STUB = {
  template: '<a :href="to" v-bind="$attrs"><slot /></a>',
  props: ['to'],
}

async function mountSidebar({ isLoggedIn = true, isAdmin = true, collapsed = false, routePath = '/' } = {}) {
  vi.doMock('vue-router', () => ({
    useRoute: () => ({ path: routePath, name: 'Dashboard' }),
  }))
  vi.doMock('@/stores/websocket', () => ({ useWebSocketStore: () => ({ connected: true }) }))
  vi.doMock('@/stores/navLinks', () => ({
    useNavLinksStore: () => ({ links: [], load: vi.fn().mockResolvedValue([]) }),
  }))
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn, isAdmin, username: 'admin' }),
  }))
  vi.doMock('@/stores/adapters', () => ({
    useAdapterStore: () => ({ instances: [], fetchAdapters: vi.fn().mockResolvedValue([]) }),
  }))

  const pinia = createPinia()
  setActivePinia(pinia)
  const { default: Sidebar } = await import('@/components/layout/Sidebar.vue')
  const wrapper = mount(Sidebar, {
    props: { collapsed },
    global: { plugins: [pinia], stubs: { RouterLink: ROUTER_LINK_STUB } },
  })
  await flushPromises()
  return wrapper
}

/**
 * Zaehlt Beschriftungen EXAKT. `wrapper.text()` traefe „Visu-Editor" auch im
 * bereits vorhandenen „Visu"-Link (Teilzeichenkette) und umgekehrt - genau die
 * Falle, die diese Welle schon einmal teuer bezahlt hat.
 *
 * Gezaehlt wird auf der BESCHRIFTUNGS-Zelle, nicht auf dem ganzen Link: dessen
 * Text traegt das Icon-Zeichen mit, und ein Vergleich auf Gleichheit koennte
 * dann nie zutreffen (gemessen).
 */
const genauSoBeschriftet = (wrapper, wort) =>
  wrapper.findAll('a span').filter((s) => s.text().trim() === wort).length

describe('Sidebar — Menuepunkt Visu-Editor', () => {
  it('zeigt einem angemeldeten Admin den Eintrag', async () => {
    const wrapper = await mountSidebar({ isLoggedIn: true, isAdmin: true })
    expect(wrapper.find(NAV_TESTID).exists()).toBe(true)
    expect(genauSoBeschriftet(wrapper, LABEL)).toBe(1)
  })

  it('verlinkt auf den Admin-Bereich des Editors', async () => {
    const wrapper = await mountSidebar({ isLoggedIn: true, isAdmin: true })
    expect(wrapper.find(NAV_TESTID).attributes('href')).toBe('/visu-editor')
  })

  it('versteckt den Eintrag vor einem angemeldeten Nicht-Admin', async () => {
    const wrapper = await mountSidebar({ isLoggedIn: true, isAdmin: false })
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)
    expect(genauSoBeschriftet(wrapper, LABEL)).toBe(0)
  })

  it('versteckt den Eintrag vor einem Gast', async () => {
    const wrapper = await mountSidebar({ isLoggedIn: false, isAdmin: false })
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)
  })

  it('versteckt den Eintrag, wenn ein Admin-Flag ohne Anmeldung behauptet wird', async () => {
    const wrapper = await mountSidebar({ isLoggedIn: false, isAdmin: true })
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)
  })

  it('markiert den Eintrag als aktiv, solange eine Editor-Seite offen ist', async () => {
    const wrapper = await mountSidebar({ routePath: '/visu-editor/abc' })
    expect(wrapper.find(NAV_TESTID).classes().join(' ')).toContain('bg-blue-600/20')
  })

  it('laesst den V1-Visu-Link davon unberuehrt (R17)', async () => {
    const wrapper = await mountSidebar({ isLoggedIn: true, isAdmin: true })
    const v1 = wrapper.findAll('a').filter((a) => a.attributes('href') === '/visu/')
    expect(v1).toHaveLength(1)
    expect(genauSoBeschriftet(wrapper, 'Visu')).toBe(1)
  })

  it('traegt zusammengeklappt den Titel als Beschriftungsersatz', async () => {
    const wrapper = await mountSidebar({ collapsed: true })
    expect(wrapper.find(NAV_TESTID).attributes('title')).toBe(LABEL)
  })
})
