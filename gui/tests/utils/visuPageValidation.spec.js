import { describe, it, expect } from 'vitest'

import { PAGE_PROBLEM, validatePage } from '@/utils/visuPageValidation'

/**
 * Die verbotenen Kombinationen (M5 C1, Issue #168).
 *
 * Jede Regel hier ist die VORWEGNAHME einer Ablehnung des Backends: das
 * Seitentyp-Modell steht in `obs/api/v1/visu.py` (`_validate_page_kind_config`,
 * `_validate_node_kind`, `_apply_kind_change`, `_assert_not_included_elsewhere`,
 * `update_node`) und antwortet mit 400 bzw. 422. Der Editor soll es dem Autor
 * vorher sagen, nicht den Statuscode durchreichen (Messlatte E9/E15).
 *
 * Deshalb wird JEDE Regel doppelt geprueft: einmal der Verstoss und einmal der
 * erlaubte Nachbarfall - sonst waere eine Regel gruen, die IMMER meldet.
 */

const NODES = [
  { id: 'home', name: 'M5 Home', type: 'PAGE', kind: 'normal' },
  { id: 'gamma', name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal' },
  { id: 'globalA', name: 'M5 Global A', type: 'PAGE', kind: 'globalInclude' },
  { id: 'popupA', name: 'M5 Popup Positioned', type: 'PAGE', kind: 'popup' },
  { id: 'folder', name: 'M5 Ordner', type: 'LOCATION', kind: 'normal' },
]

/** Der unauffaellige Entwurf: eine normale Seite ohne jede Besonderheit. */
function draft(overrides = {}) {
  return {
    id: 'home',
    name: 'M5 Home',
    type: 'PAGE',
    editorKind: 'normal',
    access: null,
    pin: '',
    usernames: [],
    includes: [],
    ignoreGlobalIncludes: false,
    popup: null,
    ...overrides,
  }
}

function context(overrides = {}) {
  return { nodes: NODES, includesById: { home: ['gamma'] }, ...overrides }
}

/** Die Fehlercodes eines Entwurfs, in der Reihenfolge, in der sie gemeldet werden. */
const codes = (d, ctx = context()) => validatePage(d, ctx).map((problem) => problem.code)

describe('validatePage - der unauffaellige Entwurf bleibt unbeanstandet', () => {
  it('meldet nichts fuer eine gewoehnliche Seite', () => {
    expect(validatePage(draft(), context())).toEqual([])
  })

  it('meldet nichts fuer einen Ordner ohne Seitentyp', () => {
    expect(codes(draft({ id: 'folder', type: 'LOCATION', editorKind: 'normal' }))).toEqual([])
  })

  it('braucht gar keinen Entwurf, um zu antworten', () => {
    expect(validatePage(null, context())).toEqual([])
    expect(validatePage(undefined, undefined)).toEqual([])
  })
})

describe('validatePage - Seitentyp gegen Includes (R9, R12)', () => {
  it('faengt die globale Inkludeseite ab, die selbst inkludiert', () => {
    expect(codes(draft({ editorKind: 'globalInclude', includes: ['gamma'] }))).toContain(
      PAGE_PROBLEM.globalIncludeCannotInclude,
    )
  })

  it('laesst die globale Inkludeseite ohne Includes durch', () => {
    expect(codes(draft({ editorKind: 'globalInclude', includes: [] }))).toEqual([])
  })

  it('faengt das Popup ab, das inkludiert', () => {
    expect(codes(draft({ id: 'solo', editorKind: 'popup', includes: ['gamma'] }))).toContain(
      PAGE_PROBLEM.popupCannotInclude,
    )
  })

  it('laesst das Popup ohne Includes durch', () => {
    expect(codes(draft({ id: 'solo', editorKind: 'popup', includes: [] }))).toEqual([])
  })

  it('meldet Popup-Eigenschaften an einem Nicht-Popup', () => {
    expect(codes(draft({ editorKind: 'normal', popup: { x: 10 } }))).toContain(
      PAGE_PROBLEM.popupOnlyForPopupKind,
    )
  })

  it('laesst dieselben Eigenschaften am Popup durch', () => {
    expect(codes(draft({ id: 'solo', editorKind: 'popup', popup: { x: 10 } }))).toEqual([])
  })
})

describe('validatePage - die Include-Ziele (R14)', () => {
  it('faengt den Selbst-Include ab', () => {
    expect(codes(draft({ includes: ['home'] }))).toContain(PAGE_PROBLEM.selfInclude)
  })

  it('laesst den Include einer fremden Seite durch', () => {
    expect(codes(draft({ includes: ['gamma'] }))).toEqual([])
  })

  it('faengt ein Ziel ab, das es nicht gibt', () => {
    expect(codes(draft({ includes: ['weg'] }))).toContain(PAGE_PROBLEM.includeTargetMissing)
  })

  it('nennt die betroffene Ziel-ID, damit die Meldung zeigbar ist', () => {
    const problems = validatePage(draft({ includes: ['weg'] }), context())
    expect(problems).toContainEqual({
      code: PAGE_PROBLEM.includeTargetMissing,
      params: { target: 'weg' },
    })
  })

  it('faengt einen Ordner als Include-Ziel ab', () => {
    expect(codes(draft({ includes: ['folder'] }))).toContain(PAGE_PROBLEM.includeTargetNotAPage)
  })

  it('laesst eine globale Inkludeseite als Ziel zu (Edomi erlaubt das)', () => {
    expect(codes(draft({ includes: ['globalA'] }))).toEqual([])
  })

  it('faengt ein Popup als Include-Ziel ab', () => {
    expect(codes(draft({ includes: ['popupA'] }))).toContain(PAGE_PROBLEM.includeTargetIsPopup)
  })
})

describe('validatePage - der Include-Zyklus (mehrstufig)', () => {
  const cyclic = context({ includesById: { gamma: ['zeta'], zeta: ['home'] } })

  it('faengt den mittelbaren Zyklus ab', () => {
    expect(codes(draft({ includes: ['gamma'] }), cyclic)).toContain(PAGE_PROBLEM.includeCycle)
  })

  it('laesst dieselbe Kette ohne Rueckweg durch', () => {
    const acyclic = context({ includesById: { gamma: ['zeta'], zeta: [] } })
    expect(codes(draft({ includes: ['gamma'] }), acyclic)).toEqual([])
  })

  it('laeuft sich an einem Zyklus zwischen fremden Seiten nicht fest', () => {
    const foreign = context({ includesById: { gamma: ['zeta'], zeta: ['gamma'] } })
    expect(codes(draft({ includes: ['gamma'] }), foreign)).toEqual([])
  })

  it('vertraegt eine Kette ueber ein fehlendes Glied hinweg', () => {
    const gap = context({ includesById: { gamma: ['nicht-da'] } })
    expect(codes(draft({ includes: ['gamma'] }), gap)).toEqual([])
  })
})

describe('validatePage - eine inkludierte Seite wird kein Popup', () => {
  it('faengt den Wechsel einer inkludierten Seite auf Popup ab', () => {
    expect(codes(draft({ id: 'gamma', name: 'M5 Include Gamma', editorKind: 'popup' }))).toContain(
      PAGE_PROBLEM.includedPageCannotBecomePopup,
    )
  })

  it('laesst denselben Wechsel bei einer nicht inkludierten Seite zu', () => {
    expect(codes(draft({ id: 'solo', name: 'M5 Solo', editorKind: 'popup' }))).toEqual([])
  })
})

describe('validatePage - Seitentyp nur an Seiten (LOCATION)', () => {
  it('faengt einen Seitentyp an einem Ordner ab', () => {
    expect(codes(draft({ id: 'folder', type: 'LOCATION', editorKind: 'popup' }))).toContain(
      PAGE_PROBLEM.kindOnlyForPages,
    )
  })

  it('laesst denselben Ordner mit „normal" durch', () => {
    expect(codes(draft({ id: 'folder', type: 'LOCATION', editorKind: 'normal' }))).toEqual([])
  })
})

describe('validatePage - Zugriff, PIN und Zielgruppe (E15)', () => {
  it('faengt eine Zielgruppe ohne Zugriff „user" ab', () => {
    expect(codes(draft({ access: 'public', usernames: ['e2e_resident'] }))).toContain(
      PAGE_PROBLEM.audienceRequiresUserAccess,
    )
  })

  it('laesst dieselbe Zielgruppe bei Zugriff „user" durch', () => {
    expect(codes(draft({ access: 'user', usernames: ['e2e_resident'] }))).toEqual([])
  })

  it('laesst „public" ohne Zielgruppe durch', () => {
    expect(codes(draft({ access: 'public', usernames: [] }))).toEqual([])
  })

  it('faengt eine PIN ohne Zugriff „protected" ab', () => {
    expect(codes(draft({ access: 'user', pin: '1357' }))).toContain(
      PAGE_PROBLEM.pinRequiresProtected,
    )
  })

  it('laesst dieselbe PIN bei Zugriff „protected" durch', () => {
    expect(codes(draft({ access: 'protected', pin: '1357' }))).toEqual([])
  })

  it('laesst „protected" ohne neue PIN durch (die gespeicherte bleibt)', () => {
    expect(codes(draft({ access: 'protected', pin: '' }))).toEqual([])
  })
})

describe('validatePage - der Name', () => {
  it('faengt einen leeren Namen ab', () => {
    expect(codes(draft({ name: '   ' }))).toContain(PAGE_PROBLEM.nameRequired)
  })

  it('laesst einen Namen mit Inhalt durch', () => {
    expect(codes(draft({ name: 'M5 Home' }))).toEqual([])
  })
})

describe('validatePage - mehrere Verstoesse auf einmal', () => {
  it('meldet jeden Verstoss einzeln, nicht nur den ersten', () => {
    const found = codes(draft({ name: '', includes: ['home'], pin: '1357' }))
    expect(found).toEqual(
      expect.arrayContaining([
        PAGE_PROBLEM.nameRequired,
        PAGE_PROBLEM.selfInclude,
        PAGE_PROBLEM.pinRequiresProtected,
      ]),
    )
  })

  it('verdeckt die Ziel-Pruefungen, wenn der Seitentyp schon jeden Include verbietet', () => {
    // Dieselbe Reihenfolge wie `_validate_page_kind_config`: bei globalInclude
    // bzw. popup lehnt das Backend ab, BEVOR es ein Ziel anschaut. Der Editor
    // soll denselben einen Satz zeigen und nicht zusaetzlich ueber ein Ziel
    // reden, das gar nicht zur Debatte steht.
    expect(codes(draft({ editorKind: 'globalInclude', includes: ['home', 'weg'] }))).toEqual([
      PAGE_PROBLEM.globalIncludeCannotInclude,
    ])
    expect(codes(draft({ id: 'solo', editorKind: 'popup', includes: ['solo', 'weg'] }))).toEqual([
      PAGE_PROBLEM.popupCannotInclude,
    ])
  })

  it('meldet zwei gleich kaputte Ziele einzeln, jedes mit seiner eigenen ID', () => {
    const found = codes(draft({ includes: ['weg-a', 'weg-b'] }))
    expect(found).toEqual([PAGE_PROBLEM.includeTargetMissing, PAGE_PROBLEM.includeTargetMissing])
    expect(validatePage(draft({ includes: ['weg-a', 'weg-b'] }), context())).toEqual([
      { code: PAGE_PROBLEM.includeTargetMissing, params: { target: 'weg-a' } },
      { code: PAGE_PROBLEM.includeTargetMissing, params: { target: 'weg-b' } },
    ])
  })
})

describe('PAGE_PROBLEM - jeder Code hat einen Text in beiden Sprachen', () => {
  it('deckt de und en vollstaendig ab', async () => {
    const de = (await import('@/locales/de.json')).default
    const en = (await import('@/locales/en.json')).default
    for (const code of Object.values(PAGE_PROBLEM)) {
      expect(de.visuEditor.problems[code], `de: ${code}`).toBeTruthy()
      expect(en.visuEditor.problems[code], `en: ${code}`).toBeTruthy()
    }
  })

  it('spricht bei der globalen Inkludeseite denselben Satz wie das Backend', async () => {
    const de = (await import('@/locales/de.json')).default
    expect(de.visuEditor.problems[PAGE_PROBLEM.globalIncludeCannotInclude]).toBe(
      'Eine globale Inkludeseite kann selbst keine Seiten inkludieren',
    )
  })
})
