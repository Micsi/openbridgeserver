import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * Export und Import einer Seite als Datei (M5 C6, Issue #173, Messlatte E18).
 *
 * Die Playwright-Haelfte ist E18 in `apps/visu/e2e/m5-editor-matrix.spec.ts`:
 * exportieren, dieselbe Datei wieder einlesen, und der Baum traegt den Namen
 * danach zweimal. Hier steht dieselbe Behauptung als Einzelfrage, dazu die
 * Ablehnungen, die ein Browser-Szenario nicht herstellt.
 *
 * Der Export geht ueber `GET /visu/nodes/{id}/export` und der Import ueber
 * `POST /visu/nodes/import` - beide gibt es seit V1. C6 baut hier KEINEN
 * eigenen Endpunkt; was die beiden zusagen und was nicht (die rohe Lesart des
 * Exports, §2.1), steht in `tests/unit/test_visu_page_versions.py`.
 */

const exportNode = vi.fn()
const importNodes = vi.fn()

vi.mock('@/api/visu', () => ({
  visuApi: {
    exportNode: (...args) => exportNode(...args),
    importNodes: (...args) => importNodes(...args),
  },
}))

const dokument = {
  obs_export: 'visu_subtree',
  version: 1,
  exported_at: '2026-09-06T10:00:00+00:00',
  nodes: [{ id: 'p1', parent_id: null, name: 'M5 Include Gamma', type: 'PAGE', page_config: { widgets: [] } }],
}

let angeklickteAnker

async function mountTransfer(props = {}) {
  const { default: VisuPageTransfer } = await import('@/components/visu/VisuPageTransfer.vue')
  const wrapper = mount(VisuPageTransfer, { props: { pageId: 'p1', ...props }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const byButton = (wrapper, text) =>
  wrapper.findAll('button').find((b) => b.text().trim() === text) ?? null

/** Eine Datei in das Dateifeld legen, so wie ein Dateidialog es tut. */
async function chooseFile(wrapper, text, name = 'seite_visu.json') {
  const input = wrapper.find('input[type="file"]')
  const datei = { name, text: async () => text }
  Object.defineProperty(input.element, 'files', { value: [datei], configurable: true })
  await input.trigger('change')
  await flushPromises()
  return input
}

beforeEach(() => {
  vi.clearAllMocks()
  angeklickteAnker = []
  exportNode.mockResolvedValue({ data: dokument })
  importNodes.mockResolvedValue({ data: { id: 'neu' } })
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:test/1')
  globalThis.URL.revokeObjectURL = vi.fn()
  const echtesCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const el = echtesCreate(tag)
    if (tag === 'a') {
      angeklickteAnker.push(el)
      el.click = () => {}
    }
    return el
  })
})

afterEach(() => {
  document.createElement.mockRestore()
  delete globalThis.URL.createObjectURL
  delete globalThis.URL.revokeObjectURL
})

describe('VisuPageTransfer (E18)', () => {
  it('exportiert die ausgewaehlte Seite als Datei, benannt nach der Seite', async () => {
    const wrapper = await mountTransfer()

    await byButton(wrapper, 'Exportieren').trigger('click')
    await flushPromises()

    expect(exportNode).toHaveBeenCalledWith('p1')
    expect(angeklickteAnker).toHaveLength(1)
    expect(angeklickteAnker[0].getAttribute('download')).toBe('M5_Include_Gamma_visu.json')
  })

  it('bietet ohne ausgewaehlte Seite keinen Export an - aber sehr wohl einen Import', async () => {
    const wrapper = await mountTransfer({ pageId: null })

    expect(byButton(wrapper, 'Exportieren')).toBeNull()
    expect(byButton(wrapper, 'Importieren')).not.toBeNull()
  })

  it('meldet einen gescheiterten Export, statt eine leere Datei auszugeben', async () => {
    exportNode.mockRejectedValue(new Error('403'))
    const wrapper = await mountTransfer()

    await byButton(wrapper, 'Exportieren').trigger('click')
    await flushPromises()

    expect(angeklickteAnker).toHaveLength(0)
    expect(wrapper.find('[data-testid="editor-transfer-error"]').exists()).toBe(true)
  })

  it('zeigt das Dateifeld erst, wenn der Import geoeffnet ist', async () => {
    const wrapper = await mountTransfer()
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)

    await byButton(wrapper, 'Importieren').trigger('click')

    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
  })

  it('beschriftet das Dateifeld ueber `for`/`id`, so wie der Harness es sucht', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')

    const label = wrapper.findAll('label').find((l) => l.text().trim() === 'Datei')
    expect(label).toBeDefined()
    expect(wrapper.find(`#${label.attributes('for')}`).attributes('type')).toBe('file')
  })

  it('liest die Datei ein und legt sie als neuen Teilbaum an', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(dokument))

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(importNodes).toHaveBeenCalledWith({
      ...dokument,
      nodes: dokument.nodes,
      target_parent_id: null,
    })
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })

  /**
   * Der Name bleibt, solange er frei ist: ein Import in eine frische Instanz ist
   * keine Kopie, und „(Kopie 1)" waere dort schlicht falsch.
   */
  it('laesst den Namen der eingelesenen Seite in Ruhe, wenn er frei ist', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(dokument))

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(importNodes.mock.calls[0][0].nodes[0].name).toBe('M5 Include Gamma')
  })

  /**
   * Steht der Name aber schon im Baum, bekommt die eingelesene Wurzel einen
   * freien - sonst haette der Autor zwei Zeilen, die er nicht unterscheiden
   * kann (und ein namensbasierter Zugriff, etwa der E2E-Seed, griffe daneben).
   */
  it('gibt der eingelesenen Wurzel einen freien Namen, wenn ihrer vergeben ist', async () => {
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    useVisuEditorStore().nodes = [{ id: 'p1', name: 'M5 Include Gamma' }]
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(dokument))

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(importNodes.mock.calls[0][0].nodes[0].name).toBe('M5 Include Gamma (Kopie 1)')
    // Die Kennung des Exports und alles andere reisen unveraendert mit.
    expect(importNodes.mock.calls[0][0].obs_export).toBe('visu_subtree')
  })

  it('benennt nur die Wurzel um, nicht die Seiten darunter', async () => {
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    useVisuEditorStore().nodes = [
      { id: 'p1', name: 'M5 Include Gamma' },
      { id: 'p2', name: 'M5 Kind' },
    ]
    const mitKind = {
      ...dokument,
      nodes: [...dokument.nodes, { id: 'k1', parent_id: 'p1', name: 'M5 Kind', type: 'PAGE', page_config: { widgets: [] } }],
    }
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(mitKind))

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(importNodes.mock.calls[0][0].nodes.map((n) => n.name)).toEqual([
      'M5 Include Gamma (Kopie 1)',
      'M5 Kind',
    ])
  })

  it('schliesst den Import-Kasten nach einem gelungenen Import', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(dokument))
    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  })

  /**
   * Die Meldung nennt den Namen der importierten Seite bewusst NICHT. Sie
   * stuende sonst neben dem Baum, in dem er nach dem Import zweimal auftaucht,
   * und jede Zaehlung ueber den Namen (E18) zaehlte die Meldung mit.
   */
  it('meldet den Erfolg, ohne den Seitennamen zu wiederholen', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(dokument))
    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="editor-transfer-done"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('M5 Include Gamma')
  })

  it('startet ohne gewaehlte Datei gar nichts', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(importNodes).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="editor-transfer-error"]').exists()).toBe(true)
  })

  it('lehnt eine Datei ab, die kein Visu-Export ist - ohne sie an das Backend zu schicken', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, '{"foo": 1}')

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(importNodes).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="editor-transfer-error"]').exists()).toBe(true)
    expect(wrapper.emitted('imported')).toBeUndefined()
  })

  it('lehnt kaputtes JSON ab', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, '{ kaputt')

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(importNodes).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="editor-transfer-error"]').exists()).toBe(true)
  })

  it('meldet eine Ablehnung des Backends, statt einen Import zu behaupten', async () => {
    importNodes.mockRejectedValue(new Error('400'))
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(dokument))

    await byButton(wrapper, 'Import starten').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('imported')).toBeUndefined()
    expect(wrapper.find('[data-testid="editor-transfer-error"]').exists()).toBe(true)
  })

  it('nimmt den Import zurueck, ohne etwas zu schicken', async () => {
    const wrapper = await mountTransfer()
    await byButton(wrapper, 'Importieren').trigger('click')
    await chooseFile(wrapper, JSON.stringify(dokument))

    await byButton(wrapper, 'Abbrechen').trigger('click')
    await flushPromises()

    expect(importNodes).not.toHaveBeenCalled()
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  })
})
