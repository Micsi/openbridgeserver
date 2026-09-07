import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Der Zustand des V2-Editors (M5 C1, Issue #168).
 *
 * Der Store haelt den Baum, die geladenen Seiten-Konfigurationen und den
 * Entwurf, den der Autor gerade bearbeitet - und er ist die Stelle, an der die
 * verbotenen Kombinationen VOR dem Speichern greifen: `canSave` ist falsch,
 * solange `problems` etwas meldet, und `save()` schickt dann gar nichts los.
 */

const TREE = [
  { id: 'eg', parent_id: null, name: 'M5 Ordner', type: 'LOCATION', kind: 'normal', order: 0, access: null },
  { id: 'home', parent_id: null, name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
  { id: 'gamma', parent_id: null, name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal', order: 30, access: 'public' },
  { id: 'popupA', parent_id: null, name: 'M5 Popup Positioned', type: 'PAGE', kind: 'popup', order: 60, access: 'public' },
  { id: 'guard', parent_id: null, name: 'M5 Guard User', type: 'PAGE', kind: 'normal', order: 70, access: 'user' },
]

const CONFIGS = {
  home: { grid_cols: 12, widgets: [], includes: ['gamma'], ignore_global_includes: false, popup: null },
  gamma: { grid_cols: 12, widgets: [], includes: [], ignore_global_includes: false, popup: null },
  popupA: { grid_cols: 12, widgets: [], includes: [], ignore_global_includes: false, popup: { x: 140, y: 90, w: 260, h: 180, auto_close_ms: null, modal: false, animate: false, shadow: true, dim_backdrop: false } },
  guard: { grid_cols: 12, widgets: [], includes: [], ignore_global_includes: false, popup: null },
}

let visuApi

function apiMock() {
  return {
    tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getPage: vi.fn().mockImplementation((id) =>
      CONFIGS[id]
        ? Promise.resolve({ data: JSON.parse(JSON.stringify(CONFIGS[id])) })
        : Promise.reject(Object.assign(new Error('404'), { response: { status: 404 } })),
    ),
    savePage: vi.fn().mockResolvedValue({ status: 204 }),
    createNode: vi.fn().mockResolvedValue({ data: { id: 'neu' } }),
    updateNode: vi.fn().mockResolvedValue({ data: {} }),
    deleteNode: vi.fn().mockResolvedValue({ status: 204 }),
    moveNode: vi.fn().mockResolvedValue({ data: {} }),
    nodeUsers: vi.fn().mockImplementation((id) =>
      Promise.resolve({ data: id === 'guard' ? ['e2e_resident'] : [] }),
    ),
    usernames: vi.fn().mockResolvedValue({
      data: [
        { username: 'admin', is_admin: true },
        { username: 'e2e_resident', is_admin: false },
        { username: 'e2e_operator', is_admin: false },
      ],
    }),
  }
}

beforeEach(() => {
  vi.resetModules()
  setActivePinia(createPinia())
  // Die Skin-Wahl je Seite liegt im Browser-Speicher (E19, siehe `visuSkins.js`).
  // Ohne dieses Aufraeumen traegt ein Szenario seine Wahl ins naechste.
  globalThis.localStorage.clear?.()
  visuApi = apiMock()
  vi.doMock('@/api/visu', () => ({ visuApi }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
})

async function loadedStore() {
  const { useVisuEditorStore } = await import('@/stores/visuEditor')
  const store = useVisuEditorStore()
  await store.load()
  return store
}

describe('visuEditor - laden', () => {
  it('holt den Baum und die Konfiguration jeder Seite', async () => {
    const store = await loadedStore()
    expect(store.nodes).toHaveLength(5)
    expect(visuApi.getPage).toHaveBeenCalledTimes(4)
    expect(visuApi.getPage).not.toHaveBeenCalledWith('eg')
  })

  it('leitet aus den Includes ab, welche Seite eine Inkludeseite ist', async () => {
    const store = await loadedStore()
    expect([...store.referencedIds]).toEqual(['gamma'])
  })

  it('haelt eine verdeckte Seite aus, statt den ganzen Baum fallen zu lassen', async () => {
    visuApi.getPage.mockImplementation((id) =>
      id === 'guard'
        ? Promise.reject(Object.assign(new Error('403'), { response: { status: 403 } }))
        : Promise.resolve({ data: JSON.parse(JSON.stringify(CONFIGS[id] ?? {})) }),
    )
    const store = await loadedStore()
    expect(store.nodes).toHaveLength(5)
    expect(store.loadError).toBe(false)
    expect(store.pageConfigs.guard).toBeUndefined()
  })

  it('meldet einen Fehler, wenn schon der Baum nicht kommt', async () => {
    visuApi.tree.mockRejectedValue(new Error('kaputt'))
    const store = await loadedStore()
    expect(store.loadError).toBe(true)
    expect(store.nodes).toEqual([])
  })

  it('holt die Nutzerliste fuer die Zielgruppen-Auswahl - ohne Admins', async () => {
    // Ein Admin ist als Zielgruppen-Mitglied ungueltig: `_validate_target_usernames`
    // (`obs/api/v1/visu.py:635-650`) antwortet mit 422. Wer ihn gar nicht erst
    // anbietet, produziert die Ablehnung nicht.
    const store = await loadedStore()
    expect(store.allUsernames).toEqual(['e2e_resident', 'e2e_operator'])
  })

  it('bleibt ohne Nutzerliste bedienbar', async () => {
    visuApi.usernames.mockRejectedValue(new Error('403'))
    const store = await loadedStore()
    expect(store.allUsernames).toEqual([])
    expect(store.loadError).toBe(false)
  })
})

describe('visuEditor - auswaehlen und den Entwurf fuellen', () => {
  it('fuellt jede Eigenschaft einer Popup-Seite in den Entwurf', async () => {
    const store = await loadedStore()
    await store.select('popupA')
    expect(store.draft).toMatchObject({
      id: 'popupA',
      name: 'M5 Popup Positioned',
      editorKind: 'popup',
      access: 'public',
      includes: [],
      ignoreGlobalIncludes: false,
    })
    expect(store.draft.popup).toMatchObject({ x: 140, y: 90, w: 260, h: 180, shadow: true })
  })

  it('nennt eine inkludierte Seite „Inkludeseite"', async () => {
    const store = await loadedStore()
    await store.select('gamma')
    expect(store.draft.editorKind).toBe('include')
  })

  it('nennt eine nicht inkludierte Seite „normal"', async () => {
    const store = await loadedStore()
    await store.select('home')
    expect(store.draft.editorKind).toBe('normal')
  })

  it('laedt die Zielgruppe einer user-Seite', async () => {
    const store = await loadedStore()
    await store.select('guard')
    expect(store.draft.usernames).toEqual(['e2e_resident'])
  })

  it('bleibt ohne Zielgruppen-Antwort bedienbar', async () => {
    visuApi.nodeUsers.mockRejectedValue(new Error('403'))
    const store = await loadedStore()
    await store.select('guard')
    expect(store.draft.usernames).toEqual([])
  })

  it('legt beim Wechsel auf Popup einen leeren Deskriptor an', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.setEditorKind('popup')
    expect(store.draft.popup).toEqual({
      x: null,
      y: null,
      w: null,
      h: null,
      auto_close_ms: null,
      modal: false,
      animate: false,
      shadow: false,
      dim_backdrop: false,
    })
  })

  it('nimmt den Deskriptor beim Wechsel weg - sonst entstuende eine verbotene Kombination', async () => {
    const store = await loadedStore()
    await store.select('popupA')
    store.setEditorKind('normal')
    expect(store.draft.popup).toBeNull()
    expect(store.problems).toEqual([])
  })

  it('behaelt den gespeicherten Deskriptor, wenn der Typ Popup bleibt', async () => {
    const store = await loadedStore()
    await store.select('popupA')
    store.setEditorKind('popup')
    expect(store.draft.popup).toMatchObject({ x: 140, shadow: true })
  })

  it('tut ohne Entwurf beim Typwechsel nichts', async () => {
    const store = await loadedStore()
    store.setEditorKind('popup')
    expect(store.draft).toBeNull()
  })

  it('vergisst den Entwurf, wenn nichts ausgewaehlt ist', async () => {
    const store = await loadedStore()
    await store.select('home')
    await store.select(null)
    expect(store.draft).toBeNull()
    expect(store.problems).toEqual([])
  })

  it('waehlt einen Ordner aus, ohne eine Seiten-Konfiguration zu erfinden', async () => {
    const store = await loadedStore()
    await store.select('eg')
    expect(store.draft).toMatchObject({ id: 'eg', type: 'LOCATION' })
    expect(store.draft.popup).toBeNull()
  })

  it('meldet eine unbekannte Auswahl, statt einen leeren Entwurf zu zeigen', async () => {
    const store = await loadedStore()
    await store.select('gibt-es-nicht')
    expect(store.draft).toBeNull()
    expect(store.selectedId).toBe('gibt-es-nicht')
  })
})

describe('visuEditor - anlegen', () => {
  it('legt einen Seiten-Entwurf ohne ID an', async () => {
    const store = await loadedStore()
    store.newPage('eg')
    expect(store.draft).toMatchObject({ id: null, type: 'PAGE', editorKind: 'normal', parentId: 'eg' })
    expect(visuApi.createNode).not.toHaveBeenCalled()
  })

  it('legt einen Ordner-Entwurf an', async () => {
    const store = await loadedStore()
    store.newFolder(null)
    expect(store.draft).toMatchObject({ id: null, type: 'LOCATION', parentId: null })
  })

  it('setzt den neuen Knoten hinter das letzte Geschwisterkind', async () => {
    const store = await loadedStore()
    store.newPage(null)
    expect(store.draft.order).toBe(71)
  })

  it('verwirft einen Entwurf auf Wunsch', async () => {
    const store = await loadedStore()
    store.newPage(null)
    store.discard()
    expect(store.draft).toBeNull()
  })
})

describe('visuEditor - die verbotenen Kombinationen greifen VOR dem Speichern', () => {
  it('sperrt das Speichern, sobald eine globale Inkludeseite inkludiert', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.draft.editorKind = 'globalInclude'
    expect(store.problems.map((p) => p.code)).toContain('globalIncludeCannotInclude')
    expect(store.canSave).toBe(false)
  })

  it('schickt in diesem Zustand nichts los', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.draft.editorKind = 'globalInclude'
    await store.save()
    expect(visuApi.savePage).not.toHaveBeenCalled()
    expect(visuApi.updateNode).not.toHaveBeenCalled()
  })

  it('gibt das Speichern frei, sobald der Verstoss weg ist', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.draft.editorKind = 'globalInclude'
    store.draft.includes = []
    expect(store.problems).toEqual([])
    expect(store.canSave).toBe(true)
  })

  it('faengt auch das Popup ab, das inkludiert wird', async () => {
    const store = await loadedStore()
    await store.select('gamma')
    store.draft.editorKind = 'popup'
    expect(store.problems.map((p) => p.code)).toContain('includedPageCannotBecomePopup')
  })
})

describe('visuEditor - speichern', () => {
  it('schreibt Knoten und Konfiguration einer bestehenden Seite', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.draft.name = 'M5 Home Neu'
    store.draft.ignoreGlobalIncludes = true
    await store.save()
    expect(visuApi.updateNode).toHaveBeenCalledWith('home', expect.objectContaining({ name: 'M5 Home Neu' }))
    expect(visuApi.savePage).toHaveBeenCalledWith(
      'home',
      expect.objectContaining({ ignore_global_includes: true, includes: ['gamma'] }),
    )
    expect(store.savedAt).toBeGreaterThan(0)
  })

  it('legt eine neue Seite an und waehlt sie danach aus', async () => {
    const store = await loadedStore()
    store.newPage(null)
    store.draft.name = 'RT Popup Round-Trip'
    store.draft.editorKind = 'popup'
    store.draft.popup = { x: 140, y: 90, w: 260, h: 180, auto_close_ms: 2000, modal: true, animate: false, shadow: true, dim_backdrop: false }
    visuApi.tree.mockResolvedValue({
      data: [...TREE, { id: 'neu', parent_id: null, name: 'RT Popup Round-Trip', type: 'PAGE', kind: 'popup', order: 71, access: null }],
    })
    await store.save()
    expect(visuApi.createNode).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RT Popup Round-Trip', kind: 'popup' }),
    )
    expect(visuApi.savePage).toHaveBeenCalledWith('neu', expect.objectContaining({ popup: expect.objectContaining({ auto_close_ms: 2000, modal: true }) }))
    expect(store.selectedId).toBe('neu')
  })

  /**
   * Die Erfolgsmeldung gehoert dem LAUFENDEN Speichervorgang, nicht dem vorigen.
   *
   * Ohne diese Zusage stuende „Gespeichert" waehrend des zweiten Speicherns
   * unveraendert da - der Autor saehe eine Bestaetigung fuer eine Aenderung, die
   * noch unterwegs ist, und der Playwright-Harness liest sie als Schranke
   * (E9/E15: speichern, dann am Server nachlesen). Gemessen: genau daran ist E9
   * gerissen, sobald der Zwischen-Ladevorgang wegfiel, der die Meldung bis dahin
   * beilaeufig mitgeloescht hatte (`nodeOf().kind` war noch `normal`).
   */
  it('loescht die Erfolgsmeldung, solange der naechste Speichervorgang laeuft', async () => {
    const store = await loadedStore()
    await store.select('home')
    await store.save()
    expect(store.savedAt).toBeGreaterThan(0)

    let quittieren
    visuApi.updateNode.mockImplementationOnce(
      () => new Promise((resolve) => { quittieren = () => resolve({ data: {} }) }),
    )
    store.draft.name = 'M5 Home Neu'
    const laeuft = store.save()
    await Promise.resolve()
    expect(store.savedAt).toBe(0)

    quittieren()
    await laeuft
    expect(store.savedAt).toBeGreaterThan(0)
  })

  it('wechselt den Seitentyp in drei Schritten, damit keiner am anderen scheitert', async () => {
    const store = await loadedStore()
    await store.select('popupA')
    store.setEditorKind('globalInclude')
    await store.save()
    expect(visuApi.savePage).toHaveBeenCalledTimes(2)
    expect(visuApi.savePage.mock.calls[0][1].popup).toBeNull()
    expect(visuApi.updateNode).toHaveBeenCalledWith('popupA', expect.objectContaining({ kind: 'globalInclude' }))
  })

  it('meldet die Ablehnung des Backends im Klartext, statt sie zu verschlucken', async () => {
    const store = await loadedStore()
    await store.select('home')
    visuApi.savePage.mockRejectedValue({
      response: { status: 400, data: { detail: 'Include-Ziel existiert nicht' } },
    })
    await store.save()
    expect(store.saveError).toBe('Include-Ziel existiert nicht')
    expect(store.savedAt).toBe(0)
  })

  it('macht aus einer Ablehnung ohne lesbaren Text keine leere Meldung', async () => {
    const store = await loadedStore()
    await store.select('home')
    visuApi.savePage.mockRejectedValue({ response: { status: 500, data: {} } })
    await store.save()
    expect(store.saveError).toBeTruthy()
  })

  it('raeumt eine alte Meldung weg, sobald es klappt', async () => {
    const store = await loadedStore()
    await store.select('home')
    visuApi.savePage.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'nein' } } })
    await store.save()
    expect(store.saveError).toBe('nein')
    await store.save()
    expect(store.saveError).toBeNull()
  })

  it('speichert ohne Entwurf gar nichts', async () => {
    const store = await loadedStore()
    await store.save()
    expect(visuApi.updateNode).not.toHaveBeenCalled()
  })
})

