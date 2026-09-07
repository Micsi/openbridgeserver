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
 *
 * WARUM DER ECHTE ANMELDEWEG (Runde 2): bis hierher spritzte diese Datei
 * `{ isLoggedIn, isAdmin }` als Attrappe ein. Damit war ihre erste Zeile am
 * laufenden Artefakt FALSCH - ein frisch angemeldeter Admin sah den Eintrag
 * naemlich nicht, weil `stores/auth.js` `isLoggedIn` als `computed` ueber den
 * nicht reaktiven `localStorage` fuehrte: einmal auf der Anmeldemaske mit
 * `false` berechnet, blieb der Wert bis zum naechsten vollen Ladevorgang
 * `false`. Eine Attrappe, die den Zustand SETZT, kann diese Klasse Fehler
 * PRINZIPIELL nicht sehen. Deshalb steht hier jetzt der echte Store, und der
 * Zustand entsteht ueber `auth.login(...)` - genau den Weg, den die
 * Anmeldemaske geht. Attrappe ist nur noch die HTTP-Schicht. Keine Erwartung
 * ist gesenkt; es sind welche dazugekommen (der Wechsel OHNE Neuladen, in
 * beide Richtungen, und die Router-Wache am selben Store).
 */

const NAV_TESTID = '[data-testid="nav-visu-editor"]'
/** Der Wortlaut aus `de.json`. Exakt geprueft: `nav.visu` heisst „Visu". */
const LABEL = 'Visu-Editor'

const ADMIN = { id: 1, username: 'admin', is_admin: true }
const RESIDENT = { id: 2, username: 'bewohner', is_admin: false }

let loginMock
let meMock

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  loginMock = vi.fn().mockResolvedValue({
    data: { access_token: 'tok-neu', refresh_token: 'refresh-neu' },
  })
  meMock = vi.fn().mockResolvedValue({ data: ADMIN })
  vi.doMock('@/components/ui/VisuIcon.vue', () => ({
    default: { template: '<span class="visu-icon" />' },
  }))
  // Nur die HTTP-Schicht ist Attrappe. Der Auth-Store selbst - und damit die
  // Frage, ob `isLoggedIn` nach einer Anmeldung reaktiv wird - laeuft echt.
  vi.doMock('@/api/client', () => ({
    default: {},
    authApi: {
      login: (...args) => loginMock(...args),
      me: (...args) => meMock(...args),
    },
  }))
})

afterEach(() => {
  vi.doUnmock('vue-router')
  vi.doUnmock('@/stores/websocket')
  vi.doUnmock('@/stores/navLinks')
  vi.doUnmock('@/stores/adapters')
  vi.doUnmock('@/api/client')
  vi.doUnmock('@/components/ui/VisuIcon.vue')
  localStorage.clear()
})

const ROUTER_LINK_STUB = {
  template: '<a :href="to" v-bind="$attrs"><slot /></a>',
  props: ['to'],
}

/**
 * Baut die Seitenleiste mit dem ECHTEN Auth-Store auf - im Zustand „niemand
 * angemeldet", so wie der Browser nach dem ersten Laden dasteht. Den Zustand
 * aendert danach ausschliesslich `auth.login(...)` bzw. `auth.logout()`.
 */
async function mountSidebar({ collapsed = false, routePath = '/' } = {}) {
  vi.doMock('vue-router', () => ({
    useRoute: () => ({ path: routePath, name: 'Dashboard' }),
  }))
  vi.doMock('@/stores/websocket', () => ({ useWebSocketStore: () => ({ connected: true }) }))
  vi.doMock('@/stores/navLinks', () => ({
    useNavLinksStore: () => ({ links: [], load: vi.fn().mockResolvedValue([]) }),
  }))
  vi.doMock('@/stores/adapters', () => ({
    useAdapterStore: () => ({ instances: [], fetchAdapters: vi.fn().mockResolvedValue([]) }),
  }))

  const pinia = createPinia()
  setActivePinia(pinia)
  const { useAuthStore } = await import('@/stores/auth')
  const auth = useAuthStore()
  const { default: Sidebar } = await import('@/components/layout/Sidebar.vue')
  const wrapper = mount(Sidebar, {
    props: { collapsed },
    global: { plugins: [pinia], stubs: { RouterLink: ROUTER_LINK_STUB } },
  })
  await flushPromises()
  return { wrapper, auth }
}

