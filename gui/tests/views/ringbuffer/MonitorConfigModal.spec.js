/**
 * Tests for MonitorConfigModal.vue (issue #438) — QA-01 coverage audit (#439).
 *
 * The modal is the Ringbuffer config UI. It only fetches /stats once it is
 * opened (deferred-load pattern from #438) and re-hydrates the form on each
 * open. On submit it serialises the form back into the flat
 * `ringbufferApi.config()` payload and shows a success/error banner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.doUnmock('@/api/client')
  vi.doUnmock('@/components/ui/Modal.vue')
  vi.doUnmock('@/components/ui/Spinner.vue')
})

function makeApi(overrides = {}) {
  return {
    stats: vi.fn().mockResolvedValue({
      data: {
        total: 1234,
        max_entries: 50000,
        max_file_size_bytes: 2 * 1024 * 1024 * 1024, // 2 GB
        max_age: 30 * 24 * 60 * 60, // 30 days
        file_size_bytes: 1024 * 1024 * 500, // 500 MB
      },
    }),
    config: vi.fn().mockResolvedValue({
      data: {
        total: 1234,
        max_entries: 50000,
        max_file_size_bytes: 2 * 1024 * 1024 * 1024,
        max_age: 30 * 24 * 60 * 60,
        file_size_bytes: 1024 * 1024 * 500,
      },
    }),
    ...overrides,
  }
}

async function mountModal({ initialOpen = true, api } = {}) {
  api = api ?? makeApi()
  vi.doMock('@/api/client', () => ({ ringbufferApi: api }))

  // Modal stub renders slot only when modelValue=true.
  vi.doMock('@/components/ui/Modal.vue', () => ({
    default: defineComponent({
      name: 'Modal',
      props: ['modelValue', 'title', 'maxWidth'],
      emits: ['update:modelValue'],
      setup(props, { slots }) {
        return () =>
          props.modelValue
            ? h('div', { 'data-testid': 'config-modal' }, slots.default ? slots.default() : null)
            : null
      },
    }),
  }))

  vi.doMock('@/components/ui/Spinner.vue', () => ({
    default: defineComponent({
      name: 'Spinner',
      props: ['size', 'color'],
      setup() {
        return () => h('span', { 'data-testid': 'spinner' })
      },
    }),
  }))

  const mod = await import('@/views/ringbuffer/MonitorConfigModal.vue')
  const MonitorConfigModal = mod.default
  const wrapper = mount(MonitorConfigModal, {
    props: { modelValue: initialOpen },
    attachTo: document.body,
  })
  await flushPromises()
  // The first watch fires when modelValue transitions to true. The initial
  // mount with modelValue=true does not fire the watcher (watch tracks
  // changes, not the initial state) — toggle to make it observable.
  if (initialOpen) {
    await wrapper.setProps({ modelValue: false })
    await flushPromises()
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
  }
  return { wrapper, api }
}

describe('MonitorConfigModal QA-01 coverage (#439)', () => {
  it('fetches /stats only after the modal opens and hydrates the form', async () => {
    const { wrapper, api } = await mountModal()
    expect(api.stats).toHaveBeenCalled()

    // Stats display
    expect(wrapper.find('[data-testid="rb-config-stats-total"]').text()).toContain('1234')
    expect(wrapper.find('[data-testid="rb-config-stats-file-size"]').text()).toContain('500')
    // 30 days is exactly 1 month per the modal's formatRetention helper.
    expect(wrapper.find('[data-testid="rb-config-stats-retention"]').text()).toMatch(/(30 Tage|1 Monate)/)

    // Form hydration: 2 GB → unit=gb, value=2; 30 days → unit=days, value=30.
    expect(wrapper.find('[data-testid="rb-config-max-entries"]').element.value).toBe('50000')
    expect(wrapper.find('[data-testid="rb-config-max-size-value"]').element.value).toBe('2')
    expect(wrapper.find('[data-testid="rb-config-max-size-unit"]').element.value).toBe('gb')
    // 30 days = 1 month per the picker, so the form picks unit=months.
    expect(wrapper.find('[data-testid="rb-config-retention-value"]').element.value).toBe('1')
    expect(wrapper.find('[data-testid="rb-config-retention-unit"]').element.value).toBe('months')
  })

  it('hydrates retention defaults when stats has no max_age / max_file_size_bytes', async () => {
    const api = makeApi({
      stats: vi.fn().mockResolvedValue({
        data: {
          total: 0,
          max_entries: 10000,
          max_file_size_bytes: null,
          max_age: null,
          file_size_bytes: 0,
        },
      }),
    })
    const { wrapper } = await mountModal({ api })
    expect(wrapper.find('[data-testid="rb-config-max-size-value"]').element.value).toBe('500')
    expect(wrapper.find('[data-testid="rb-config-retention-value"]').element.value).toBe('30')
    // Both checkboxes should be unchecked
    const sizeCheck = wrapper.find('#max-size-enabled').element
    const retCheck = wrapper.find('#retention-enabled').element
    expect(sizeCheck.checked).toBe(false)
    expect(retCheck.checked).toBe(false)
  })

  it('formats retention values that match months / years cleanly', async () => {
    const monthsApi = makeApi({
      stats: vi.fn().mockResolvedValue({
        data: {
          total: 0,
          max_entries: 10000,
          max_file_size_bytes: null,
          max_age: 6 * 30 * 24 * 60 * 60, // 6 months
          file_size_bytes: 0,
        },
      }),
    })
    const { wrapper } = await mountModal({ api: monthsApi })
    expect(wrapper.find('[data-testid="rb-config-retention-value"]').element.value).toBe('6')
    expect(wrapper.find('[data-testid="rb-config-retention-unit"]').element.value).toBe('months')
  })

  it('falls back silently when /stats rejects — the form still renders', async () => {
    const failApi = makeApi({
      stats: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const { wrapper, api } = await mountModal({ api: failApi })
    expect(api.stats).toHaveBeenCalled()
    // The form is still mounted with defaults
    expect(wrapper.find('[data-testid="rb-config-max-entries"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rb-config-max-entries"]').element.value).toBe('10000')
  })

  it('submitting the form posts a flat payload and shows a success banner', async () => {
    const { wrapper, api } = await mountModal()
    // Tweak the max-entries to verify the value flows into the payload
    await wrapper.find('[data-testid="rb-config-max-entries"]').setValue(75000)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.config).toHaveBeenCalledTimes(1)
    const payload = api.config.mock.calls[0][0]
    expect(payload.max_entries).toBe(75000)
    expect(payload.storage).toBe('file')
    // Success banner
    expect(wrapper.text()).toContain('Monitor-Konfiguration gespeichert')
  })

  it('rejects an invalid max-entries value with an inline error', async () => {
    const { wrapper, api } = await mountModal()
    await wrapper.find('[data-testid="rb-config-max-entries"]').setValue(10) // < 100
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.config).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('mindestens 100')
  })

  it('rejects a zero max-size value with an inline error', async () => {
    const { wrapper, api } = await mountModal()
    // Enable the size cap and set value to 0
    await wrapper.find('#max-size-enabled').setValue(true)
    await wrapper.find('[data-testid="rb-config-max-size-value"]').setValue('0')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.config).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Speicherplatz muss grösser')
  })

  it('shows a server-side error from the config call', async () => {
    const api = makeApi({
      config: vi.fn().mockRejectedValue({ response: { data: { detail: 'server says no' } } }),
    })
    const { wrapper } = await mountModal({ api })
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('server says no')
  })
})