describe('visuEditor - umbenennen, verschieben, loeschen', () => {
  it('verschiebt einen Knoten unter einen anderen Elternknoten', async () => {
    const store = await loadedStore()
    await store.moveTo('home', 'eg')
    expect(visuApi.moveNode).toHaveBeenCalledWith('home', { new_parent_id: 'eg', order: 40 })
  })

  it('verweigert den Zug in den eigenen Teilbaum', async () => {
    const store = await loadedStore()
    visuApi.tree.mockResolvedValue({
      data: [
        { id: 'a', parent_id: null, name: 'A', type: 'LOCATION', kind: 'normal', order: 0 },
        { id: 'b', parent_id: 'a', name: 'B', type: 'LOCATION', kind: 'normal', order: 0 },
      ],
    })
    await store.load()
    await store.moveTo('a', 'b')
    expect(visuApi.moveNode).not.toHaveBeenCalled()
  })

  it('tauscht die Reihenfolge mit dem Nachbarn', async () => {
    const store = await loadedStore()
    await store.nudge('home', -1)
    expect(visuApi.updateNode).toHaveBeenCalledWith('home', { order: 30 })
    expect(visuApi.updateNode).toHaveBeenCalledWith('gamma', { order: 40 })
  })

  it('tut am Rand der Ebene nichts', async () => {
    const store = await loadedStore()
    // `eg` ist der erste Knoten der Wurzelebene (order 0) - ueber ihm ist nichts.
    await store.nudge('eg', -1)
    expect(visuApi.updateNode).not.toHaveBeenCalled()
  })

  it('loescht einen Knoten und vergisst seine Auswahl', async () => {
    const store = await loadedStore()
    await store.select('home')
    visuApi.tree.mockResolvedValue({ data: TREE.filter((n) => n.id !== 'home') })
    await store.remove('home')
    expect(visuApi.deleteNode).toHaveBeenCalledWith('home')
    expect(store.selectedId).toBeNull()
    expect(store.draft).toBeNull()
  })

  it('meldet einen abgelehnten Zug, statt ihn zu verschweigen', async () => {
    const store = await loadedStore()
    visuApi.moveNode.mockRejectedValue({ response: { status: 403, data: { detail: 'Zugriff verweigert' } } })
    await store.moveTo('home', 'eg')
    expect(store.saveError).toBe('Zugriff verweigert')
  })

  it('meldet eine abgelehnte Umordnung, statt sie zu verschweigen', async () => {
    const store = await loadedStore()
    visuApi.updateNode.mockRejectedValue({ response: { status: 403, data: { detail: 'Zugriff verweigert' } } })
    await store.nudge('home', -1)
    expect(store.saveError).toBe('Zugriff verweigert')
  })

  it('haelt die Auswahl ueber einen Zug hinweg', async () => {
    const store = await loadedStore()
    await store.select('home')
    await store.moveTo('home', 'eg')
    expect(store.selectedId).toBe('home')
    expect(store.draft).not.toBeNull()
  })

  it('haelt die Auswahl ueber eine Umordnung hinweg', async () => {
    const store = await loadedStore()
    await store.select('home')
    await store.nudge('home', -1)
    expect(store.selectedId).toBe('home')
  })

  it('macht aus einem 422 mit Fehlercode eine zeigbare Meldung', async () => {
    const store = await loadedStore()
    await store.select('guard')
    visuApi.updateNode.mockRejectedValue({
      response: { status: 422, data: { detail: { code: 'visu_target_audience_requires_user_access' } } },
    })
    await store.save()
    expect(store.saveError).toBe('visu_target_audience_requires_user_access')
  })

  it('meldet eine abgelehnte Loeschung, statt sie zu verschweigen', async () => {
    const store = await loadedStore()
    visuApi.deleteNode.mockRejectedValue({ response: { status: 403, data: { detail: 'Zugriff verweigert' } } })
    await store.remove('home')
    expect(store.saveError).toBe('Zugriff verweigert')
  })
})

