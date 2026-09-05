import { describe, it, expect, vi, beforeEach } from 'vitest'

import { visuApi } from '@/api/visu'
import {
  buildDraft,
  draftDatapointIds,
  loadDraftNodes,
  requiredNodeIds,
} from '@/composables/useVisuEditorDraft'

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
 *  Der Entwurf traegt jedes Element MIT seiner Regel; entschieden wird im Host
 *  (`apps/visu/src/core/obs/mapping.ts`), damit Vorschau und ausgelieferte Visu
 *  dieselbe Seite zeigen (**E3**). Der Zaun um diese Naht steht in
 *  `gui/tests/utils/visuVisibilityHost.spec.js`.
 *
 * Die Werte kommen vom echten Backend (REST fuer den Anfangswert, WebSocket
 * fuer die Aenderung) - keine zweite Datenquelle, keine Attrappe.
 *
 * Die Doppel des Servers haengen an EINEM Zustand, der je Test zurueckgesetzt
 * wird; das Modul wird EINMAL geladen. Ein `vi.resetModules()` samt dynamischem
 * Import je Test hat den Modulgraphen (Axios, Stores, Router) pro Test neu
 * uebersetzt und unter Last die 20-Sekunden-Grenze gerissen.
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

/** Der Zustand des SERVERS (nicht des Editors) - je Test frisch gesetzt. */
const server = vi.hoisted(() => ({ pages: {} }))

vi.mock('@/api/visu', () => ({
  visuApi: {
    tree: vi.fn(async () => ({ data: TREE })),
    page: vi.fn(async (id) => {
      if (!server.pages[id]) {
        const err = new Error('not found')
        err.response = { status: 404 }
        throw err
      }
      return { data: server.pages[id] }
    }),
  },
}))

