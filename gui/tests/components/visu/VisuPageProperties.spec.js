import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Die Seiteneigenschaften des V2-Editors (M5 C1, Issue #168).
 *
 * Diese Spec ist die Vitest-Haelfte der Messlatten-Zeilen **E9** (Seitentypen),
 * **E15** (Zugriff/PIN/Zielgruppe) und **E19** (Skin je Seite): jede Eigenschaft
 * einmal gesetzt und im Entwurf wiedergefunden, jede verbotene Kombination
 * einmal ausgeloest und als Meldung gesehen - und jedes Mal auch der erlaubte
 * Nachbarfall, damit keine Regel gruen ist, die IMMER meldet.
 *
 * Die Beschriftungen sind nicht frei gewaehlt: sie sind die ANFORDERUNG des
 * Playwright-Harness (`apps/visu/e2e/m5-editor-matrix.spec.ts`). Wer eine
 * aendert, faellt hier zuerst.
 */

const TREE = [
  { id: 'eg', parent_id: null, name: 'M5 Ordner', type: 'LOCATION', kind: 'normal', order: 0, access: null },
  { id: 'gamma', parent_id: null, name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal', order: 30, access: 'public' },
  { id: 'home', parent_id: null, name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
  { id: 'globalA', parent_id: null, name: 'M5 Global A', type: 'PAGE', kind: 'globalInclude', order: 10, access: 'public' },
  { id: 'popupA', parent_id: null, name: 'M5 Popup Positioned', type: 'PAGE', kind: 'popup', order: 60, access: 'public' },
  { id: 'guard', parent_id: null, name: 'M5 Guard User', type: 'PAGE', kind: 'normal', order: 70, access: 'user' },
]

const CONFIGS = {
  gamma: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
  home: { widgets: [], includes: ['gamma'], ignore_global_includes: false, popup: null },
  globalA: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
  guard: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
  popupA: {
    widgets: [],
    includes: [],
    ignore_global_includes: false,
    popup: { x: 140, y: 90, w: 260, h: 180, auto_close_ms: null, modal: false, animate: false, shadow: true, dim_backdrop: false },
  },
}

let visuApi
let pinia

beforeEach(() => {
  vi.resetModules()
  // Dieselbe Pinia fuer Test und Montage - `tests/setup.js` legt sonst eine
  // zweite an, und das Formular saehe einen anderen Entwurf als der Test.
  pinia = createPinia()
  setActivePinia(pinia)
  globalThis.localStorage.clear?.()
  visuApi = {
    tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getPage: vi.fn().mockImplementation((id) => Promise.resolve({ data: JSON.parse(JSON.stringify(CONFIGS[id])) })),
    savePage: vi.fn().mockResolvedValue({ status: 204 }),
    createNode: vi.fn().mockResolvedValue({ data: { id: 'neu' } }),
    updateNode: vi.fn().mockResolvedValue({ data: {} }),
    deleteNode: vi.fn().mockResolvedValue({ status: 204 }),
    moveNode: vi.fn().mockResolvedValue({ data: {} }),
    nodeUsers: vi.fn().mockImplementation((id) => Promise.resolve({ data: id === 'guard' ? ['e2e_resident'] : [] })),
    usernames: vi.fn().mockResolvedValue({
      data: [{ username: 'admin' }, { username: 'e2e_resident' }, { username: 'e2e_operator' }],
    }),
  }
  vi.doMock('@/api/visu', () => ({ visuApi }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
})

async function mountProperties(selectId) {
  const { useVisuEditorStore } = await import('@/stores/visuEditor')
  const store = useVisuEditorStore()
  await store.load()
  if (selectId !== undefined) await store.select(selectId)
  const { default: VisuPageProperties } = await import('@/components/visu/VisuPageProperties.vue')
  const wrapper = mount(VisuPageProperties, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, store }
}

/** Das Bedienelement zu einer Beschriftung - genau so, wie Playwright es sucht. */
function byLabel(wrapper, text) {
  const label = wrapper.findAll('label').find((l) => l.text().trim() === text)
  if (!label) throw new Error(`Keine Beschriftung „${text}" - der Harness sucht danach.`)
  const target = label.attributes('for')
  const control = wrapper.find(`#${target}`)
  if (!control.exists()) throw new Error(`Beschriftung „${text}" zeigt auf #${target}, das es nicht gibt.`)
  return control
}

const problemCodes = (wrapper) =>
  wrapper.findAll('[data-problem]').map((el) => el.attributes('data-problem'))

describe('VisuPageProperties - ohne Auswahl', () => {
  it('zeigt einen Hinweis statt eines leeren Formulars', async () => {
    const { wrapper } = await mountProperties()
    expect(wrapper.find('[data-testid="visu-props-empty"]').exists()).toBe(true)
    expect(wrapper.find('form').exists()).toBe(false)
  })
})

describe('VisuPageProperties - Seitentyp (E9, R1)', () => {
  it('bietet genau die vier Typen der Regeltabelle, in Edomis Reihenfolge', async () => {
    const { wrapper } = await mountProperties('popupA')
    const options = byLabel(wrapper, 'Seitentyp').findAll('option')
    expect(options.map((o) => o.attributes('value'))).toEqual([
      'normal',
      'include',
      'globalInclude',
      'popup',
    ])
    expect(options.map((o) => o.text())).toEqual([
      'Normale Seite',
      'Inkludeseite',
      'Globale Inkludeseite',
      'Popup',
    ])
  })

  it('steht auf dem Typ der geladenen Seite', async () => {
    const { wrapper } = await mountProperties('popupA')
    expect(byLabel(wrapper, 'Seitentyp').element.value).toBe('popup')
  })

  it('nennt eine inkludierte Seite „Inkludeseite"', async () => {
    const { wrapper } = await mountProperties('gamma')
    expect(byLabel(wrapper, 'Seitentyp').element.value).toBe('include')
  })

  it('zeigt die Popup-Eigenschaften nur beim Typ „Popup"', async () => {
    const { wrapper } = await mountProperties('popupA')
    expect(wrapper.find('[data-testid="visu-props-popup"]').exists()).toBe(true)
    await byLabel(wrapper, 'Seitentyp').setValue('globalInclude')
    await flushPromises()
    expect(wrapper.find('[data-testid="visu-props-popup"]').exists()).toBe(false)
  })

  it('nimmt die Popup-Eigenschaften aus dem DOM, nicht nur aus dem Blick', async () => {
    const { wrapper } = await mountProperties('popupA')
    expect(wrapper.findAll('label').some((l) => l.text().trim() === 'Automatisch schließen (ms)')).toBe(true)
    await byLabel(wrapper, 'Seitentyp').setValue('normal')
    await flushPromises()
    expect(wrapper.findAll('label').some((l) => l.text().trim() === 'Automatisch schließen (ms)')).toBe(false)
  })
})

describe('VisuPageProperties - die Popup-Parameter (R2-R6)', () => {
  it('zeigt jeden gespeicherten Wert', async () => {
    const { wrapper } = await mountProperties('popupA')
    expect(byLabel(wrapper, 'X').element.value).toBe('140')
    expect(byLabel(wrapper, 'Y').element.value).toBe('90')
    expect(byLabel(wrapper, 'Breite').element.value).toBe('260')
    expect(byLabel(wrapper, 'Höhe').element.value).toBe('180')
    expect(byLabel(wrapper, 'Schlagschatten').element.checked).toBe(true)
    expect(byLabel(wrapper, 'Exklusiv öffnen').element.checked).toBe(false)
    expect(byLabel(wrapper, 'Animation').element.checked).toBe(false)
    expect(byLabel(wrapper, 'Hintergrund abdunkeln').element.checked).toBe(false)
  })

  it('schreibt jede Aenderung in den Entwurf', async () => {
    const { wrapper, store } = await mountProperties('popupA')
    await byLabel(wrapper, 'X').setValue('12')
    await byLabel(wrapper, 'Y').setValue('34')
    await byLabel(wrapper, 'Breite').setValue('56')
    await byLabel(wrapper, 'Höhe').setValue('78')
    await byLabel(wrapper, 'Automatisch schließen (ms)').setValue('2000')
    await byLabel(wrapper, 'Exklusiv öffnen').setValue(true)
    await byLabel(wrapper, 'Animation').setValue(true)
    await byLabel(wrapper, 'Hintergrund abdunkeln').setValue(true)
    expect(store.draft.popup).toMatchObject({
      x: 12,
      y: 34,
      w: 56,
      h: 78,
      auto_close_ms: 2000,
      modal: true,
      animate: true,
      dim_backdrop: true,
    })
  })

  it('macht aus einem geleerten Feld `null`, nicht 0 - fehlt eine Koordinate, zentriert der Host (R2)', async () => {
    const { wrapper, store } = await mountProperties('popupA')
    await byLabel(wrapper, 'Y').setValue('')
    expect(store.draft.popup.y).toBeNull()
  })
})

describe('VisuPageProperties - Includes und globale Inkludeseiten (R13, R14)', () => {
  it('zeigt jede gespeicherte Include-Zeile', async () => {
    const { wrapper } = await mountProperties('home')
    const rows = wrapper.findAll('[data-include-row]')
    expect(rows).toHaveLength(1)
    expect(rows[0].find('select').element.value).toBe('gamma')
  })

  it('fuegt auf Knopfdruck ein erlaubtes Ziel hinzu, kein leeres', async () => {
    const { wrapper, store } = await mountProperties('home')
    await wrapper.find('[data-testid="visu-props-add-include"]').trigger('click')
    await flushPromises()
    expect(store.draft.includes).toHaveLength(2)
    expect(store.draft.includes[1]).toBeTruthy()
    expect(store.draft.includes[1]).not.toBe('home')
  })

  it('bietet als Ziel weder die Seite selbst noch ein Popup an (R14)', async () => {
    const { wrapper } = await mountProperties('home')
    const values = wrapper
      .find('[data-include-row] select')
      .findAll('option')
      .map((o) => o.attributes('value'))
    expect(values).toContain('gamma')
    expect(values).toContain('globalA')
    expect(values).not.toContain('home')
    expect(values).not.toContain('popupA')
    expect(values).not.toContain('eg')
  })

  it('nimmt eine Include-Zeile wieder weg', async () => {
    const { wrapper, store } = await mountProperties('home')
    await wrapper.find('[data-include-row] [data-action="remove-include"]').trigger('click')
    expect(store.draft.includes).toEqual([])
  })

  it('schaltet „Globale Inkludeseiten ignorieren" (R13)', async () => {
    const { wrapper, store } = await mountProperties('home')
    expect(byLabel(wrapper, 'Globale Inkludeseiten ignorieren').element.checked).toBe(false)
    await byLabel(wrapper, 'Globale Inkludeseiten ignorieren').setValue(true)
    expect(store.draft.ignoreGlobalIncludes).toBe(true)
  })
})

describe('VisuPageProperties - die verbotenen Kombinationen VOR dem Speichern (E9)', () => {
  it('meldet die globale Inkludeseite, die inkludiert - im Wortlaut des Backends', async () => {
    const { wrapper } = await mountProperties('popupA')
    await byLabel(wrapper, 'Seitentyp').setValue('globalInclude')
    await wrapper.find('[data-testid="visu-props-add-include"]').trigger('click')
    await flushPromises()
    expect(problemCodes(wrapper)).toContain('globalIncludeCannotInclude')
    expect(wrapper.find('[data-problem="globalIncludeCannotInclude"]').text()).toBe(
      'Eine globale Inkludeseite kann selbst keine Seiten inkludieren',
    )
  })

  it('sperrt in genau diesem Zustand das Speichern', async () => {
    const { wrapper } = await mountProperties('popupA')
    await byLabel(wrapper, 'Seitentyp').setValue('globalInclude')
    await wrapper.find('[data-testid="visu-props-add-include"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="visu-props-save"]').attributes('disabled')).toBeDefined()
  })

  it('gibt das Speichern frei, sobald die Include-Zeile weg ist', async () => {
    const { wrapper } = await mountProperties('popupA')
    await byLabel(wrapper, 'Seitentyp').setValue('globalInclude')
    await wrapper.find('[data-testid="visu-props-add-include"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-include-row] [data-action="remove-include"]').trigger('click')
    await flushPromises()
    expect(problemCodes(wrapper)).toEqual([])
    expect(wrapper.find('[data-testid="visu-props-save"]').attributes('disabled')).toBeUndefined()
  })

  it('meldet die inkludierte Seite, die Popup werden soll', async () => {
    const { wrapper } = await mountProperties('gamma')
    await byLabel(wrapper, 'Seitentyp').setValue('popup')
    await flushPromises()
    expect(problemCodes(wrapper)).toContain('includedPageCannotBecomePopup')
  })

  it('schickt bei einem Verstoss nichts an das Backend', async () => {
    const { wrapper } = await mountProperties('gamma')
    await byLabel(wrapper, 'Seitentyp').setValue('popup')
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(visuApi.updateNode).not.toHaveBeenCalled()
    expect(visuApi.savePage).not.toHaveBeenCalled()
  })
})

describe('VisuPageProperties - Zugriff, PIN und Zielgruppe (E15)', () => {
  it('bietet genau die vier Stufen des OBS-Modells', async () => {
    const { wrapper } = await mountProperties('guard')
    const options = byLabel(wrapper, 'Zugriff').findAll('option')
    expect(options.map((o) => o.attributes('value'))).toEqual([
      'public',
      'readonly',
      'protected',
      'user',
    ])
    for (const [index, token] of ['public', 'readonly', 'protected', 'user'].entries()) {
      expect(options[index].text().toLowerCase()).toContain(token)
    }
  })

  it('steht auf der Stufe der geladenen Seite', async () => {
    const { wrapper } = await mountProperties('guard')
    expect(byLabel(wrapper, 'Zugriff').element.value).toBe('user')
  })

  it('zeigt in der Zielgruppe genau die zugewiesenen Nutzer', async () => {
    const { wrapper } = await mountProperties('guard')
    const audience = byLabel(wrapper, 'Zielgruppe')
    expect(audience.text()).toContain('e2e_resident')
    expect(audience.text()).not.toContain('e2e_operator')
  })

  it('sperrt die Zielgruppe, sobald der Zugriff nicht mehr „user" ist', async () => {
    const { wrapper } = await mountProperties('guard')
    expect(byLabel(wrapper, 'Zielgruppe').attributes('disabled')).toBeUndefined()
    await byLabel(wrapper, 'Zugriff').setValue('public')
    await flushPromises()
    expect(byLabel(wrapper, 'Zielgruppe').attributes('disabled')).toBeDefined()
  })

  it('raeumt die Zielgruppe mit weg, statt einen 422 zu produzieren', async () => {
    const { wrapper, store } = await mountProperties('guard')
    await byLabel(wrapper, 'Zugriff').setValue('public')
    await flushPromises()
    expect(store.draft.usernames).toEqual([])
    expect(problemCodes(wrapper)).not.toContain('audienceRequiresUserAccess')
  })

  it('zeigt das PIN-Feld nur bei „protected"', async () => {
    const { wrapper } = await mountProperties('guard')
    expect(wrapper.findAll('label').some((l) => l.text().trim() === 'PIN')).toBe(false)
    await byLabel(wrapper, 'Zugriff').setValue('protected')
    await flushPromises()
    expect(byLabel(wrapper, 'PIN').exists()).toBe(true)
  })

  /**
   * Der BLEIBENDE Fundort (M5 C6, Issue #173). Beim Import meldet der Editor
   * einmal, dass eine geschuetzte Seite ohne PIN angekommen ist - und beim
   * ersten Klick auf eine andere Seite ist die Meldung weg. Der Zustand bleibt:
   * die Seite ist fuer jeden Besucher zu, bis hier eine PIN steht. Das leere
   * PIN-Feld allein sagt gar nichts, denn der Hash geht nie an den Browser.
   */
  it('vermerkt dauerhaft, dass diese geschuetzte Seite noch ohne PIN ist', async () => {
    visuApi.tree.mockResolvedValue({
      data: TREE.map((n) => (n.id === 'gamma' ? { ...n, access: 'protected', has_pin: false } : { ...n })),
    })
    const { wrapper } = await mountProperties('gamma')

    expect(wrapper.find('[data-testid="visu-props-no-pin"]').exists()).toBe(true)
  })

  it('schweigt, sobald eine PIN gesetzt ist - sonst stuende der Vermerk immer da', async () => {
    visuApi.tree.mockResolvedValue({
      data: TREE.map((n) => (n.id === 'gamma' ? { ...n, access: 'protected', has_pin: true } : { ...n })),
    })
    const { wrapper } = await mountProperties('gamma')

    expect(wrapper.find('[data-testid="visu-props-no-pin"]').exists()).toBe(false)
  })

  it('schweigt, wo die Antwort den Zustand gar nicht ausweist', async () => {
    visuApi.tree.mockResolvedValue({
      data: TREE.map((n) => (n.id === 'gamma' ? { ...n, access: 'protected' } : { ...n })),
    })
    const { wrapper } = await mountProperties('gamma')

    expect(wrapper.find('[data-testid="visu-props-no-pin"]').exists()).toBe(false)
  })

  it('nennt es nicht bei einer Seite, die gar keinen PIN-Schutz traegt', async () => {
    visuApi.tree.mockResolvedValue({
      data: TREE.map((n) => (n.id === 'gamma' ? { ...n, access: 'public', has_pin: false } : { ...n })),
    })
    const { wrapper } = await mountProperties('gamma')

    expect(wrapper.find('[data-testid="visu-props-no-pin"]').exists()).toBe(false)
  })

  it('nimmt einen Nutzer in die Zielgruppe auf', async () => {
    const { wrapper, store } = await mountProperties('guard')
    await byLabel(wrapper, 'Nutzer hinzufügen').setValue('e2e_operator')
    await flushPromises()
    expect(store.draft.usernames).toEqual(['e2e_resident', 'e2e_operator'])
  })

  it('nimmt einen Nutzer wieder heraus', async () => {
    const { wrapper, store } = await mountProperties('guard')
    await wrapper.find('[data-action="remove-user"]').trigger('click')
    await flushPromises()
    expect(store.draft.usernames).toEqual([])
  })

  it('erbt den Zugriff vom Elternknoten, wenn der Knoten keinen eigenen traegt', async () => {
    const { wrapper, store } = await mountProperties('eg')
    expect(byLabel(wrapper, 'Vom Elternknoten erben').element.checked).toBe(true)
    expect(byLabel(wrapper, 'Zugriff').attributes('disabled')).toBeDefined()
    await byLabel(wrapper, 'Vom Elternknoten erben').setValue(false)
    await flushPromises()
    expect(store.draft.access).toBe('public')
    expect(byLabel(wrapper, 'Zugriff').attributes('disabled')).toBeUndefined()
  })

  it('gibt den Zugriff auf Wunsch wieder an den Elternknoten zurueck', async () => {
    const { wrapper, store } = await mountProperties('guard')
    await byLabel(wrapper, 'Vom Elternknoten erben').setValue(true)
    await flushPromises()
    expect(store.draft.access).toBeNull()
  })
})

describe('VisuPageProperties - Skin je Seite (E19)', () => {
  it('bietet jeden Skin der Registry an', async () => {
    const { wrapper } = await mountProperties('home')
    expect(
      byLabel(wrapper, 'Skin')
        .findAll('option')
        .map((o) => o.attributes('value')),
    ).toEqual(['ionic', 'terminal', 'edomi'])
  })

  it('setzt die Wahl im Store, damit die Vorschau sie sofort bekommt', async () => {
    const { wrapper, store } = await mountProperties('home')
    await byLabel(wrapper, 'Skin').setValue('terminal')
    await flushPromises()
    expect(store.skin).toBe('terminal')
    expect(store.previewDraft.skin).toBe('terminal')
  })

  /**
   * Der Hinweis unter dem Feld muss VOR und NACH dem Merge von Teil C2 stimmen.
   *
   * Solange `PageConfig` kein Skin-Feld fuehrt, lebt die Wahl im Browser des
   * Autors - und genau das sagt der Satz. Sobald das Feld da ist, gehoert die
   * Wahl der Seite, und derselbe Satz waere eine Falschaussage. Er haengt
   * deshalb an derselben Erkennung wie die Naht selbst
   * (`store.skinSupported`) und nicht an einem Zettel, den nach dem Merge
   * jemand lesen muesste.
   */
  it('sagt heute, dass die Wahl nur im Browser dieses Rechners lebt', async () => {
    const { wrapper, store } = await mountProperties('home')
    expect(store.skinSupported).toBe(false)
    const hint = wrapper.find('[data-testid="visu-props-skin-hint"]')
    expect(hint.attributes('data-skin-storage')).toBe('browser')
    expect(hint.text()).toContain('Browser dieses Rechners')
  })

  it('zieht den Hinweis von selbst nach, sobald das Backend das Feld fuehrt', async () => {
    visuApi.getPage.mockImplementation((id) =>
      Promise.resolve({ data: { ...JSON.parse(JSON.stringify(CONFIGS[id])), skin: null } }),
    )
    const { wrapper, store } = await mountProperties('home')
    expect(store.skinSupported).toBe(true)
    const hint = wrapper.find('[data-testid="visu-props-skin-hint"]')
    expect(hint.attributes('data-skin-storage')).toBe('page')
    expect(hint.text()).toContain('gehört der Seite')
    expect(hint.text()).not.toContain('Browser dieses Rechners')
  })
})

describe('VisuPageProperties - speichern', () => {
  it('schreibt den geaenderten Namen und meldet danach „Gespeichert"', async () => {
    const { wrapper } = await mountProperties('home')
    await byLabel(wrapper, 'Name').setValue('M5 Home Neu')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(visuApi.updateNode).toHaveBeenCalledWith('home', expect.objectContaining({ name: 'M5 Home Neu' }))
    expect(wrapper.find('[data-testid="visu-props-saved"]').text()).toBe('Gespeichert')
  })

  it('zeigt vor dem ersten Speichern keine Erfolgsmeldung', async () => {
    const { wrapper } = await mountProperties('home')
    expect(wrapper.find('[data-testid="visu-props-saved"]').exists()).toBe(false)
  })

  it('zeigt die Ablehnung des Backends im Klartext', async () => {
    const { wrapper } = await mountProperties('home')
    visuApi.savePage.mockRejectedValue({ response: { status: 400, data: { detail: 'Include-Ziel existiert nicht' } } })
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-testid="visu-props-error"]').text()).toContain(
      'Include-Ziel existiert nicht',
    )
  })

  it('legt eine neue Seite mit allen Popup-Eigenschaften an (R16-Anteil)', async () => {
    const { wrapper, store } = await mountProperties('home')
    store.newPage(null)
    await flushPromises()
    await byLabel(wrapper, 'Name').setValue('RT Popup Round-Trip')
    await byLabel(wrapper, 'Seitentyp').setValue('popup')
    await flushPromises()
    await byLabel(wrapper, 'X').setValue('140')
    await byLabel(wrapper, 'Y').setValue('90')
    await byLabel(wrapper, 'Breite').setValue('260')
    await byLabel(wrapper, 'Höhe').setValue('180')
    await byLabel(wrapper, 'Automatisch schließen (ms)').setValue('2000')
    await byLabel(wrapper, 'Exklusiv öffnen').setValue(true)
    await byLabel(wrapper, 'Schlagschatten').setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(visuApi.createNode).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RT Popup Round-Trip', kind: 'popup', type: 'PAGE' }),
    )
    expect(visuApi.savePage).toHaveBeenCalledWith(
      'neu',
      expect.objectContaining({
        popup: {
          x: 140,
          y: 90,
          w: 260,
          h: 180,
          auto_close_ms: 2000,
          modal: true,
          animate: false,
          shadow: true,
          dim_backdrop: false,
        },
      }),
    )
  })
})

describe('VisuPageProperties - die Ablehnungen, die der Editor NICHT vorwegnehmen kann', () => {
  /*
   * Zwei Ablehnungen treffen einen echten Autor beim Setzen von E15, und beide
   * kann der Editor nicht sicher vorwegnehmen: die Nutzerliste kann fehlen
   * (422 `visu_target_audience_invalid_users`), und die Datenpunkt-Rechte der
   * Zielgruppe kennt er gar nicht (403 `visu_target_audience_datapoints_denied`
   * - dafuer gibt es keinen Endpunkt). Dann soll der Autor wenigstens einen Satz
   * lesen, nicht einen Code.
   */
  it('schreibt den 422 zur Zielgruppe als Satz aus, samt der beanstandeten Namen', async () => {
    const { wrapper } = await mountProperties('guard')
    visuApi.updateNode.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: { code: 'visu_target_audience_invalid_users', usernames: ['weg', 'admin'] } },
      },
    })
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const text = wrapper.find('[data-testid="visu-props-error"]').text()
    expect(text).toContain('kennt diese Nutzer nicht')
    expect(text).toContain('weg, admin')
    expect(text).not.toContain('visu_target_audience_invalid_users')
  })

  it('schreibt den 403 zu den Datenpunkten als Satz aus, samt Nutzer und Datenpunkten', async () => {
    const { wrapper } = await mountProperties('guard')
    visuApi.updateNode.mockRejectedValue({
      response: {
        status: 403,
        data: {
          detail: {
            code: 'visu_target_audience_datapoints_denied',
            username: 'e2e_resident',
            datapoint_ids: ['dp-1', 'dp-2'],
          },
        },
      },
    })
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const text = wrapper.find('[data-testid="visu-props-error"]').text()
    expect(text).toContain('darf nicht alle Datenpunkte dieser Seite lesen')
    expect(text).toContain('e2e_resident')
    expect(text).toContain('dp-1, dp-2')
  })

  it('reicht eine unbekannte Ablehnung unveraendert durch, statt sie zu erfinden', async () => {
    const { wrapper } = await mountProperties('guard')
    visuApi.updateNode.mockRejectedValue({
      response: { status: 409, data: { detail: { code: 'visu_irgendwas_neues' } } },
    })
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-testid="visu-props-error"]').text()).toContain('visu_irgendwas_neues')
  })

  it('sagt bei Zugriff „user" vorher, dass die Datenpunkte der Zielgruppe geprueft werden', async () => {
    visuApi.getPage.mockImplementation((id) =>
      Promise.resolve({
        data:
          id === 'guard'
            ? { widgets: [{ id: 'w1', datapoint_id: 'dp-1' }], includes: [], ignore_global_includes: false, popup: null }
            : JSON.parse(JSON.stringify(CONFIGS[id])),
      }),
    )
    const { wrapper } = await mountProperties('guard')
    expect(wrapper.find('[data-testid="visu-props-audience-datapoint-hint"]').exists()).toBe(true)
  })

  it('schweigt, wo die Seite gar keine Datenpunkte bindet', async () => {
    const { wrapper } = await mountProperties('guard')
    expect(wrapper.find('[data-testid="visu-props-audience-datapoint-hint"]').exists()).toBe(false)
  })
})

