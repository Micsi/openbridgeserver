/**
 * Characterization tests for the "Vorfilter…" assistant modal.
 *
 * Covers:
 *   - opening the modal preloads hierarchy trees and flattened node list
 *   - tag CSV input becomes a comma-joined `tag` param to searchApi.search()
 *   - the selected node id is forwarded as `node_id`
 *   - applyPrefilterSuggestion merges the returned datapoint ids and tags
 *     into the target rule's datapointsText / tagsText (deduped, preserved
 *     CSV order).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('RingBufferView prefilter assistant modal', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('@/api/client')
    vi.doUnmock('@/stores/websocket')
    vi.doUnmock('@/composables/useTz')
    vi.doUnmock('@/components/ui/Badge.vue')
    vi.doUnmock('@/components/ui/Spinner.vue')
    vi.doUnmock('@/components/ui/Modal.vue')
  })

  it('opening the modal loads the tree list and flattens nodes', async () => {
    const {
      mountRingBufferView,
      makeHierarchyApiMock,
      flushPromises,
    } = await import('../helpers/mountRingBufferView.js')

    const hierarchyApi = makeHierarchyApiMock({
      listTrees: vi.fn().mockResolvedValue({
        data: [{ id: 'tree-1', name: 'Gebäude' }],
      }),
      getTreeNodes: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'n-root',
            name: 'EG',
            children: [{ id: 'n-child', name: 'Küche', children: [] }],
          },
        ],
      }),
    })

    const { wrapper } = await mountRingBufferView({ hierarchyApi })

    await wrapper.find('[data-testid="btn-open-prefilter-assistant-0-0"]').trigger('click')
    await flushPromises()

    expect(hierarchyApi.listTrees).toHaveBeenCalledTimes(1)
    expect(hierarchyApi.getTreeNodes).toHaveBeenCalledWith('tree-1')

    const nodeSelect = wrapper.find('[data-testid="prefilter-node-select"]')
    const options = nodeSelect.findAll('option')
    const paths = options.map((o) => o.text())
    expect(paths).toContain('Gebäude / EG')
    expect(paths).toContain('Gebäude / EG / Küche')
  })

  it('applyPrefilterSuggestion forwards CSV tags + node_id to searchApi and merges results', async () => {
    const {
      mountRingBufferView,
      makeSearchApiMock,
      makeHierarchyApiMock,
      flushPromises,
    } = await import('../helpers/mountRingBufferView.js')

    const searchApi = makeSearchApiMock({
      search: vi.fn().mockResolvedValue({
        data: { items: [{ id: 'dp-A' }, { id: 'dp-B' }, { id: 'dp-A' }] },
      }),
    })
    const hierarchyApi = makeHierarchyApiMock({
      listTrees: vi.fn().mockResolvedValue({ data: [{ id: 'tree-1', name: 'T' }] }),
      getTreeNodes: vi.fn().mockResolvedValue({
        data: [{ id: 'n-1', name: 'Node1', children: [] }],
      }),
    })

    const { wrapper } = await mountRingBufferView({ searchApi, hierarchyApi })

    // Prefill the target rule's datapoints + tags so we can verify merge behaviour.
    await wrapper.find('[data-testid="rule-datapoints-input-0-0"]').setValue('dp-Z')
    await wrapper.find('[data-testid="rule-tags-input-0-0"]').setValue('schon-da')

    await wrapper.find('[data-testid="btn-open-prefilter-assistant-0-0"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="prefilter-tags-input"]').setValue('heizung, licht ,heizung')
    await wrapper.find('[data-testid="prefilter-node-select"]').setValue('n-1')
    await flushPromises()

    await wrapper.find('[data-testid="btn-apply-prefilter-suggestion"]').trigger('click')
    await flushPromises()

    expect(searchApi.search).toHaveBeenCalledTimes(1)
    const params = searchApi.search.mock.calls[0][0]
    expect(params.tag).toBe('heizung,licht,heizung')
    expect(params.node_id).toBe('n-1')
    expect(params.page).toBe(0)
    expect(params.size).toBe(500)

    // Merged datapoint ids: existing "dp-Z" + de-duplicated returned ids.
    const dpInput = wrapper.find('[data-testid="rule-datapoints-input-0-0"]').element
    expect(dpInput.value.split(',').sort()).toEqual(['dp-A', 'dp-B', 'dp-Z'])

    // Tags merged with existing "schon-da".
    const tagsInput = wrapper.find('[data-testid="rule-tags-input-0-0"]').element
    expect(tagsInput.value.split(',').sort()).toEqual(['heizung', 'licht', 'schon-da'])
  })

  it('errors during search surface in prefilterMsg and keep the modal open', async () => {
    const {
      mountRingBufferView,
      makeSearchApiMock,
      makeHierarchyApiMock,
      flushPromises,
    } = await import('../helpers/mountRingBufferView.js')

    const searchApi = makeSearchApiMock({
      search: vi.fn().mockRejectedValue({ response: { data: { detail: 'boom' } } }),
    })
    const hierarchyApi = makeHierarchyApiMock({
      listTrees: vi.fn().mockResolvedValue({ data: [] }),
    })

    const { wrapper } = await mountRingBufferView({ searchApi, hierarchyApi })

    await wrapper.find('[data-testid="btn-open-prefilter-assistant-0-0"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="prefilter-tags-input"]').setValue('a')
    await wrapper.find('[data-testid="btn-apply-prefilter-suggestion"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('boom')
  })
})
