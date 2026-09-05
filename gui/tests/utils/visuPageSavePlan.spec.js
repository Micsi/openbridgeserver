import { describe, it, expect } from 'vitest'

import { planPageSave } from '@/utils/visuPageSavePlan'

/**
 * Der Speicherplan des V2-Editors (M5 C1, Issue #168).
 *
 * Eine Seite liegt im Backend an ZWEI Stellen: der Knoten (`PATCH
 * /visu/nodes/{id}` - Name, `kind`, `order`, Zugriff, PIN, Zielgruppe) und die
 * Konfiguration (`PUT /visu/pages/{id}` - `includes`, `ignore_global_includes`,
 * `popup`). Beide werden gegeneinander validiert, und daraus folgt eine
 * REIHENFOLGE, die man nicht raten darf:
 *
 *  - `PUT /pages` prueft gegen den GESPEICHERTEN `kind` (`node.kind`), nicht
 *    gegen den gewuenschten. Ein `popup`-Deskriptor an einer Seite, die im
 *    Backend noch `normal` heisst, ist 400.
 *  - `PATCH /nodes` mit neuem `kind` prueft gegen die GESPEICHERTE Konfiguration
 *    (`_apply_kind_change`). Ein Wechsel Popup -> globale Inkludeseite scheitert,
 *    solange der alte `popup`-Deskriptor noch in der Zeile steht.
 *
 * Beides zusammen heisst: bei einem Typwechsel muss die Konfiguration ERST
 * entschaerft, DANN der Typ gesetzt und ZULETZT die neue Konfiguration
 * geschrieben werden. Genau das plant diese Funktion - als Daten, damit es
 * pruefbar ist und nicht in einer `async`-Kette versteckt liegt.
 */

const STORED_CONFIG = {
  grid_cols: 12,
  grid_row_height: 80,
  grid_cell_width: 80,
  background: null,
  widgets: [{ id: 'w1', name: 'M5 Home Delta', type: 'light' }],
  includes: [],
  ignore_global_includes: false,
  popup: null,
}

function draft(overrides = {}) {
  return {
    id: 'home',
    parentId: null,
    name: 'M5 Home',
    type: 'PAGE',
    editorKind: 'normal',
    order: 40,
    icon: null,
    access: 'public',
    pin: '',
    usernames: [],
    includes: [],
    ignoreGlobalIncludes: false,
    popup: null,
    ...overrides,
  }
}