beforeEach(() => {
  visuApi.tree.mockClear()
  visuApi.page.mockClear()
  server.pages = {
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
})

describe('Entwurf — welche Knoten eine Seite braucht', () => {
  it('nimmt die Seite, ihre Inkludeseiten und die globalen Inkludeseiten - in Baum-Reihenfolge', () => {
    // Die Reihenfolge ist tragend: mehrere globale Inkludeseiten stapeln nach
    // Knoten-`order` (R10), und der Baum liefert genau diese Ordnung.
    expect(requiredNodeIds(HOME, TREE, server.pages)).toEqual([GLOBAL, INCLUDE, HOME])
  })

  it('laesst die globalen Inkludeseiten weg, wenn die Seite sie ausblendet (R13)', () => {
    expect(requiredNodeIds(SOLO, TREE, server.pages)).toEqual([SOLO])
  })

  it('folgt einer Kette von Inkludeseiten und dreht sich nicht im Kreis', () => {
    server.pages[INCLUDE] = { ...server.pages[INCLUDE], includes: [HOME] } // Zyklus
    expect(requiredNodeIds(HOME, TREE, server.pages).sort()).toEqual([GLOBAL, HOME, INCLUDE].sort())
  })
})

describe('Entwurf — E10: die Vorlage propagiert ohne Re-Import', () => {
  it('laedt die Vorlage bei jedem Aufbau frisch und nimmt ihren neuen Inhalt mit', async () => {
    const vorher = await loadDraftNodes(HOME)
    const namen = (nodes, id) =>
      nodes.find((n) => n.id === id).page_config.widgets.map((w) => w.name)
    expect(namen(vorher, INCLUDE)).toEqual(['M5 Gamma Item'])
    expect(visuApi.page).toHaveBeenCalledWith(INCLUDE)

    // Jemand benennt das Element auf der VORLAGE um - mehr passiert nicht.
    server.pages[INCLUDE] = { ...server.pages[INCLUDE], widgets: [widget('M5 Gamma Umbenannt')] }

    const nachher = await loadDraftNodes(HOME)
    expect(namen(nachher, INCLUDE)).toEqual(['M5 Gamma Umbenannt'])
    // Die Wirtsseite selbst wurde nie angefasst: sie traegt weiterhin nur die Id.
    expect(namen(nachher, HOME)).toEqual(['M5 Home Delta'])
    expect(server.pages[HOME].includes).toEqual([INCLUDE])
  })

  it('kopiert den Inhalt der Vorlage NICHT in die Wirtsseite', async () => {
    const nodes = await loadDraftNodes(HOME)
    const home = nodes.find((n) => n.id === HOME)
    // Kein Widget der Vorlage steht in der Wirtsseite - der Host komponiert sie
    // (Teil B), der Editor kopiert nichts.
    expect(home.page_config.widgets.map((w) => w.name)).toEqual(['M5 Home Delta'])
    expect(home.page_config.includes).toEqual([INCLUDE])
  })

  it('uebergeht eine Inkludeseite, die es nicht (mehr) gibt, statt den Entwurf zu verlieren', async () => {
    server.pages[HOME] = { ...server.pages[HOME], includes: [INCLUDE, 'node-weg'] }
    const nodes = await loadDraftNodes(HOME)
    expect(nodes.map((n) => n.id).sort()).toEqual([GLOBAL, HOME, INCLUDE].sort())
  })
})

describe('Entwurf — die Form, die die Bruecke erwartet', () => {
  it('nennt Skin, Seite und Knoten', () => {
    const nodes = [{ id: SOLO, type: 'PAGE', name: 'M5 Solo', page_config: server.pages[SOLO] }]
    const draft = buildDraft({ pageId: SOLO, nodes, skin: 'edomi' })
    expect(Object.keys(draft).sort()).toEqual(['nodes', 'pageId', 'skin'])
    expect(draft.pageId).toBe(SOLO)
    expect(draft.skin).toBe('edomi')
    expect(draft.nodes[0].page_config.widgets[0].datapoint_id).toBe('dp-m5-solo')
  })

  it('E16: reicht das geregelte Element MIT seiner Regel weiter, statt es auszusortieren', () => {
    const regel = { datapoint_id: 'dp-m5-solo', op: 'gt', value: 30 }
    const geregelt = widget('M5 Solo Epsilon', {
      datapoint_id: 'dp-m5-solo',
      config: { visible_when: regel },
    })
    const nodes = [
      { id: SOLO, type: 'PAGE', name: 'M5 Solo', page_config: { ...server.pages[SOLO], widgets: [geregelt] } },
    ]

    const draft = buildDraft({ pageId: SOLO, nodes, skin: 'edomi' })
    // Der Entwurf ist die Seite, nicht das Ergebnis einer Auswertung: sonst
    // zeigte die Vorschau fuer geregelte Elemente etwas anderes als die Visu.
    expect(draft.nodes[0].page_config.widgets.map((w) => w.name)).toEqual(['M5 Solo Epsilon'])
    expect(draft.nodes[0].page_config.widgets[0].config.visible_when).toEqual(regel)
  })

  it('E16: der Regel-Datenpunkt steht in der Abo-Liste, auch wenn ihn kein Element bindet', () => {
    // Der Editor beobachtet ihn, damit ein Wertwechsel Anlass ist, dem Host
    // einen neuen Entwurf zu schicken - nicht, um selbst zu entscheiden.
    const geregelt = widget('M5 Solo Epsilon', {
      config: { visible_when: { datapoint_id: 'dp-regel', op: 'truthy' } },
    })
    const nodes = [
      { id: SOLO, type: 'PAGE', name: 'M5 Solo', page_config: { ...server.pages[SOLO], widgets: [geregelt] } },
    ]
    expect(draftDatapointIds(nodes)).toEqual(['dp-regel'])
  })

  it('E11: die gebundene Datenpunkt-Id reist mit, damit die Vorschau ihren Wert holt', () => {
    const nodes = [{ id: SOLO, type: 'PAGE', name: 'M5 Solo', page_config: server.pages[SOLO] }]
    const draft = buildDraft({ pageId: SOLO, nodes, skin: 'edomi' })
    // Der Entwurf traegt KEINEN Wert - die Vorschau liest ihn selbst am Backend.
    expect(JSON.stringify(draft)).not.toContain('21.5')
    expect(draftDatapointIds(nodes)).toEqual(['dp-m5-solo'])
  })
})
