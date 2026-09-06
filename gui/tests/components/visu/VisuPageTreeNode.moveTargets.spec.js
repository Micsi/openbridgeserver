import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Die Verschieben-Auswahl im Seitenbaum (M5 C1, Issue #168) - eine Praezisierung
 * aus Teil C6 (Issue #173).
 *
 * WORUM ES GEHT: jeder Knoten traegt eine Auswahl mit JEDEM moeglichen Ziel. Der
 * Seitenname stand dabei als TEXTINHALT in jeder dieser Optionen, also bei n
 * Knoten bis zu n-mal je Name. Das ist zweierlei:
 *
 *  1. Ein Suchproblem. Eine Suche nach einem Seitennamen im Baum (Playwright:
 *     `getByText`, aber genauso ein Ctrl-F des Autors) trifft nicht die eine
 *     Zeile der Seite, sondern zusaetzlich n Eintraege in Aufklappmenues. Der
 *     Nachweis von E18 („nach dem Import steht der Name zweimal im Baum") waere
 *     damit gar nicht formulierbar.
 *  2. Unnoetiger Textinhalt: der Name gehoert in DIE ZEILE der Seite; in der
 *     Auswahl ist er eine Beschriftung.
 *
 * DIE LOESUNG, die genau das trennt: die Optionen tragen ihren Namen im
 * `label`-Attribut statt als Textinhalt. `label` ist laut HTML-Spezifikation
 * die Beschriftung einer Option, und der Browser zeigt sie unveraendert an.
 *
 * DAZU EIN `title` MIT DEMSELBEN WERT, und das ist keine Doppelung. Gemessen
 * (Kritik Runde 2, derselbe Browser, dieselbe Instanz):
 * `getByRole('option', { name })` fand auf der Basis 19 Treffer, nach der
 * Umstellung auf `label` **null**. Playwrights Berechnung des zugaenglichen
 * Namens zieht das `label`-Attribut nicht heran; der zugaengliche Name blieb
 * also NICHT derselbe, wie es hier bis Runde 1 stand - er war weg. Ein
 * Verschieben-Ziel waere ueber Rolle+Name nicht mehr adressierbar gewesen, und
 * das ist die Waehrung dieses Projekts.
 *
 * WARUM `title` UND NICHT `aria-label`: gemessen im Pflichtlauf mit
 * `aria-label` - E9 und E15 rot, `getByLabel('Seitentyp')` traf 21 Elemente
 * statt eines. `getByLabel` sucht teilstring-genau ueber `aria-label`, und eine
 * Seite namens „E9 Seitentyp wirksam" steht in JEDER Verschieben-Auswahl. Das
 * ist genau die Falle, die der Knoten oben schon einmal umgangen hat (der
 * Knotenname steht bei den Aktionsknoepfen im `title`, nicht im `aria-label`).
 * Der `title` wirkt nur in der letzten Stufe der accname-Kaskade und nicht in
 * der Label-Suche: Rolle+Name findet wieder, `getByLabel` bleibt unberuehrt.
 *
 * Die drei Zusicherungen unten (Beschriftung, zugaenglicher Name, leerer
 * Textinhalt) stehen deshalb NEBENEINANDER und muessen es bleiben.
 *
 * Was NICHT angetastet ist: welche Ziele angeboten werden, in welcher Ordnung,
 * und was ein Wechsel ausloest. Das steht in `VisuPageTree.spec.js` und gilt
 * unveraendert weiter.
 */

const TREE = [
  { id: 'eg', parent_id: null, name: 'M5 Ordner', type: 'LOCATION', kind: 'normal', order: 0, access: null },
  { id: 'gamma', parent_id: null, name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal', order: 30, access: 'public' },
  { id: 'home', parent_id: null, name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
]

let visuApi
let pinia

beforeEach(() => {
  vi.resetModules()
  pinia = createPinia()
  setActivePinia(pinia)
  visuApi = {
    tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getPage: vi.fn().mockResolvedValue({ data: { widgets: [], includes: [], ignore_global_includes: false, popup: null } }),
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

describe('Verschieben-Auswahl: der Name beschriftet, er steht nicht im Text', () => {
  it('nennt jedes Ziel im `label`-Attribut', async () => {
    const { wrapper } = await mountTree()
    const optionen = wrapper
      .find('[data-node-id="eg"] [data-action="move"]')
      .findAll('option')
      .filter((o) => o.attributes('value'))

    expect(optionen.map((o) => o.attributes('label'))).toEqual(['M5 Include Gamma', 'M5 Home'])
  })

  it('nennt jedes Ziel zusaetzlich im `title` - der zugaengliche Name bleibt', async () => {
    const { wrapper } = await mountTree()
    const optionen = wrapper
      .find('[data-node-id="eg"] [data-action="move"]')
      .findAll('option')
      .filter((o) => o.attributes('value'))

    expect(optionen.map((o) => o.attributes('title'))).toEqual(['M5 Include Gamma', 'M5 Home'])
  })

  it('haelt `label` und `title` auf demselben Wert - eine Beschriftung, zwei Leser', async () => {
    const { wrapper } = await mountTree()
    const optionen = wrapper
      .find('[data-node-id="eg"] [data-action="move"]')
      .findAll('option')
      .filter((o) => o.attributes('value'))

    for (const option of optionen) {
      expect(option.attributes('title')).toBe(option.attributes('label'))
    }
  })

  it('setzt KEIN `aria-label` - das machte jedes `getByLabel` n-fach mehrdeutig', async () => {
    const { wrapper } = await mountTree()
    const optionen = wrapper
      .find('[data-node-id="eg"] [data-action="move"]')
      .findAll('option')
      .filter((o) => o.attributes('value'))

    expect(optionen.map((o) => o.attributes('aria-label'))).toEqual([undefined, undefined])
  })

  it('laesst den Textinhalt der Ziel-Optionen leer', async () => {
    const { wrapper } = await mountTree()
    const optionen = wrapper
      .find('[data-node-id="eg"] [data-action="move"]')
      .findAll('option')
      .filter((o) => o.attributes('value'))

    expect(optionen.map((o) => o.text())).toEqual(['', ''])
  })

  it('nennt jeden Seitennamen im ganzen Baum genau EINMAL als Text', async () => {
    const { wrapper } = await mountTree()
    const treffer = wrapper
      .findAll('*')
      .filter((el) => el.element.children.length === 0 && el.text().includes('M5 Include Gamma'))

    expect(treffer).toHaveLength(1)
    expect(treffer[0].classes()).toContain('visu-node-name')
  })

  it('behaelt die oberste Ebene als lesbaren Eintrag - sie ist kein Seitenname', async () => {
    const { wrapper } = await mountTree()
    const wurzel = wrapper
      .find('[data-node-id="eg"] [data-action="move"]')
      .findAll('option')
      .find((o) => o.attributes('value') === '')

    expect(wurzel.text()).toBe('Oberste Ebene')
  })
})