const stored = (overrides = {}) => ({
  node: { id: 'home', name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
  config: STORED_CONFIG,
  ...overrides,
})

const ops = (...args) => planPageSave(...args).map((step) => step.op)

describe('planPageSave - eine neue Seite', () => {
  it('legt den Knoten an und schreibt danach die Konfiguration', () => {
    expect(ops(draft({ id: null, includes: ['gamma'] }), { node: null, config: null })).toEqual([
      'createNode',
      'savePage',
    ])
  })

  it('schickt Typ, Ort, Reihenfolge und Zugriff schon beim Anlegen mit', () => {
    const [create] = planPageSave(
      draft({ id: null, parentId: 'eg', editorKind: 'popup', access: 'protected', pin: '1357' }),
      { node: null, config: null },
    )
    expect(create.body).toEqual({
      parent_id: 'eg',
      name: 'M5 Home',
      type: 'PAGE',
      kind: 'popup',
      order: 40,
      icon: null,
      access: 'protected',
      access_pin: '1357',
    })
  })

  it('bildet die Inkludeseite auf den Backend-Wert „normal" ab', () => {
    const [create] = planPageSave(draft({ id: null, editorKind: 'include' }), {
      node: null,
      config: null,
    })
    expect(create.body.kind).toBe('normal')
  })

  it('spart die Konfiguration, wenn nichts von der Vorgabe abweicht', () => {
    expect(ops(draft({ id: null }), { node: null, config: null })).toEqual(['createNode'])
  })

  it('legt einen Ordner ohne Konfiguration an', () => {
    expect(ops(draft({ id: null, type: 'LOCATION' }), { node: null, config: null })).toEqual([
      'createNode',
    ])
  })

  it('traegt die Zielgruppe nach, weil das Anlegen sie nicht kennt', () => {
    const plan = planPageSave(
      draft({ id: null, access: 'user', usernames: ['e2e_resident'] }),
      { node: null, config: null },
    )
    expect(plan.map((s) => s.op)).toEqual(['createNode', 'patchNode'])
    expect(plan[1].body).toEqual({ usernames: ['e2e_resident'] })
  })
})

describe('planPageSave - eine bestehende Seite ohne Typwechsel', () => {
  it('schreibt Knoten und Konfiguration je einmal', () => {
    expect(ops(draft({ includes: ['gamma'] }), stored())).toEqual(['patchNode', 'savePage'])
  })

  it('schickt keinen `kind`, wenn er sich nicht geaendert hat', () => {
    const [patch] = planPageSave(draft(), stored())
    expect(patch.body).not.toHaveProperty('kind')
  })

  it('erkennt „normal" und „Inkludeseite" als denselben Backend-Wert', () => {
    const [patch] = planPageSave(draft({ editorKind: 'include' }), stored())
    expect(patch.body).not.toHaveProperty('kind')
  })

  it('behaelt Raster, Hintergrund und Widgets der gespeicherten Konfiguration', () => {
    const plan = planPageSave(draft({ includes: ['gamma'] }), stored())
    expect(plan[1].body).toEqual({
      ...STORED_CONFIG,
      includes: ['gamma'],
      ignore_global_includes: false,
      popup: null,
    })
  })

  it('faellt ohne gespeicherte Konfiguration auf die Vorgabe zurueck', () => {
    const plan = planPageSave(draft({ ignoreGlobalIncludes: true }), stored({ config: null }))
    expect(plan[1].body.ignore_global_includes).toBe(true)
    expect(plan[1].body.widgets).toEqual([])
  })

  it('schickt die Zielgruppe nur bei Zugriff „user"', () => {
    const [publicPatch] = planPageSave(draft({ usernames: ['e2e_resident'] }), stored())
    expect(publicPatch.body).not.toHaveProperty('usernames')
    const [userPatch] = planPageSave(
      draft({ access: 'user', usernames: ['e2e_resident'] }),
      stored(),
    )
    expect(userPatch.body.usernames).toEqual(['e2e_resident'])
  })

  it('schickt eine PIN nur, wenn eine getippt wurde', () => {
    const [ohne] = planPageSave(draft({ access: 'protected' }), stored())
    expect(ohne.body).not.toHaveProperty('access_pin')
    const [mit] = planPageSave(draft({ access: 'protected', pin: '1357' }), stored())
    expect(mit.body.access_pin).toBe('1357')
  })

  it('schreibt fuer einen Ordner nur den Knoten', () => {
    expect(
      ops(draft({ id: 'eg', type: 'LOCATION' }), {
        node: { id: 'eg', type: 'LOCATION', kind: 'normal' },
        config: null,
      }),
    ).toEqual(['patchNode'])
  })
})

describe('planPageSave - der Typwechsel braucht drei Schritte', () => {
  it('entschaerft, wechselt, schreibt - in dieser Reihenfolge', () => {
    expect(ops(draft({ editorKind: 'popup', popup: { x: 140, y: 90 } }), stored())).toEqual([
      'savePage',
      'patchNode',
      'savePage',
    ])
  })

  it('nimmt dem ersten Schritt Popup und Includes weg, damit er unter dem ALTEN Typ passt', () => {
    const stale = stored({
      node: { id: 'home', type: 'PAGE', kind: 'popup' },
      config: { ...STORED_CONFIG, popup: { x: 1, y: 2 }, includes: [] },
    })
    const plan = planPageSave(draft({ editorKind: 'globalInclude' }), stale)
    expect(plan[0].body.popup).toBeNull()
    expect(plan[0].body.includes).toEqual([])
    expect(plan[0].body.widgets).toEqual(STORED_CONFIG.widgets)
  })

  it('setzt den neuen Typ erst im zweiten Schritt', () => {
    const plan = planPageSave(draft({ editorKind: 'globalInclude' }), stored())
    expect(plan[1].body.kind).toBe('globalInclude')
  })

  it('schreibt den Popup-Deskriptor erst, wenn der Knoten „popup" heisst', () => {
    const plan = planPageSave(draft({ editorKind: 'popup', popup: { x: 140 } }), stored())
    expect(plan[2].body.popup).toEqual({ x: 140 })
  })

  it('braucht auch beim Wechsel auf einen Typ ohne Konfigurationsanteil drei Schritte', () => {
    // Der letzte Schritt ist NICHT ueberfluessig: Schritt 1 hat die gespeicherten
    // Includes weggenommen, und der Autor kann sie behalten wollen.
    const withIncludes = stored({ config: { ...STORED_CONFIG, includes: ['gamma'] } })
    const plan = planPageSave(draft({ editorKind: 'globalInclude' }), withIncludes)
    expect(plan.map((s) => s.op)).toEqual(['savePage', 'patchNode', 'savePage'])
    expect(plan[2].body.includes).toEqual([])
  })
})

describe('planPageSave - was gar nichts zu tun gibt', () => {
  it('liefert ohne Entwurf einen leeren Plan', () => {
    expect(planPageSave(null, stored())).toEqual([])
    expect(planPageSave(undefined, undefined)).toEqual([])
  })

  it('nennt jeden Schritt mit der Knoten-ID, damit der Aufrufer nicht raten muss', () => {
    for (const step of planPageSave(draft({ includes: ['gamma'] }), stored())) {
      expect(step.nodeId).toBe('home')
    }
  })
})
