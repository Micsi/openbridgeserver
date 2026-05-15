import { describe, it, expect } from 'vitest'
import { buildDepthOptions } from './hierarchyDepthOptions.js'

const MAX_DEPTH = 4

describe('buildDepthOptions — Edit-Modus mit Daten', () => {
  it('benutzt tree.name als Label für Ebene 0 (Ast-Name) und distinct-count für tiefere Ebenen', () => {
    const tree = { id: 1, name: 'Salvusbrunnen' }
    const rootNodes = [
      {
        id: 10, name: '0 Keller',
        children: [
          { id: 100, name: 'Heizungsraum', children: [] },
          { id: 101, name: 'Lager', children: [] },
        ],
      },
      { id: 11, name: '1 Erdgeschoss', children: [] },
    ]

    const opts = buildDepthOptions({ isEdit: true, tree, rootNodes, maxDepth: MAX_DEPTH })

    expect(opts).toEqual([
      { value: 0, label: '0 — Salvusbrunnen (Ast-Name)',                              disabled: false },
      { value: 1, label: '1 — Erste Ebene (z.B. "0 Keller" — 2 unterschiedliche)',    disabled: false },
      { value: 2, label: '2 — Zweite Ebene (z.B. "Heizungsraum" — 2 unterschiedliche)', disabled: false },
      { value: 3, label: '3 — Dritte Ebene',                                          disabled: true  },
      { value: 4, label: '4 — Vierte Ebene',                                          disabled: true  },
    ])
  })

  it('zeigt "nur \\"X\\"" wenn auf einer Ebene nur ein eindeutiger Name vorkommt', () => {
    const tree = { id: 2, name: 'Gebäude' }
    const rootNodes = [
      { id: 20, name: 'Hauptgebäude', children: [
        { id: 200, name: 'EG', children: [] },
        { id: 201, name: 'OG', children: [] },
      ] },
    ]

    const opts = buildDepthOptions({ isEdit: true, tree, rootNodes, maxDepth: MAX_DEPTH })

    expect(opts[1].label).toBe('1 — Erste Ebene (nur "Hauptgebäude")')
    expect(opts[1].disabled).toBe(false)
    expect(opts[2].label).toBe('2 — Zweite Ebene (z.B. "EG" — 2 unterschiedliche)')
  })

  it('zählt distinct, nicht Vorkommen (doppelte Namen → distinct=1)', () => {
    const tree = { id: 3, name: 'X' }
    const rootNodes = [
      { id: 30, name: 'EG', children: [
        { id: 300, name: 'Bad', children: [] },
      ] },
      { id: 31, name: 'EG', children: [
        { id: 310, name: 'Bad', children: [] },
      ] },
    ]

    const opts = buildDepthOptions({ isEdit: true, tree, rootNodes, maxDepth: MAX_DEPTH })

    expect(opts[1].label).toBe('1 — Erste Ebene (nur "EG")')
    expect(opts[2].label).toBe('2 — Zweite Ebene (nur "Bad")')
  })

  it('disabled Ebene 1+, wenn der Baum keine Wurzelknoten hat', () => {
    const tree = { id: 4, name: 'Leerer Baum' }
    const opts = buildDepthOptions({ isEdit: true, tree, rootNodes: [], maxDepth: MAX_DEPTH })

    expect(opts[0]).toEqual({ value: 0, label: '0 — Leerer Baum (Ast-Name)', disabled: false })
    expect(opts[1]).toEqual({ value: 1, label: '1 — Erste Ebene',            disabled: true  })
    expect(opts.slice(2).every(o => o.disabled === true)).toBe(true)
  })

  it('disabled Ebene 2+, wenn die Wurzelknoten keine Kinder haben', () => {
    const tree = { id: 5, name: 'Gewerke' }
    const rootNodes = [
      { id: 50, name: 'Heizung', children: [] },
      { id: 51, name: 'Lüftung', children: [] },
    ]

    const opts = buildDepthOptions({ isEdit: true, tree, rootNodes, maxDepth: MAX_DEPTH })

    expect(opts[1]).toEqual({ value: 1, label: '1 — Erste Ebene (z.B. "Heizung" — 2 unterschiedliche)', disabled: false })
    expect(opts[2]).toEqual({ value: 2, label: '2 — Zweite Ebene',                                     disabled: true  })
    expect(opts.slice(3).every(o => o.disabled === true)).toBe(true)
  })

  it('nimmt deterministisch das erste nicht-leere Beispiel pro Ebene', () => {
    const tree = { id: 6, name: 'X' }
    const rootNodes = [
      { id: 60, name: 'A', children: [] },               // keine Enkel
      { id: 61, name: 'B', children: [
        { id: 610, name: 'B-Kind-1', children: [] },
        { id: 611, name: 'B-Kind-2', children: [] },
      ] },
    ]

    const opts = buildDepthOptions({ isEdit: true, tree, rootNodes, maxDepth: MAX_DEPTH })

    expect(opts[1].label).toBe('1 — Erste Ebene (z.B. "A" — 2 unterschiedliche)')
    expect(opts[2].label).toBe('2 — Zweite Ebene (z.B. "B-Kind-1" — 2 unterschiedliche)')
  })

  it('akzeptiert undefined/null rootNodes (Baum noch nicht geladen) ohne Crash', () => {
    const tree = { id: 7, name: 'Noch nicht geladen' }
    const opts = buildDepthOptions({ isEdit: true, tree, rootNodes: undefined, maxDepth: MAX_DEPTH })

    expect(opts[0].disabled).toBe(false)
    expect(opts[0].label).toBe('0 — Noch nicht geladen (Ast-Name)')
    expect(opts.slice(1).every(o => o.disabled === true)).toBe(true)
  })
})

describe('buildDepthOptions — Create-Modus', () => {
  it('liefert generische Labels mit dem heutigen Wortlaut und alle Ebenen aktiv', () => {
    const opts = buildDepthOptions({ isEdit: false, tree: null, rootNodes: null, maxDepth: MAX_DEPTH })

    expect(opts).toEqual([
      { value: 0, label: '0 — Ast-Name (Standard, z.B. "Gebäude")', disabled: false },
      { value: 1, label: '1 — Erste Ebene (z.B. "EG" statt "Gebäude")', disabled: false },
      { value: 2, label: '2 — Zweite Ebene (z.B. "Wohnzimmer")', disabled: false },
      { value: 3, label: '3 — Dritte Ebene', disabled: false },
      { value: 4, label: '4 — Vierte Ebene', disabled: false },
    ])
  })
})