describe('visuEditor - „Inkludeseite" ist abgeleitet, nicht gesetzt (E9)', () => {
  /*
   * Gemessen an der laufenden Instanz: Seitentyp „Inkludeseite" waehlen,
   * „Gespeichert" erscheint - nach dem Reload steht wieder `normal` da, weil das
   * Backend fuer die Rolle keinen Spaltenwert kennt (A0-Entscheid). Ein Klick
   * ohne Wirkung, quittiert mit einer Erfolgsmeldung. Der Editor sagt es jetzt
   * vorher, statt still zurueckzufallen.
   */
  it('zeigt eine inkludierte Seite als Inkludeseite und laesst sie speichern', async () => {
    const store = await loadedStore()
    await store.select('gamma')
    expect(store.draft.editorKind).toBe('include')
    expect(store.problems).toEqual([])
    expect(store.canSave).toBe(true)
  })

  it('sperrt „Inkludeseite" an einer Seite, die niemand inkludiert', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.setEditorKind('include')
    expect(store.problems.map((p) => p.code)).toEqual(['includeKindNeedsReference'])
    expect(store.canSave).toBe(false)
  })

  it('sperrt „normal" an einer inkludierten Seite', async () => {
    const store = await loadedStore()
    await store.select('gamma')
    store.setEditorKind('normal')
    expect(store.problems.map((p) => p.code)).toEqual(['normalKindWhileIncluded'])
    expect(store.canSave).toBe(false)
  })

  it('schickt in diesem Zustand nichts los - „Gespeichert" waere gelogen', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.setEditorKind('include')
    await store.save()
    expect(visuApi.updateNode).not.toHaveBeenCalled()
    expect(visuApi.savePage).not.toHaveBeenCalled()
    expect(store.savedAt).toBe(0)
  })
})

