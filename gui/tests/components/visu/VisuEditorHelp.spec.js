import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Der Hilfe-Knopf einer neuen Editor-Oberflaeche, am laufenden Bauteil (M5
 * Teil D, #174).
 *
 * `tests/help/visuEditorHelpAnchors.spec.js` liest die Quellen und die
 * Hilfe-Anker; das faengt einen fehlenden Anker, aber nicht einen Knopf, der
 * gar nicht ankommt (falsch registriert, in einem `v-if` versteckt, ohne
 * Wirkung). Deshalb hier eine Montage: der Knopf steht da, und ein Klick oeffnet
 * die Schublade GENAU auf der Id dieser Flaeche.
 */

const TREE = [
  { id: 'p1', parent_id: null, name: 'M5 Home', type: 'PAGE', kind: 'normal', order: 10, access: 'public' },
]

let pinia

beforeEach(() => {
  vi.resetModules()
  pinia = createPinia()
  setActivePinia(pinia)
  vi.doMock('@/api/visu', () => ({
    visuApi: {
      tree: vi.fn().mockResolvedValue({ data: TREE.map((n) => ({ ...n })) }),
      getPage: vi.fn().mockResolvedValue({
        data: { widgets: [], includes: [], ignore_global_includes: false, popup: null },
      }),
      savePage: vi.fn().mockResolvedValue({ status: 204 }),
      createNode: vi.fn().mockResolvedValue({ data: { id: 'neu' } }),
      updateNode: vi.fn().mockResolvedValue({ data: {} }),
      deleteNode: vi.fn().mockResolvedValue({ status: 204 }),
      moveNode: vi.fn().mockResolvedValue({ data: {} }),
      nodeUsers: vi.fn().mockResolvedValue({ data: [] }),
      usernames: vi.fn().mockResolvedValue({ data: [] }),
    },
  }))
  vi.doMock('@/api/client', () => ({
    helpApi: { index: vi.fn().mockResolvedValue({ data: { helpIds: {} } }) },
  }))
})

afterEach(() => {
  vi.doUnmock('@/api/visu')
  vi.doUnmock('@/api/client')
})

describe('Visu-Editor — Hilfe-Anker am laufenden Bauteil', () => {
  it('zeigt am Seitenbaum einen Hilfe-Knopf, der die Schublade auf visu-page-tree oeffnet', async () => {
    const { useVisuEditorStore } = await import('@/stores/visuEditor')
    await useVisuEditorStore().load()
    const { default: VisuPageTree } = await import('@/components/visu/VisuPageTree.vue')
    const wrapper = mount(VisuPageTree, { global: { plugins: [pinia] } })
    await flushPromises()

    const knopf = wrapper.find('[data-testid="help-button-visu-page-tree"]')
    expect(knopf.exists()).toBe(true)

    const { useHelpStore } = await import('@/stores/help')
    const help = useHelpStore()
    expect(help.isOpen).toBe(false)

    await knopf.trigger('click')
    expect([help.isOpen, help.currentHelpId]).toEqual([true, 'visu-page-tree'])
  })
})
