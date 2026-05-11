import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('RingBufferView mounts', () => {
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

  it('mounts with empty initial state', async () => {
    const { mountRingBufferView } = await import('../helpers/mountRingBufferView.js')
    const { wrapper, ringbufferApi } = await mountRingBufferView()

    expect(ringbufferApi.queryV2).toHaveBeenCalledTimes(1)
    expect(ringbufferApi.stats).toHaveBeenCalledTimes(1)
    expect(ringbufferApi.listFiltersets).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="ringbuffer-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="select-filterset"]').exists()).toBe(true)
  })
})