describe('visuEditor - eine Bestandsseite bleibt speicherbar (R17)', () => {
  /*
   * `_validate_page_kind_config` ueberspringt bereits gespeicherte Include-
   * Eintraege (`obs/api/v1/visu.py:415,419-420`) - ausdruecklich, damit eine
   * Seite nie dauerhaft unspeicherbar wird. Der Editor darf nicht strenger sein
   * als das Backend, sonst sperrt er genau den Bestandsfall aus, fuer den die
   * Ausnahme gebaut wurde.
   */
  async function storeWithOrphanInclude() {
    visuApi.getPage.mockImplementation((id) =>
      Promise.resolve({
        data:
          id === 'home'
            ? { grid_cols: 12, widgets: [], includes: ['gamma', 'weg'], ignore_global_includes: false, popup: null }
            : JSON.parse(JSON.stringify(CONFIGS[id] ?? { widgets: [], includes: [] })),
      }),
    )
    const store = await loadedStore()
    await store.select('home')
    return store
  }

  it('laesst die Seite mit dem verwaisten Eintrag speichern', async () => {
    const store = await storeWithOrphanInclude()
    expect(store.storedIncludes).toEqual(['gamma', 'weg'])
    expect(store.problems).toEqual([])
    expect(store.canSave).toBe(true)
  })

  it('bleibt streng, sobald ein NEUER kaputter Eintrag dazukommt', async () => {
    const store = await storeWithOrphanInclude()
    store.draft.includes = [...store.draft.includes, 'auch-weg']
    expect(store.problems).toEqual([
      { code: 'includeTargetMissing', params: { target: 'auch-weg' } },
    ])
    expect(store.canSave).toBe(false)
  })
})

