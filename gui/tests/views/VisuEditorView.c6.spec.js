import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

/**
 * Der Visu-Editor als Flaeche - der Nachtrag aus Teil C6 (Issue #173).
 *
 * Zwei Dinge kommen hier dazu, und beide sind Zusammenspiel, keine Einzelteile:
 *
 *  - **Verlauf (E12).** Waehrend wiederhergestellt wird, ist der Canvas WEG.
 *    Das ist keine Kosmetik: er haelt einen Entwurf, der von der Sekunde des
 *    Klicks an nicht mehr die Seite beschreibt. Danach kommt er frisch zurueck
 *    und liest den wiederhergestellten Stand vom Server - er wird also nicht
 *    „aktualisiert", sondern neu aufgebaut.
 *  - **Der dritte Schreiber (Micsi/openbridgeserver#187).** Formular und Canvas
 *    schreiben `page_config` heute unabhaengig voneinander. Nach einem
 *    Wiederherstellen haelt das FORMULAR noch den Stand von vorher; sein
 *    naechstes „Speichern" schriebe ihn zurueck und machte die Wiederherstellung
 *    rueckgaengig. Deshalb wird der Store nach einem Wiederherstellen neu
 *    geladen und die Seite neu ausgewaehlt.
 *  - **Import (E18).** Nach einem Import steht ein neuer Knoten im Baum; ohne
 *    ein Neuladen saehe der Autor ihn nicht.
 */

const TREE = [
  { id: 'home', parent_id: null, name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 40, access: 'public' },
  { id: 'solo', parent_id: null, name: 'M5 Solo', type: 'PAGE', kind: 'normal', order: 50, access: 'public' },
]

const CONFIG = () => ({
  grid_cols: 12,
  grid_row_height: 80,
  grid_cell_width: 80,
  background: null,
  widgets: [],
  includes: [],
  ignore_global_includes: false,
  popup: null,
  layout_mode: 'pixel',
  grid: 8,
  breakpoints: [480],
  skin: null,
})

let visuApi
let route

