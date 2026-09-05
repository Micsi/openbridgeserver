import { describe, it, expect } from 'vitest'

import {
  BACKEND_PAGE_KINDS,
  EDITOR_PAGE_KINDS,
  collectReferencedPageIds,
  supportsIncludes,
  supportsPopup,
  toBackendKind,
  toEditorKind,
} from '@/utils/visuPageKind'

/**
 * Der Seitentyp des V2-Editors (M5 C1, Issue #168, Messlatte E9 / Regel R1).
 *
 * Edomi kennt vier Seitentypen: normal, Inkludeseite, globale Inkludeseite,
 * Popup. Das OBS-Backend kennt nur DREI Spaltenwerte
 * (`obs/models/visu.py → PageKind`), weil A0 entschieden hat: eine individuelle
 * Inkludeseite ist eine gewoehnliche Seite, die woanders in `includes` steht -
 * sie braucht keinen eigenen Typ.
 *
 * Genau diese Luecke schliesst dieses Modul, und zwar ohne eine zweite
 * Datenquelle zu erfinden: „Inkludeseite" ist eine ABGELEITETE Rolle (wird die
 * Seite irgendwo inkludiert?), keine gespeicherte Behauptung. Damit bleibt der
 * Editor bei den vier Namen, die E9 verlangt, und das Backend bei seinen drei
 * Werten.
 */

describe('visuPageKind - die vier Editor-Typen ueber drei Backend-Werten', () => {
  it('bietet genau die vier Typen der Regeltabelle, in Edomis Reihenfolge', () => {
    expect(EDITOR_PAGE_KINDS).toEqual(['normal', 'include', 'globalInclude', 'popup'])
  })

  it('kennt genau die drei Werte, die das Backend-Enum traegt', () => {
    expect(BACKEND_PAGE_KINDS).toEqual(['normal', 'globalInclude', 'popup'])
  })

  it('bildet jeden Editor-Typ auf einen Wert des Backend-Enums ab', () => {
    expect(EDITOR_PAGE_KINDS.map(toBackendKind)).toEqual([
      'normal',
      'normal',
      'globalInclude',
      'popup',
    ])
    for (const kind of EDITOR_PAGE_KINDS) {
      expect(BACKEND_PAGE_KINDS).toContain(toBackendKind(kind))
    }
  })

  it('faellt fuer einen unbekannten Typ auf den Backend-Default zurueck', () => {
    expect(toBackendKind('bunt')).toBe('normal')
    expect(toBackendKind(undefined)).toBe('normal')
    expect(toBackendKind(null)).toBe('normal')
  })

  it('liest Popup und globale Inkludeseite direkt aus dem Backend-Wert', () => {
    expect(toEditorKind('popup')).toBe('popup')
    expect(toEditorKind('globalInclude')).toBe('globalInclude')
    expect(toEditorKind('popup', { referenced: true })).toBe('popup')
    expect(toEditorKind('globalInclude', { referenced: true })).toBe('globalInclude')
  })

  it('nennt eine normale Seite „Inkludeseite", sobald sie irgendwo inkludiert wird', () => {
    expect(toEditorKind('normal', { referenced: true })).toBe('include')
    expect(toEditorKind('normal', { referenced: false })).toBe('normal')
    expect(toEditorKind('normal')).toBe('normal')
  })

  it('behandelt einen fehlenden Backend-Wert wie „normal" (Bestandsseiten, R17)', () => {
    expect(toEditorKind(undefined)).toBe('normal')
    expect(toEditorKind(null, { referenced: true })).toBe('include')
  })

  it('erlaubt Includes nur bei normalen Seiten und Inkludeseiten', () => {
    expect(supportsIncludes('normal')).toBe(true)
    expect(supportsIncludes('include')).toBe(true)
    expect(supportsIncludes('globalInclude')).toBe(false)
    expect(supportsIncludes('popup')).toBe(false)
  })

  it('zeigt die Popup-Eigenschaften nur beim Seitentyp Popup', () => {
    expect(supportsPopup('popup')).toBe(true)
    expect(supportsPopup('normal')).toBe(false)
    expect(supportsPopup('include')).toBe(false)
    expect(supportsPopup('globalInclude')).toBe(false)
  })
})

describe('collectReferencedPageIds - wer wird von wem inkludiert', () => {
  it('sammelt jede Ziel-ID aus allen Seiten-Konfigurationen', () => {
    const referenced = collectReferencedPageIds({
      home: { includes: ['gamma'] },
      host: { includes: ['guard-a', 'guard-b'] },
      solo: { includes: [] },
    })
    expect([...referenced].sort()).toEqual(['gamma', 'guard-a', 'guard-b'])
  })

  it('vertraegt fehlende, leere und unbrauchbare Konfigurationen', () => {
    expect([...collectReferencedPageIds({})]).toEqual([])
    expect([...collectReferencedPageIds({ a: null, b: undefined, c: {} })]).toEqual([])
    expect([...collectReferencedPageIds({ a: { includes: null } })]).toEqual([])
    expect([...collectReferencedPageIds(null)]).toEqual([])
  })

  it('zaehlt eine mehrfach genannte Seite genau einmal', () => {
    const referenced = collectReferencedPageIds({
      a: { includes: ['gamma'] },
      b: { includes: ['gamma'] },
    })
    expect([...referenced]).toEqual(['gamma'])
  })
})