describe('visuEditor - die Zielgruppe aus echten Nutzern (E15)', () => {
  it('bietet keinen Admin als Zielgruppen-Mitglied an', async () => {
    const store = await loadedStore()
    expect(store.allUsernames).toEqual(['e2e_resident', 'e2e_operator'])
    expect(store.usernamesLoaded).toBe(true)
  })

  it('meldet einen Namen, den die Nutzerliste nicht kennt (422 vorweggenommen)', async () => {
    const store = await loadedStore()
    await store.select('guard')
    store.draft.access = 'user'
    store.draft.usernames = ['e2e_resident', 'weg']
    expect(store.problems).toEqual([{ code: 'audienceUserUnknown', params: { user: 'weg' } }])
    expect(store.canSave).toBe(false)
  })

  it('schweigt, wenn die Nutzerliste gar nicht geladen werden konnte', async () => {
    visuApi.usernames.mockRejectedValue(new Error('500'))
    const store = await loadedStore()
    await store.select('guard')
    store.draft.access = 'user'
    store.draft.usernames = ['e2e_resident']
    expect(store.usernamesLoaded).toBe(false)
    expect(store.problems).toEqual([])
    expect(store.canSave).toBe(true)
  })
})

describe('visuEditor - der Skin je Seite (E19)', () => {
  it('faellt ohne Wahl auf die Vorgabe zurueck', async () => {
    const store = await loadedStore()
    await store.select('home')
    expect(store.skin).toBe('edomi')
  })

  it('behaelt die Wahl je Seite ueber einen Wechsel hinweg', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.setSkin('terminal')
    await store.select('gamma')
    expect(store.skin).toBe('edomi')
    await store.select('home')
    expect(store.skin).toBe('terminal')
  })

  it('nimmt keinen Skin an, den die Vorschau nicht kennt', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.setSkin('gibt-es-nicht')
    expect(store.skin).toBe('edomi')
  })

  /*
   * Die Naht zu Teil C2 (#169): sobald `PageConfig` das Feld fuehrt, liest und
   * schreibt der Editor es - und vorher schickt er es NICHT mit, weil das
   * Backend ein unbekanntes Feld still verwirft.
   */
  it('schickt heute kein Skin-Feld mit - das Backend wuerde es still verwerfen', async () => {
    const store = await loadedStore()
    await store.select('home')
    store.setSkin('terminal')
    expect(store.skinSupported).toBe(false)
    await store.save()
    const [, body] = visuApi.savePage.mock.calls.at(-1)
    expect(body).not.toHaveProperty('skin')
  })

  it('liest den Skin aus der Seite, sobald das Backend ihn fuehrt', async () => {
    visuApi.getPage.mockImplementation((id) =>
      Promise.resolve({
        data: { ...JSON.parse(JSON.stringify(CONFIGS[id] ?? { widgets: [] })), skin: id === 'home' ? 'terminal' : null },
      }),
    )
    const store = await loadedStore()
    await store.select('home')
    expect(store.skinSupported).toBe(true)
    expect(store.skin).toBe('terminal')
    // Und die Seite schlaegt den Browser-Speicher: er ist nur der Notbehelf.
    await store.select('gamma')
    expect(store.skin).toBe('edomi')
  })

  it('schreibt den Skin mit, sobald das Backend das Feld fuehrt', async () => {
    visuApi.getPage.mockImplementation((id) =>
      Promise.resolve({
        data: { ...JSON.parse(JSON.stringify(CONFIGS[id] ?? { widgets: [] })), skin: null },
      }),
    )
    const store = await loadedStore()
    await store.select('home')
    store.setSkin('terminal')
    await store.save()
    const [, body] = visuApi.savePage.mock.calls.at(-1)
    expect(body.skin).toBe('terminal')
  })
})