beforeEach(() => {
  vi.resetModules()
  setActivePinia(createPinia())
  route = reactive({ params: {} })
  visuApi = {
    tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getTree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
    getNode: vi.fn().mockResolvedValue({ data: { id: 'solo', name: 'M5 Solo', kind: 'normal' } }),
    getPage: vi.fn().mockResolvedValue({ data: CONFIG() }),
    savePage: vi.fn().mockResolvedValue({ status: 204 }),
    createNode: vi.fn().mockResolvedValue({ data: { id: 'neu' } }),
    updateNode: vi.fn().mockResolvedValue({ data: {} }),
    deleteNode: vi.fn().mockResolvedValue({ status: 204 }),
    moveNode: vi.fn().mockResolvedValue({ data: {} }),
    nodeUsers: vi.fn().mockResolvedValue({ data: [] }),
    usernames: vi.fn().mockResolvedValue({ data: [] }),
    pageVersions: vi.fn().mockResolvedValue({ data: [] }),
    pageVersion: vi.fn().mockResolvedValue({ data: CONFIG() }),
    exportNode: vi.fn().mockResolvedValue({ data: { obs_export: 'visu_subtree', version: 1, nodes: [] } }),
    importNodes: vi.fn().mockResolvedValue({ data: { id: 'neu' } }),
  }
  vi.doMock('@/api/visu', () => ({ visuApi, default: visuApi }))
  vi.doMock('vue-router', () => ({
    useRoute: () => route,
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
  vi.doUnmock('vue-router')
  vi.doUnmock('@/stores/auth')
})

async function mountEditor({ isAdmin = true, pageId } = {}) {
  if (pageId) route.params = { pageId }
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn: true, isAdmin, username: 'admin', loadMe: vi.fn() }),
  }))
  const { default: VisuEditorView } = await import('@/views/VisuEditorView.vue')
  // Der Vorschaurahmen ist hier nicht der Gegenstand - und er laedt in dieser
  // Montage einen echten `<iframe>` samt Netzversuch. Sein Vorfahrenpfad und
  // sein Verhalten stehen gepinnt in `components/visu/VisuEditorView.spec.js`
  // bzw. `VisuPreviewFrame.spec.js`; hier waere er nur Last.
  const wrapper = mount(VisuEditorView, { global: { stubs: { VisuPreviewFrame: true } } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

async function historyOf(wrapper) {
  const { default: VisuPageHistory } = await import('@/components/visu/VisuPageHistory.vue')
  return wrapper.findComponent(VisuPageHistory)
}

async function transferOf(wrapper) {
  const { default: VisuPageTransfer } = await import('@/components/visu/VisuPageTransfer.vue')
  return wrapper.findComponent(VisuPageTransfer)
}

describe('VisuEditorView - Verlauf und Datei (C6)', () => {
  it('haengt Verlauf und Export/Import neben den Editor', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })

    expect((await historyOf(wrapper)).exists()).toBe(true)
    expect((await transferOf(wrapper)).exists()).toBe(true)
  })

  it('bietet ohne Seite keinen Verlauf, aber weiterhin den Import', async () => {
    const wrapper = await mountEditor()

    expect((await historyOf(wrapper)).props('pageId')).toBeNull()
    expect((await transferOf(wrapper)).props('pageId')).toBeNull()
  })

  it('zeigt einem Nicht-Admin weder Verlauf noch Export/Import', async () => {
    const wrapper = await mountEditor({ isAdmin: false, pageId: 'solo' })

    expect((await historyOf(wrapper)).exists()).toBe(false)
    expect((await transferOf(wrapper)).exists()).toBe(false)
  })

  it('nimmt den Canvas vom Schirm, solange wiederhergestellt wird', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    expect(wrapper.find('.editor-canvas').exists()).toBe(true)

    ;(await historyOf(wrapper)).vm.$emit('restore-start')
    await flushPromises()

    expect(wrapper.find('.editor-canvas').exists()).toBe(false)
    expect(wrapper.find('[data-testid="visu-editor-restoring"]').exists()).toBe(true)
  })

  it('baut den Canvas danach neu auf und liest den wiederhergestellten Stand', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const vorher = visuApi.getPage.mock.calls.length
    const verlauf = await historyOf(wrapper)

    verlauf.vm.$emit('restore-start')
    await flushPromises()
    verlauf.vm.$emit('restored', { ok: true })
    await flushPromises()

    expect(wrapper.find('.editor-canvas').exists()).toBe(true)
    expect(visuApi.getPage.mock.calls.length).toBeGreaterThan(vorher)
  })

  /**
   * Der dritte Schreiber, entschaerft: das Eigenschaftsformular haelt nach dem
   * Wiederherstellen keinen Stand von vorher mehr.
   */
  it('laedt den Store neu, damit das Formular nicht den alten Entwurf zurueckschreibt', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const treeVorher = visuApi.tree.mock.calls.length
    const verlauf = await historyOf(wrapper)

    verlauf.vm.$emit('restore-start')
    verlauf.vm.$emit('restored', { ok: true })
    await flushPromises()

    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    expect(visuApi.tree.mock.calls.length).toBeGreaterThan(treeVorher)
    expect(useVisuEditorStore().selectedId).toBe('solo')
  })

  it('holt den Canvas auch nach einem GESCHEITERTEN Wiederherstellen zurueck', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const verlauf = await historyOf(wrapper)

    verlauf.vm.$emit('restore-start')
    await flushPromises()
    verlauf.vm.$emit('restored', { ok: false })
    await flushPromises()

    expect(wrapper.find('.editor-canvas').exists()).toBe(true)
  })

  /**
   * Die Naht zwischen Canvas und Verlauf: der Canvas quittiert erst, wenn der
   * Verlauf nachgezogen ist (E12). Hier wird nur geprueft, dass die Ansicht die
   * beiden ueberhaupt verbindet - die Reihenfolge selbst steht in
   * `VisuEditorCanvas.json.spec.js`.
   */
  it('gibt dem Canvas das Nachziehen des Verlaufs mit', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const { default: VisuEditorCanvas } = await import('@/components/visu/VisuEditorCanvas.vue')
    const canvas = wrapper.findComponent(VisuEditorCanvas)
    const vorher = visuApi.pageVersions.mock.calls.length

    await canvas.props('afterSave')()
    await flushPromises()

    expect(visuApi.pageVersions.mock.calls.length).toBe(vorher + 1)
  })

  /**
   * Der Canvas verschwindet waehrend eines Wiederherstellens - das
   * Eigenschaftsformular bleibt stehen und muss deshalb GESPERRT sein. Sonst
   * traegt es weiter den Entwurf von vorher und sein „Speichern" koennte sich
   * mit dem `PUT` des Wiederherstellens ueberholen.
   */
  it('sperrt das Eigenschaftsformular fuer die Dauer des Wiederherstellens', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const { default: VisuPageProperties } = await import('@/components/visu/VisuPageProperties.vue')
    expect(wrapper.findComponent(VisuPageProperties).props('restoring')).toBe(false)

    ;(await historyOf(wrapper)).vm.$emit('restore-start')
    await flushPromises()

    expect(wrapper.findComponent(VisuPageProperties).props('restoring')).toBe(true)
    expect(wrapper.find('[data-testid="visu-props-fields"]').attributes('disabled')).toBeDefined()
  })

  it('gibt das Formular wieder frei, sobald das Wiederherstellen vorbei ist', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const verlauf = await historyOf(wrapper)
    const { default: VisuPageProperties } = await import('@/components/visu/VisuPageProperties.vue')

    verlauf.vm.$emit('restore-start')
    await flushPromises()
    verlauf.vm.$emit('restored', { ok: true })
    await flushPromises()

    expect(wrapper.findComponent(VisuPageProperties).props('restoring')).toBe(false)
  })

  it('gibt es auch nach einem GESCHEITERTEN Wiederherstellen frei', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const verlauf = await historyOf(wrapper)
    const { default: VisuPageProperties } = await import('@/components/visu/VisuPageProperties.vue')

    verlauf.vm.$emit('restore-start')
    await flushPromises()
    verlauf.vm.$emit('restored', { ok: false })
    await flushPromises()

    expect(wrapper.findComponent(VisuPageProperties).props('restoring')).toBe(false)
  })

  /**
   * Das Restfenster: zwischen `restored` und dem frischen Entwurf liegen zwei
   * Runden zum Server (`load()` und `select()`). Gaebe das Formular schon vorher
   * frei, haelt es in dieser Zeit noch den Entwurf von VORHER - und ein Klick
   * auf „Speichern" schriebe ihn zurueck, also genau die Ruecknahme, gegen die
   * die Sperre da ist. Gemessen mit angehaltenem `GET /visu/tree`.
   */
  it('haelt das Formular gesperrt, bis der frische Stand da ist', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const { default: VisuPageProperties } = await import('@/components/visu/VisuPageProperties.vue')
    const verlauf = await historyOf(wrapper)
    let freigeben
    visuApi.tree.mockImplementationOnce(
      () => new Promise((resolve) => { freigeben = () => resolve({ data: TREE.map((n) => ({ ...n })) }) }),
    )

    verlauf.vm.$emit('restore-start')
    await flushPromises()
    verlauf.vm.$emit('restored', { ok: true })
    await flushPromises()

    expect(wrapper.findComponent(VisuPageProperties).props('restoring')).toBe(true)
    expect(wrapper.find('[data-testid="visu-props-fields"]').attributes('disabled')).toBeDefined()

    freigeben()
    await flushPromises()
    await flushPromises()

    expect(wrapper.findComponent(VisuPageProperties).props('restoring')).toBe(false)
  })

  it('laedt den Baum nach einem Import neu - sonst fehlte die neue Seite', async () => {
    const wrapper = await mountEditor({ pageId: 'solo' })
    const vorher = visuApi.tree.mock.calls.length

    ;(await transferOf(wrapper)).vm.$emit('imported')
    await flushPromises()

    expect(visuApi.tree.mock.calls.length).toBe(vorher + 1)
  })
})
