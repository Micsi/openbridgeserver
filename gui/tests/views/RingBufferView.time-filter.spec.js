/**
 * Characterization tests for absolute + relative time filters in
 * RingBufferView. Functions buildTimeFilter / parseRelativeSeconds /
 * localToIso / computeEffectiveBoundary are local to the component,
 * so we exercise them through their two observable side effects:
 *   1) the body that is sent to ringbufferApi.queryV2()
 *   2) the matchesActiveFilter() pre-filter on live entries
 *      (verified indirectly via the flush behaviour)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('RingBufferView time filter', () => {
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

  it('builds an empty payload (no time block) when no time filter is set', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.time).toBeUndefined()
  })

  it('localToIso converts datetime-local "YYYY-MM-DDTHH:MM" into ISO with Z', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="time-from-absolute"]').setValue('2025-01-01T12:00')
    await wrapper.find('[data-testid="time-to-absolute"]').setValue('2025-01-02T15:30')
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.time).toBeDefined()
    expect(body.filters.time.from).toMatch(/^2025-01-01T\d{2}:00:00\.000Z$/)
    expect(body.filters.time.to).toMatch(/^2025-01-02T\d{2}:30:00\.000Z$/)
  })

  it('parseRelativeSeconds: negative seconds round-trip into from_relative_seconds', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="time-from-relative-seconds"]').setValue('-60')
    await wrapper.find('[data-testid="time-to-relative-seconds"]').setValue('-5')
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.time).toEqual({
      from_relative_seconds: -60,
      to_relative_seconds: -5,
    })
  })

  it('parseRelativeSeconds: invalid input is dropped, not coerced to 0', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="time-from-relative-seconds"]').setValue('abc')
    // datetime-local also stays empty
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.time).toBeUndefined()
  })

  it('combines absolute + relative bounds into the same payload (server picks effective)', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="time-from-absolute"]').setValue('2025-01-01T12:00')
    await wrapper.find('[data-testid="time-from-relative-seconds"]').setValue('-30')
    await wrapper.find('[data-testid="time-to-absolute"]').setValue('2025-01-02T12:00')
    await wrapper.find('[data-testid="time-to-relative-seconds"]').setValue('-1')
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.time.from).toBeDefined()
    expect(body.filters.time.to).toBeDefined()
    expect(body.filters.time.from_relative_seconds).toBe(-30)
    expect(body.filters.time.to_relative_seconds).toBe(-1)
  })

  it('open from-bound only — no to-bound — is allowed', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="time-from-relative-seconds"]').setValue('-300')
    await wrapper.find('[data-testid="btn-apply-ringbuffer-filters"]').trigger('click')
    await flushPromises()

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.time).toEqual({ from_relative_seconds: -300 })
  })

  it('computeEffectiveBoundary filters out a too-old live entry when from is set', async () => {
    // Use a fixed Date.now() so "from_relative_seconds=-300" is deterministic.
    // Stub only Date.now() (don't fake timers — flushPromises relies on real setTimeout).
    const FIXED_NOW = Date.UTC(2025, 5, 1, 12, 0, 0)
    const realNow = Date.now
    Date.now = () => FIXED_NOW

    try {
      const { mountRingBufferView, flushPromises } = await import('../helpers/mountRingBufferView.js')
      const { wrapper, emitLive } = await mountRingBufferView()

      // Set "from relative" = -300 seconds. Any entry with ts < (now - 300s) is rejected.
      await wrapper.find('[data-testid="time-from-relative-seconds"]').setValue('-300')

      const tooOld = {
        id: 1,
        ts: new Date(FIXED_NOW - 600_000).toISOString(), // 10 minutes ago — older than 300s
        datapoint_id: 'dp-1',
        name: 'Old',
        topic: 'dp/1',
        old_value: null,
        new_value: 1,
        source_adapter: 'api',
        quality: 'good',
        metadata_version: 1,
        metadata: {},
      }
      const fresh = {
        ...tooOld,
        id: 2,
        ts: new Date(FIXED_NOW + 60_000).toISOString(), // 1 minute in the future — newer than -300s
        datapoint_id: 'dp-2',
      }

      emitLive(tooOld)
      emitLive(fresh)
      await new Promise((r) => setTimeout(r, 100))
      await flushPromises()

      const rows = wrapper.findAll('[data-testid="ringbuffer-entry"]')
      expect(rows.length).toBe(1)
      expect(rows[0].attributes('data-dp')).toBe('dp-2')
    } finally {
      Date.now = realNow
    }
  })

  it('"Zeitfilter leeren" clears all four inputs and triggers a refetch', async () => {
    const { mountRingBufferView, makeRingbufferApiMock, flushPromises } = await import(
      '../helpers/mountRingBufferView.js'
    )

    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })

    await wrapper.find('[data-testid="time-from-absolute"]').setValue('2025-01-01T12:00')
    await wrapper.find('[data-testid="time-from-relative-seconds"]').setValue('-60')

    const clearBtn = wrapper.findAll('button').find((b) => b.text().includes('Zeitfilter leeren'))
    await clearBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="time-from-absolute"]').element.value).toBe('')
    expect(wrapper.find('[data-testid="time-from-relative-seconds"]').element.value).toBe('')

    const body = ringbufferApi.queryV2.mock.calls.at(-1)[0]
    expect(body.filters.time).toBeUndefined()
  })
})