/** Die Anmeldung, so wie die Maske sie fuehrt - ohne Neuladen der Seite. */
async function anmelden(auth, wrapper, wer = ADMIN) {
  meMock.mockResolvedValue({ data: wer })
  expect(await auth.login(wer.username, 'geheim')).toBe(true)
  await flushPromises()
  await wrapper.vm.$nextTick()
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
  it('zeigt den Eintrag, sobald sich ein Admin anmeldet — ohne Neuladen', async () => {
    const { wrapper, auth } = await mountSidebar()
    // Vor der Anmeldung: kein Eintrag. Das ist der Ausgangsstand, nicht die Zusage.
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)

    await anmelden(auth, wrapper)

    // Und DAS ist die Zusage: derselbe geladene Tab, dieselbe Komponente.
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.isAdmin).toBe(true)
    expect(wrapper.find(NAV_TESTID).exists()).toBe(true)
    expect(genauSoBeschriftet(wrapper, LABEL)).toBe(1)
  })

  it('laesst die Router-Wache denselben frisch angemeldeten Admin durch', async () => {
    const { wrapper, auth } = await mountSidebar()
    const { visuEditorGuard } = await import('@/utils/visuEditorAccess')
    const ziel = { meta: { admin: true } }
    // Vor der Anmeldung weist die Wache ab …
    expect(visuEditorGuard(ziel, auth)).toEqual({ name: 'Dashboard' })

    await anmelden(auth, wrapper)

    // … und danach nicht mehr. Ohne Neuladen: genau der Fall, in dem der Editor
    // den rechtmaessigen Admin aufs Dashboard zurueckwarf.
    expect(visuEditorGuard(ziel, auth)).toBeUndefined()
  })

  it('nimmt den Eintrag beim Abmelden wieder weg — ebenfalls ohne Neuladen', async () => {
    const { wrapper, auth } = await mountSidebar()
    await anmelden(auth, wrapper)
    expect(wrapper.find(NAV_TESTID).exists()).toBe(true)

    auth.logout()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(auth.isLoggedIn).toBe(false)
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)
  })

  it('verlinkt auf den Admin-Bereich des Editors', async () => {
    const { wrapper, auth } = await mountSidebar()
    await anmelden(auth, wrapper)
    expect(wrapper.find(NAV_TESTID).attributes('href')).toBe('/visu-editor')
  })

  it('versteckt den Eintrag vor einem angemeldeten Nicht-Admin', async () => {
    const { wrapper, auth } = await mountSidebar()
    await anmelden(auth, wrapper, RESIDENT)
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.isAdmin).toBe(false)
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)
    expect(genauSoBeschriftet(wrapper, LABEL)).toBe(0)
  })

  it('versteckt den Eintrag vor einem Gast', async () => {
    const { wrapper } = await mountSidebar()
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)
  })

  it('versteckt den Eintrag, wenn ein Admin-Flag ohne Anmeldung behauptet wird', async () => {
    const { wrapper, auth } = await mountSidebar()
    // `is_admin` ohne Token ist ein Rest aus einer alten Sitzung, kein Zugang:
    // der Store bekommt den Benutzer, aber nie ein Token.
    auth.user = ADMIN
    await wrapper.vm.$nextTick()
    expect(auth.isAdmin).toBe(true)
    expect(auth.isLoggedIn).toBe(false)
    expect(wrapper.find(NAV_TESTID).exists()).toBe(false)
  })

  it('markiert den Eintrag als aktiv, solange eine Editor-Seite offen ist', async () => {
    const { wrapper, auth } = await mountSidebar({ routePath: '/visu-editor/abc' })
    await anmelden(auth, wrapper)
    expect(wrapper.find(NAV_TESTID).classes().join(' ')).toContain('bg-blue-600/20')
  })

  it('laesst den V1-Visu-Link davon unberuehrt (R17)', async () => {
    const { wrapper, auth } = await mountSidebar()
    await anmelden(auth, wrapper)
    const v1 = wrapper.findAll('a').filter((a) => a.attributes('href') === '/visu/')
    expect(v1).toHaveLength(1)
    expect(genauSoBeschriftet(wrapper, 'Visu')).toBe(1)
  })

  it('traegt zusammengeklappt den Titel als Beschriftungsersatz', async () => {
    const { wrapper, auth } = await mountSidebar({ collapsed: true })
    await anmelden(auth, wrapper)
    expect(wrapper.find(NAV_TESTID).attributes('title')).toBe(LABEL)
  })
})