describe('visuEditor - der Entwurf fuer die Vorschau', () => {
  it('reicht den Baum in der Backend-Form samt Seitentyp hinueber', async () => {
    const store = await loadedStore()
    await store.select('popupA')
    expect(store.previewDraft).toMatchObject({ skin: 'edomi', pageId: 'popupA' })
    const node = store.previewDraft.nodes.find((n) => n.id === 'popupA')
    expect(node).toMatchObject({ type: 'PAGE', kind: 'popup' })
    expect(node.page_config.popup).toMatchObject({ x: 140, y: 90 })
  })

  it('zeigt den UNGESPEICHERTEN Entwurf, nicht den gespeicherten Stand', async () => {
    const store = await loadedStore()
    await store.select('popupA')
    store.draft.popup.x = 999
    const node = store.previewDraft.nodes.find((n) => n.id === 'popupA')
    expect(node.page_config.popup.x).toBe(999)
  })

  it('ist reine Daten - der strukturierte Klon von `postMessage` nimmt ihn an', async () => {
    const store = await loadedStore()
    await store.select('popupA')
    // Ein Vue-Proxy wuerde hier mit „could not be cloned" scheitern; genau daran
    // starb die Bruecke im Browser, bevor der Entwurf ueberhaupt ankam.
    expect(() => structuredClone(store.previewDraft)).not.toThrow()
  })

  it('liefert ohne Auswahl keinen Entwurf', async () => {
    const store = await loadedStore()
    expect(store.previewDraft).toBeNull()
  })

  it('liefert fuer einen Ordner keinen Entwurf - der Ordner ist keine Seite', async () => {
    const store = await loadedStore()
    await store.select('eg')
    expect(store.previewDraft).toBeNull()
  })
})

