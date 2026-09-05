import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Der Entwurf, den die Vorschau zeigt (M5 C3, Issue #170).
 *
 * Hier haengen zwei Messlatten-Zeilen:
 *
 *  **E10** - eine Aenderung an der zentralen Vorlage (der Inkludeseite)
 *  propagiert in jede referenzierende Seite, OHNE manuellen Re-Import. Der
 *  Nachweis ist eine Aussage ueber die MECHANIK: die Wirtsseite speichert nur
 *  die Id der Vorlage, und der Entwurf laedt die Vorlage jedes Mal frisch. Es
 *  gibt gar keinen Weg, ihren Inhalt in die Wirtsseite zu kopieren.
 *
 *  **E16** - ein Element ist je nach Datenpunktwert sichtbar oder unsichtbar.
 *  Der Entwurf traegt das verborgene Element nicht.
 *
 * Die Werte kommen vom echten Backend (REST fuer den Anfangswert, WebSocket
 * fuer die Aenderung) - keine zweite Datenquelle, keine Attrappe.
 */

const HOME = 'node-home'
const INCLUDE = 'node-include'
const GLOBAL = 'node-global'
const SOLO = 'node-solo'

/** `GET /visu/tree` - die Knotenliste ohne Seiten-Konfigurationen. */
const TREE = [
  { id: GLOBAL, parent_id: null, name: 'M5 Global A', type: 'PAGE', kind: 'globalInclude', order: 10, access: 'public' },
  { id: INCLUDE, parent_id: null, name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal', order: 30, access: 'public' },
  { id: HOME, parent_id: null, name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
  { id: SOLO, parent_id: null, name: 'M5 Solo', type: 'PAGE', kind: 'normal', order: 50, access: 'public' },
]

function widget(name, extra = {}) {
  return {
    id: `w-${name}`,
    name,
    type: 'Toggle',
    datapoint_id: null,
    status_datapoint_id: null,
    x: 0,
    y: 0,
    w: 3,
    h: 2,
    config: {},
    ...extra,
  }
}

/** Der Zustand der Testinstanz - `pages` ist der Server, nicht der Editor. */
let pages
let getPage
let getTree

beforeEach(() => {
  vi.resetModules()
  pages = {
    [GLOBAL]: { widgets: [widget('M5 Global Alpha')], includes: [], ignore_global_includes: false, popup: null },
    [INCLUDE]: { widgets: [widget('M5 Gamma Item')], includes: [], ignore_global_includes: false, popup: null },
    [HOME]: { widgets: [widget('M5 Home Delta')], includes: [INCLUDE], ignore_global_includes: false, popup: null },
    [SOLO]: {
      widgets: [widget('M5 Solo Epsilon', { datapoint_id: 'dp-m5-solo' })],
      includes: [],
      ignore_global_includes: true,
      popup: null,
    },
  }
  getTree = vi.fn(async () => ({ data: TREE }))
  getPage = vi.fn(async (id) => {
    if (!pages[id]) {
      const err = new Error('not found')
      err.response = { status: 404 }
      throw err
    }
    return { data: pages[id] }
  })
  vi.doMock('@/api/visu', () => ({ visuApi: { tree: getTree, page: getPage } }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
})

async function load() {
  return await import('@/composables/useVisuEditorDraft')
}

describe('Entwurf — welche Knoten eine Seite braucht', () => {
  it('nimmt die Seite, ihre Inkludeseiten und die globalen Inkludeseiten — in Baum-Reihenfolge', async () => {
    // Die Reihenfolge ist tragend: mehrere globale Inkludeseiten stapeln nach
    // Knoten-`order` (R10), und der Baum liefert genau diese Ordnung.
    const { requiredNodeIds } = await load()
    expect(requiredNodeIds(HOME, TREE, pages)).toEqual([GLOBAL, INCLUDE, HOME])
  })

  it('laesst die globalen Inkludeseiten weg, wenn die Seite sie ausblendet (R13)', async () => {
    const { requiredNodeIds } = await load()
    expect(requiredNodeIds(SOLO, TREE, pages)).toEqual([SOLO])
  })

  it('folgt einer Kette von Inkludeseiten und dreht sich nicht im Kreis', async () => {
    const { requiredNodeIds } = await load()
    pages[INCLUDE] = { ...pages[INCLUDE], includes: [HOME] } // Zyklus
    expect(requiredNodeIds(HOME, TREE, pages).sort()).toEqual([GLOBAL, HOME, INCLUDE].sort())
  })
})

describe('Entwurf — E10: die Vorlage propagiert ohne Re-Import', () => {
  it('laedt die Vorlage bei jedem Aufbau frisch und nimmt ihren neuen Inhalt mit', async () => {
    const { loadDraftNodes } = await load()

    const vorher = await loadDraftNodes(HOME)
    const namen = (nodes, id) =>
      nodes.find((n) => n.id === id).page_config.widgets.map((w) => w.name)
    expect(namen(vorher, INCLUDE)).toEqual(['M5 Gamma Item'])
    expect(getPage).toHaveBeenCalledWith(INCLUDE)

    // Jemand benennt das Element auf der VORLAGE um - mehr passiert nicht.
    pages[INCLUDE] = { ...pages[INCLUDE], widgets: [widget('M5 Gamma Umbenannt')] }

    const nachher = await loadDraftNodes(HOME)
    expect(namen(nachher, INCLUDE)).toEqual(['M5 Gamma Umbenannt'])
    // Die Wirtsseite selbst wurde nie angefasst: sie traegt weiterhin nur die Id.
    expect(namen(nachher, HOME)).toEqual(['M5 Home Delta'])
    expect(pages[HOME].includes).toEqual([INCLUDE])
  })

  it('kopiert den Inhalt der Vorlage NICHT in die Wirtsseite', async () => {
    const { loadDraftNodes } = await load()
    const nodes = await loadDraftNodes(HOME)
    const home = nodes.find((n) => n.id === HOME)
    // Kein Widget der Vorlage steht in der Wirtsseite - der Host komponiert sie
    // (Teil B), der Editor kopiert nichts.
    expect(home.page_config.widgets.map((w) => w.name)).toEqual(['M5 Home Delta'])
    expect(home.page_config.includes).toEqual([INCLUDE])
  })

  it('uebergeht eine Inkludeseite, die es nicht (mehr) gibt, statt den Entwurf zu verlieren', async () => {
    const { loadDraftNodes } = await load()
    pages[HOME] = { ...pages[HOME], includes: [INCLUDE, 'node-weg'] }
    const nodes = await loadDraftNodes(HOME)
    expect(nodes.map((n) => n.id).sort()).toEqual([GLOBAL, HOME, INCLUDE].sort())
  })
})

describe('Entwurf — die Form, die die Bruecke erwartet', () => {
  it('nennt Skin, Seite und Knoten', async () => {
    const { buildDraft } = await load()
    const nodes = [{ id: SOLO, type: 'PAGE', name: 'M5 Solo', page_config: pages[SOLO] }]
    const draft = buildDraft({ pageId: SOLO, nodes, skin: 'edomi', values: {} })
    expect(Object.keys(draft).sort()).toEqual(['nodes', 'pageId', 'skin'])
    expect(draft.pageId).toBe(SOLO)
    expect(draft.skin).toBe('edomi')
    expect(draft.nodes[0].page_config.widgets[0].datapoint_id).toBe('dp-m5-solo')
  })

  it('E16: nimmt ein Element mit unerfuellter Regel aus dem Entwurf und bringt es zurueck', async () => {
    const { buildDraft } = await load()
    const geregelt = widget('M5 Solo Epsilon', {
      datapoint_id: 'dp-m5-solo',
      config: { visible_when: { datapoint_id: 'dp-m5-solo', op: 'gt', value: 30 } },
    })
    const nodes = [
      { id: SOLO, type: 'PAGE', name: 'M5 Solo', page_config: { ...pages[SOLO], widgets: [geregelt] } },
    ]

    const verborgen = buildDraft({ pageId: SOLO, nodes, skin: 'edomi', values: { 'dp-m5-solo': 21.5 } })
    expect(verborgen.nodes[0].page_config.widgets).toEqual([])

    const sichtbar = buildDraft({ pageId: SOLO, nodes, skin: 'edomi', values: { 'dp-m5-solo': 42 } })
    expect(sichtbar.nodes[0].page_config.widgets.map((w) => w.name)).toEqual(['M5 Solo Epsilon'])
  })

  it('E11: die gebundene Datenpunkt-Id reist mit, damit die Vorschau ihren Wert holt', async () => {
    const { buildDraft, draftDatapointIds } = await load()
    const nodes = [{ id: SOLO, type: 'PAGE', name: 'M5 Solo', page_config: pages[SOLO] }]
    const draft = buildDraft({ pageId: SOLO, nodes, skin: 'edomi', values: {} })
    // Der Entwurf traegt KEINEN Wert - die Vorschau liest ihn selbst am Backend.
    expect(JSON.stringify(draft)).not.toContain('21.5')
    expect(draftDatapointIds(nodes)).toEqual(['dp-m5-solo'])
  })
})