describe('VisuPageProperties - „Inkludeseite" ist eine Rolle, keine Einstellung (E9)', () => {
  it('meldet die Wahl „Inkludeseite" an einer Seite, die niemand inkludiert', async () => {
    const { wrapper, store } = await mountProperties('home')
    await byLabel(wrapper, 'Seitentyp').setValue('include')
    await flushPromises()
    expect(wrapper.find('[data-problem="includeKindNeedsReference"]').text()).toContain(
      'sobald eine andere Seite sie inkludiert',
    )
    expect(store.canSave).toBe(false)
    expect(wrapper.find('[data-testid="visu-props-save"]').attributes('disabled')).toBeDefined()
  })

  it('laesst dieselbe Wahl an einer inkludierten Seite zu', async () => {
    const { wrapper, store } = await mountProperties('gamma')
    expect(byLabel(wrapper, 'Seitentyp').element.value).toBe('include')
    expect(wrapper.find('[data-problem="includeKindNeedsReference"]').exists()).toBe(false)
    expect(store.canSave).toBe(true)
  })

  it('meldet die Wahl „normal" an einer inkludierten Seite', async () => {
    const { wrapper, store } = await mountProperties('gamma')
    await byLabel(wrapper, 'Seitentyp').setValue('normal')
    await flushPromises()
    expect(wrapper.find('[data-problem="normalKindWhileIncluded"]').exists()).toBe(true)
    expect(store.canSave).toBe(false)
  })
})

