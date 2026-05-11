/**
 * Characterization tests for the outer ad-hoc filter row in RingBufferView:
 *   - filters.q  → builds filters.q in the queryV2 body
 *   - filters.adapter → builds filters.adapters.any_of with a single value
 *   - applyFilters resets activeFiltersetId and triggers load()
 *   - matchesActiveFilter filters live entries by q (name/id/adapter) and adapter
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('RingBufferView outer ad-hoc filter row', () => {
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

  it('filters.q is forwarded literally as filters.q in queryV2', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="input-filter"]').setValue('heizung')
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.q).toBe('heizung')
    expect(body.pagination).toEqual({ limit: 500, offset: 0 })
    expect(body.sort).toEqual({ field: 'ts', order: 'desc' })
  })

  it('filters.adapter becomes filters.adapters.any_of with a single entry', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    // The adapter input is the only input with placeholder "Adapter" and class "input w-36"
    const adapterInput = wrapper.findAll('input').find((i) => i.attributes('placeholder') === 'Adapter')
    expect(adapterInput).toBeTruthy()
    await adapterInput.setValue('knx')
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.adapters).toEqual({ any_of: ['knx'] })
  })

  it('empty q + empty adapter produces an empty filters object', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters).toEqual({})
  })

  it('matchesActiveFilter: live entries failing the q substring are dropped', async () => {
    const { mountRingBufferView, flushPromises } = await import('../helpers/mountRingBufferView.js')
    const { wrapper, emitLive } = await mountRingBufferView()

    await wrapper.find('[data-testid="input-filter"]').setValue('boiler')

    emitLive({
      id: 1,
      ts: new Date().toISOString(),
      datapoint_id: 'dp-1',
      name: 'Hauptboiler-Sensor',
      topic: 'dp/1',
      old_value: null,
      new_value: 1,
      source_adapter: 'api',
      quality: 'good',
      metadata_version: 1,
      metadata: {},
    })
    emitLive({
      id: 2,
      ts: new Date().toISOString(),
      datapoint_id: 'dp-2',
      name: 'Lampe-1',
      topic: 'dp/2',
      old_value: null,
      new_value: 1,
      source_adapter: 'api',
      quality: 'good',
      metadata_version: 1,
      metadata: {},
    })

    await new Promise((r) => setTimeout(r, 100))
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="ringbuffer-entry"]')
    expect(rows.length).toBe(1)
    expect(rows[0].attributes('data-dp')).toBe('dp-1')
  })

  it('matchesActiveFilter: filters.adapter is an EXACT match (substring "ap" rejects "api")', async () => {
    const { mountRingBufferView, flushPromises } = await import('../helpers/mountRingBufferView.js')
    const { wrapper, emitLive } = await mountRingBufferView()

    const adapterInput = wrapper.findAll('input').find((i) => i.attributes('placeholder') === 'Adapter')
    await adapterInput.setValue('ap')

    emitLive({
      id: 1,
      ts: new Date().toISOString(),
      datapoint_id: 'dp-1',
      name: 'x',
      topic: 'dp/1',
      old_value: null,
      new_value: 1,
      source_adapter: 'api',
      quality: 'good',
      metadata_version: 1,
      metadata: {},
    })

    await new Promise((r) => setTimeout(r, 100))
    await flushPromises()

    // 'ap' !== 'api' → entry suppressed.
    expect(wrapper.findAll('[data-testid="ringbuffer-entry"]').length).toBe(0)
  })

  it('applyFilters clears any selected filterset id (returns to live mode)', async () => {
    const FRESH = {
      id: 'fs-x',
      name: 'X',
      description: '',
      dsl_version: 2,
      is_active: true,
      is_default: false,
      query: { filters: {}, sort: { field: 'ts', order: 'desc' }, pagination: { limit: 500, offset: 0 } },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      groups: [
        {
          id: 'g',
          name: 'G',
          is_active: true,
          group_order: 0,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          rules: [
            {
              id: 'r',
              name: 'R',
              is_active: true,
              rule_order: 0,
              query: { filters: {}, sort: { field: 'ts', order: 'desc' }, pagination: { limit: 500, offset: 0 } },
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
        },
      ],
    }

    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi.fn().mockResolvedValue({ data: [FRESH] }),
      queryFilterset: vi.fn().mockResolvedValue({ data: [] }),
    })

    const { wrapper, emitLive } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="select-filterset"]').setValue('fs-x')
    await flushPromises()
    await wrapper.find('[data-testid="btn-filterset-apply"]').trigger('click')
    await flushPromises()

    // Now press "Filter anwenden" — should switch back to ad-hoc mode and re-enable live pushes.
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    emitLive({
      id: 9,
      ts: new Date().toISOString(),
      datapoint_id: 'dp-9',
      name: 'live entry',
      topic: 'dp/9',
      old_value: null,
      new_value: 9,
      source_adapter: 'api',
      quality: 'good',
      metadata_version: 1,
      metadata: {},
    })
    await new Promise((r) => setTimeout(r, 100))
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="ringbuffer-entry"]')
    expect(rows.length).toBe(1)
    expect(rows[0].attributes('data-dp')).toBe('dp-9')
  })
})
