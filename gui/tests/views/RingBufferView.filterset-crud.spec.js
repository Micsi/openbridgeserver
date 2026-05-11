/**
 * Characterization tests for filterset CRUD interactions in RingBufferView.
 *
 * Locks down the current (#392/#426) behaviour: Neu / Speichern / Duplizieren
 * / Default setzen / Löschen. The current group/rule schema with the
 * `groups[*].rules[*].adaptersText` CSV plaintext shape is intentionally
 * exercised — that surface will be refactored in #438, and these tests are
 * expected to be replaced then.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const FRESH_SAVED = {
  id: 'fs-new',
  name: 'My Set',
  description: '',
  dsl_version: 2,
  is_active: true,
  is_default: false,
  query: {
    filters: {},
    sort: { field: 'ts', order: 'desc' },
    pagination: { limit: 500, offset: 0 },
  },
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  groups: [
    {
      id: 'g-new',
      name: 'Gruppe 1',
      is_active: true,
      group_order: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      rules: [
        {
          id: 'r-new',
          name: 'Regel 1',
          is_active: true,
          rule_order: 0,
          query: {
            filters: {},
            sort: { field: 'ts', order: 'desc' },
            pagination: { limit: 500, offset: 0 },
          },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ],
    },
  ],
}

describe('RingBufferView filterset CRUD', () => {
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

  it('Speichern: builds a v2 payload from the draft and calls createFilterset', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi
        .fn()
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [FRESH_SAVED] }),
      createFilterset: vi.fn().mockResolvedValue({ data: FRESH_SAVED }),
    })

    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="input-filterset-name"]').setValue('My Set')
    // Type a CSV adapter list into the first rule's adapter input to verify
    // that splitCsv → adapters.any_of conversion happens at save time.
    await wrapper.find('[data-testid="rule-adapters-input-0-0"]').setValue('api,knx')
    await wrapper.find('[data-testid="rule-tags-input-0-0"]').setValue(' heizung , licht ')

    await wrapper.find('[data-testid="btn-filterset-save"]').trigger('click')
    await flushPromises()

    expect(ringbufferApi.createFilterset).toHaveBeenCalledTimes(1)
    const payload = ringbufferApi.createFilterset.mock.calls[0][0]
    expect(payload.name).toBe('My Set')
    expect(payload.dsl_version).toBe(2)
    expect(payload.is_active).toBe(true)
    expect(payload.is_default).toBe(false)
    expect(payload.groups).toHaveLength(1)
    expect(payload.groups[0].rules).toHaveLength(1)
    const ruleQuery = payload.groups[0].rules[0].query
    expect(ruleQuery.filters.adapters).toEqual({ any_of: ['api', 'knx'] })
    // Trimmed CSV tags survive into metadata.tags_any_of.
    expect(ruleQuery.filters.metadata).toEqual({ tags_any_of: ['heizung', 'licht'] })
    expect(ruleQuery.pagination).toEqual({ limit: 500, offset: 0 })
    expect(ruleQuery.sort).toEqual({ field: 'ts', order: 'desc' })

    // List is reloaded and the new id is selected.
    expect(ringbufferApi.listFiltersets).toHaveBeenCalledTimes(2)
  })

  it('Speichern updates instead of creating when the draft already has an id', async () => {
    const existing = { ...FRESH_SAVED, id: 'fs-existing', name: 'Old' }
    const updated = { ...existing, name: 'Old Updated' }

    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi.fn().mockResolvedValue({ data: [existing] }),
      getFilterset: vi.fn().mockResolvedValue({ data: existing }),
      updateFilterset: vi.fn().mockResolvedValue({ data: updated }),
    })

    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    const select = wrapper.find('[data-testid="select-filterset"]')
    await select.setValue('fs-existing')
    await flushPromises()

    await wrapper.find('[data-testid="input-filterset-name"]').setValue('Old Updated')
    await wrapper.find('[data-testid="btn-filterset-save"]').trigger('click')
    await flushPromises()

    expect(ringbufferApi.updateFilterset).toHaveBeenCalledTimes(1)
    expect(ringbufferApi.updateFilterset.mock.calls[0][0]).toBe('fs-existing')
    expect(ringbufferApi.createFilterset).not.toHaveBeenCalled()
  })

  it('Speichern aborts with an error message when the name is empty', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="btn-filterset-save"]').trigger('click')
    await flushPromises()

    expect(ringbufferApi.createFilterset).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Set-Name ist erforderlich')
  })

  it('Neu resets the draft to a fresh single-group state', async () => {
    const existing = { ...FRESH_SAVED, id: 'fs-existing', name: 'Existing' }

    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi.fn().mockResolvedValue({ data: [existing] }),
    })

    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="select-filterset"]').setValue('fs-existing')
    await flushPromises()
    expect(wrapper.find('[data-testid="input-filterset-name"]').element.value).toBe('Existing')

    await wrapper.find('[data-testid="btn-filterset-new"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="input-filterset-name"]').element.value).toBe('')
    // single fresh group with one rule
    expect(wrapper.findAll('[data-testid="filterset-group-card"]')).toHaveLength(1)
  })

  it('Duplizieren calls cloneFilterset with the existing name + " (Copy)"', async () => {
    const existing = { ...FRESH_SAVED, id: 'fs-existing', name: 'Origin' }
    const cloned = { ...FRESH_SAVED, id: 'fs-clone', name: 'Origin (Copy)' }

    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi
        .fn()
        .mockResolvedValueOnce({ data: [existing] })
        .mockResolvedValueOnce({ data: [existing, cloned] }),
      cloneFilterset: vi.fn().mockResolvedValue({ data: cloned }),
    })

    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="select-filterset"]').setValue('fs-existing')
    await flushPromises()

    const cloneBtn = wrapper.findAll('button').find((b) => b.text().includes('Duplizieren'))
    expect(cloneBtn).toBeTruthy()
    await cloneBtn.trigger('click')
    await flushPromises()

    expect(ringbufferApi.cloneFilterset).toHaveBeenCalledTimes(1)
    expect(ringbufferApi.cloneFilterset).toHaveBeenCalledWith('fs-existing', 'Origin (Copy)')
  })

  it('Default setzen calls setDefaultFilterset for the selected set', async () => {
    const existing = { ...FRESH_SAVED, id: 'fs-existing', name: 'Origin' }
    const promoted = { ...existing, is_default: true }

    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi
        .fn()
        .mockResolvedValueOnce({ data: [existing] })
        .mockResolvedValueOnce({ data: [promoted] }),
      setDefaultFilterset: vi.fn().mockResolvedValue({ data: promoted }),
    })

    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="select-filterset"]').setValue('fs-existing')
    await flushPromises()

    const defaultBtn = wrapper.findAll('button').find((b) => b.text().includes('Als Default'))
    await defaultBtn.trigger('click')
    await flushPromises()

    expect(ringbufferApi.setDefaultFilterset).toHaveBeenCalledWith('fs-existing')
  })

  it('Löschen calls deleteFilterset and resets the draft', async () => {
    const existing = { ...FRESH_SAVED, id: 'fs-existing', name: 'ToDelete' }

    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi
        .fn()
        .mockResolvedValueOnce({ data: [existing] })
        .mockResolvedValueOnce({ data: [] }),
      deleteFilterset: vi.fn().mockResolvedValue({ data: {} }),
    })

    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="select-filterset"]').setValue('fs-existing')
    await flushPromises()

    const deleteBtn = wrapper.findAll('button').find((b) => b.text().includes('Löschen'))
    await deleteBtn.trigger('click')
    await flushPromises()

    expect(ringbufferApi.deleteFilterset).toHaveBeenCalledWith('fs-existing')
    expect(wrapper.find('[data-testid="input-filterset-name"]').element.value).toBe('')
  })

  it('queryFilterset is called when "Set anwenden" is pressed', async () => {
    const existing = { ...FRESH_SAVED, id: 'fs-existing', name: 'Apply' }

    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi.fn().mockResolvedValue({ data: [existing] }),
      queryFilterset: vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            ts: '2025-01-01T00:00:00Z',
            datapoint_id: 'dp-1',
            name: 'X',
            topic: 'dp/x',
            old_value: null,
            new_value: 42,
            source_adapter: 'api',
            quality: 'good',
            metadata_version: 1,
            metadata: {},
          },
        ],
      }),
    })

    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="select-filterset"]').setValue('fs-existing')
    await flushPromises()
    await wrapper.find('[data-testid="btn-filterset-apply"]').trigger('click')
    await flushPromises()

    expect(ringbufferApi.queryFilterset).toHaveBeenCalledWith('fs-existing')
    expect(wrapper.findAll('[data-testid="ringbuffer-entry"]')).toHaveLength(1)
  })
})