/**
 * Das Restrisiko aus der Kritik zu Teil C6 (Issue #173), geschlossen.
 *
 * Waehrend eines Wiederherstellens nimmt die Ansicht den CANVAS vom Schirm - er
 * haelt einen Entwurf, der die Seite nicht mehr beschreibt. Das
 * EIGENSCHAFTSFORMULAR blieb bis dahin bedienbar, und es haelt genau denselben
 * veralteten Entwurf: `includes`, Popup-Deskriptor, Zugriff. Ein Klick auf sein
 * „Speichern" im Sekundenbruchteil zwischen `restore-start` und `restored`
 * konnte sich mit dem `PUT` des Wiederherstellens ueberholen und den alten Stand
 * zurueckschreiben - der dritte Schreiber, durch die Hintertuer.
 *
 * Gesperrt wird mit einem `<fieldset disabled>`, nicht mit einem `disabled` je
 * Feld: das ist die HTML-Antwort auf „diese Gruppe ist gerade nicht bedienbar",
 * sie gilt fuer JEDES Bedienelement darin (auch fuer kuenftige) und sie reicht
 * bis in die Tastaturbedienung. Der Wachposten in `onSubmit` steht trotzdem
 * daneben: ein Formular laesst sich auch ohne seinen Knopf abschicken.
 */