/**
 * DIE HINRICHTUNG von Micsi/openbridgeserver#187 (Folge-Welle F2, Issue #187):
 * Canvas speichert Elemente -> die Seiteneigenschaften duerfen ihren naechsten
 * eigenen Speicherplan nicht mehr auf `pageConfigs[id]` vom AUSWAEHLEN der
 * Seite bauen, sonst schreibt er die Widget-Liste von davor zurueck
 * (`utils/visuPageSavePlan.js` -> `pageBody()` spreadet `storedConfig`).
 * `refreshPageConfig()` ist die Antwort: der Canvas ruft sie ueber `afterSave`
 * (`VisuEditorView.vue` -> `nachSpeichern()`) nach jedem eigenen Speichern.
 *
 * Diese Richtung war schon geschlossen, bevor Aufgabe 1 der Folge-Welle begann
 * (die GEGENRICHTUNG, Eigenschaften -> Canvas, ist erst hier dazugekommen und
 * steht in `gui/tests/components/visu/VisuEditorCanvas.f2.spec.js`). Die Probe
 * hier haelt fest, dass sie es bleibt.
 */
describe('visuEditor - refreshPageConfig (#187, Hinrichtung: Canvas speichert -> Eigenschaften lesen frisch)', () => {
  it('liest die gespeicherte Konfiguration EINER Seite frisch ein, ohne den Baum neu zu laden', async () => {
    const store = await loadedStore()
    expect(store.pageConfigs.home.widgets).toEqual([])

    const frischeWidgets = [{ id: 'w1', name: 'Vom Canvas gespeichert', type: 'Toggle', config: {} }]
    visuApi.getPage.mockImplementation((id) =>
      id === 'home'
        ? Promise.resolve({ data: { ...CONFIGS.home, widgets: frischeWidgets } })
        : Promise.resolve({ data: JSON.parse(JSON.stringify(CONFIGS[id] ?? {})) }),
    )
    const treeVorher = visuApi.tree.mock.calls.length

    await store.refreshPageConfig('home')

    expect(store.pageConfigs.home.widgets).toEqual(frischeWidgets)
    // Ein Neuladen des GANZEN Baums waere mehr, als hier noetig ist - und teurer.
    expect(visuApi.tree.mock.calls.length).toBe(treeVorher)
  })

  it('schreibt dabei nichts - ein reines GET, kein neuer Schreiber', async () => {
    const store = await loadedStore()
    await store.refreshPageConfig('home')
    expect(visuApi.savePage).not.toHaveBeenCalled()
  })

  it('bewahrt den frisch gelesenen Stand vor dem naechsten Speicherplan der Seiteneigenschaften', async () => {
    // Genau das Szenario aus #187: der Canvas hat ein Widget gespeichert, DANACH
    // speichert das Eigenschaftsformular (z. B. nur den Skin). Ohne das
    // Nachlesen baute `planPageSave()` seine Nutzlast auf der alten,
    // widget-losen Konfiguration und schriebe die neue Kachel weg.
    const store = await loadedStore()
    await store.select('home')

    const frischeWidgets = [{ id: 'w1', name: 'Vom Canvas gespeichert', type: 'Toggle', config: {} }]
    visuApi.getPage.mockImplementation((id) =>
      id === 'home'
        ? Promise.resolve({ data: { ...CONFIGS.home, widgets: frischeWidgets } })
        : Promise.resolve({ data: JSON.parse(JSON.stringify(CONFIGS[id] ?? {})) }),
    )
    await store.refreshPageConfig('home')

    store.draft.name = 'M5 Home, Skin gesetzt'
    await store.save()

    const [, body] = visuApi.savePage.mock.calls.at(-1)
    expect(body.widgets).toEqual(frischeWidgets)
  })
})
