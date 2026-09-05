import { describe, it, expect } from 'vitest'

import {
  buildTree,
  canMoveInto,
  descendantIds,
  neighbourSwap,
  siblingsOf,
  sortNodes,
} from '@/utils/visuPageTree'

/**
 * Der Seitenbaum des V2-Editors (M5 C1, Issue #168).
 *
 * Reine Funktionen ueber der flachen Knotenliste, die `GET /visu/tree` liefert:
 * verschachteln, ordnen (`order`, §2.2 - danach stapeln die globalen
 * Inkludeseiten), verschieben. Kein Zustand, kein Netz - damit die
 * Baum-Entscheidungen einzeln pruefbar sind und nicht erst in einer Montage.
 */

const NODES = [
  { id: 'eg', parent_id: null, name: 'Erdgeschoss', type: 'LOCATION', kind: 'normal', order: 10 },
  { id: 'og', parent_id: null, name: 'Obergeschoss', type: 'LOCATION', kind: 'normal', order: 20 },
  { id: 'kueche', parent_id: 'eg', name: 'Kueche', type: 'PAGE', kind: 'normal', order: 10 },
  { id: 'bad', parent_id: 'eg', name: 'Bad', type: 'PAGE', kind: 'normal', order: 20 },
  { id: 'dusche', parent_id: 'bad', name: 'Dusche', type: 'PAGE', kind: 'popup', order: 5 },
]

describe('sortNodes - Reihenfolge ueber `order`, bei Gleichstand ueber den Namen', () => {
  it('ordnet aufsteigend nach `order`', () => {
    const sorted = sortNodes([
      { id: 'b', name: 'B', order: 20 },
      { id: 'a', name: 'A', order: 10 },
    ])
    expect(sorted.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('faellt bei gleichem `order` auf den Namen zurueck', () => {
    const sorted = sortNodes([
      { id: 'z', name: 'Zeta', order: 0 },
      { id: 'a', name: 'Alpha', order: 0 },
    ])
    expect(sorted.map((n) => n.id)).toEqual(['a', 'z'])
  })

  it('behandelt einen fehlenden `order` wie 0', () => {
    const sorted = sortNodes([
      { id: 'b', name: 'B', order: 1 },
      { id: 'a', name: 'A' },
    ])
    expect(sorted.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('laesst die Eingabeliste unveraendert', () => {
    const input = [
      { id: 'b', name: 'B', order: 20 },
      { id: 'a', name: 'A', order: 10 },
    ]
    sortNodes(input)
    expect(input.map((n) => n.id)).toEqual(['b', 'a'])
  })
})

describe('buildTree - aus der flachen Liste wird die Hierarchie', () => {
  it('haengt jedes Kind unter seinen Elternknoten, geordnet', () => {
    const roots = buildTree(NODES)
    expect(roots.map((n) => n.id)).toEqual(['eg', 'og'])
    expect(roots[0].children.map((n) => n.id)).toEqual(['kueche', 'bad'])
    expect(roots[0].children[1].children.map((n) => n.id)).toEqual(['dusche'])
    expect(roots[1].children).toEqual([])
  })

  it('haengt einen Knoten mit unbekanntem Elternknoten an die Wurzel, statt ihn zu verlieren', () => {
    const roots = buildTree([...NODES, { id: 'waise', parent_id: 'gibt-es-nicht', name: 'Waise', type: 'PAGE', order: 0 }])
    expect(roots.map((n) => n.id)).toContain('waise')
  })

  it('vertraegt eine leere Liste', () => {
    expect(buildTree([])).toEqual([])
    expect(buildTree(null)).toEqual([])
  })

  it('haelt einen Zyklus in `parent_id` aus, statt endlos zu laufen', () => {
    const roots = buildTree([
      { id: 'a', parent_id: 'b', name: 'A', type: 'PAGE', order: 0 },
      { id: 'b', parent_id: 'a', name: 'B', type: 'PAGE', order: 0 },
    ])
    expect(roots).toEqual([])
  })
})

describe('siblingsOf - die Geschwister einer Ebene, geordnet', () => {
  it('liefert die Kinder eines Elternknotens', () => {
    expect(siblingsOf(NODES, 'eg').map((n) => n.id)).toEqual(['kueche', 'bad'])
  })

  it('liefert die Wurzelebene fuer `null`', () => {
    expect(siblingsOf(NODES, null).map((n) => n.id)).toEqual(['eg', 'og'])
  })

  it('liefert nichts fuer einen Elternknoten ohne Kinder', () => {
    expect(siblingsOf(NODES, 'og')).toEqual([])
  })
})

describe('descendantIds - der Teilbaum inklusive der Wurzel', () => {
  it('sammelt Kinder und Kindeskinder', () => {
    expect([...descendantIds(NODES, 'eg')].sort()).toEqual(['bad', 'dusche', 'eg', 'kueche'])
  })

  it('liefert bei einem Blatt nur den Knoten selbst', () => {
    expect([...descendantIds(NODES, 'kueche')]).toEqual(['kueche'])
  })

  it('liefert bei einem unbekannten Knoten nur die gefragte ID', () => {
    expect([...descendantIds(NODES, 'gibt-es-nicht')]).toEqual(['gibt-es-nicht'])
  })
})

describe('canMoveInto - kein Knoten wandert in seinen eigenen Teilbaum', () => {
  it('erlaubt den Zug auf eine fremde Ebene', () => {
    expect(canMoveInto(NODES, 'kueche', 'og')).toBe(true)
  })

  it('erlaubt den Zug an die Wurzel', () => {
    expect(canMoveInto(NODES, 'kueche', null)).toBe(true)
  })

  it('verbietet den Zug in den eigenen Teilbaum', () => {
    expect(canMoveInto(NODES, 'eg', 'dusche')).toBe(false)
  })

  it('verbietet den Zug in sich selbst', () => {
    expect(canMoveInto(NODES, 'eg', 'eg')).toBe(false)
  })

  it('verbietet ein Ziel, das keine Ebene traegt (Seite statt Ordner)', () => {
    expect(canMoveInto(NODES, 'kueche', 'gibt-es-nicht')).toBe(false)
  })
})

describe('neighbourSwap - eine Ebene hoeher oder tiefer in der Reihenfolge', () => {
  it('tauscht `order` mit dem Vorgaenger', () => {
    expect(neighbourSwap(NODES, 'bad', -1)).toEqual([
      { id: 'bad', order: 10 },
      { id: 'kueche', order: 20 },
    ])
  })

  it('tauscht `order` mit dem Nachfolger', () => {
    expect(neighbourSwap(NODES, 'kueche', 1)).toEqual([
      { id: 'kueche', order: 20 },
      { id: 'bad', order: 10 },
    ])
  })

  it('meldet am oberen Rand nichts zu tun', () => {
    expect(neighbourSwap(NODES, 'kueche', -1)).toBeNull()
  })

  it('meldet am unteren Rand nichts zu tun', () => {
    expect(neighbourSwap(NODES, 'bad', 1)).toBeNull()
  })

  it('meldet fuer einen unbekannten Knoten nichts zu tun', () => {
    expect(neighbourSwap(NODES, 'gibt-es-nicht', 1)).toBeNull()
  })

  it('vergibt bei gleichem `order` verschiedene Werte, damit der Tausch wirkt', () => {
    const flat = [
      { id: 'a', parent_id: null, name: 'A', type: 'PAGE', order: 0 },
      { id: 'b', parent_id: null, name: 'B', type: 'PAGE', order: 0 },
    ]
    expect(neighbourSwap(flat, 'b', -1)).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
    ])
  })
})