describe('VisuPageProperties - waehrend eines Wiederherstellens gesperrt', () => {
  async function mountRestoring(restoring) {
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    const store = useVisuEditorStore()
    await store.load()
    await store.select('gamma')
    const { default: VisuPageProperties } = await import('@/components/visu/VisuPageProperties.vue')
    const wrapper = mount(VisuPageProperties, { props: { restoring }, global: { plugins: [pinia] } })
    await flushPromises()
    return { wrapper, store }
  }

  it('sperrt die ganze Feldgruppe, solange wiederhergestellt wird', async () => {
    const { wrapper } = await mountRestoring(true)

    expect(wrapper.find('[data-testid="visu-props-fields"]').attributes('disabled')).toBeDefined()
  })

  it('laesst sie frei, wenn nicht wiederhergestellt wird', async () => {
    const { wrapper } = await mountRestoring(false)

    expect(wrapper.find('[data-testid="visu-props-fields"]').attributes('disabled')).toBeUndefined()
  })

  it('ist ohne die Angabe frei - kein Aufrufer wird zur Sperre gezwungen', async () => {
    const { wrapper } = await mountProperties('gamma')

    expect(wrapper.find('[data-testid="visu-props-fields"]').attributes('disabled')).toBeUndefined()
  })

  it('schreibt nicht, wenn das Formular waehrenddessen abgeschickt wird', async () => {
    const { wrapper, store } = await mountRestoring(true)
    const save = vi.spyOn(store, 'save')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
  })

  it('schreibt danach wieder - die Sperre gilt nur fuer die Dauer', async () => {
    const { wrapper, store } = await mountRestoring(false)
    const save = vi.spyOn(store, 'save')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(save).toHaveBeenCalled()
  })
})
