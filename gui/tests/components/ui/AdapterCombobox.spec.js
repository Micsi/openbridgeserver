/**
 * Tests for AdapterCombobox.vue — multi-select over adapterApi.list().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('@/api/client')
})

async function mountAdapterCombobox(adapters, props = {}) {
  const adapterApi = {
    list: vi.fn().mockResolvedValue({ data: adapters }),
  }
  vi.doMock('@/api/client', () => ({ adapterApi }))
  const mod = await import('@/components/ui/AdapterCombobox.vue')
  const wrapper = mount(mod.default, { props, attachTo: document.body })
  await flushPromises()
  return { wrapper, adapterApi }
}

describe('AdapterCombobox', () => {
  it('fetches adapters via adapterApi.list() on mount', async () => {
    const { adapterApi } = await mountAdapterCombobox([
      { adapter_type: 'knx', label: 'KNX' },
      { adapter_type: 'mqtt', label: 'MQTT' },
    ])
    expect(adapterApi.list).toHaveBeenCalledTimes(1)
  })

  it('renders visible adapter types as items', async () => {
    const { wrapper } = await mountAdapterCombobox([
      { adapter_type: 'knx', label: 'KNX' },
      { adapter_type: 'mqtt', label: 'MQTT' },
      { adapter_type: 'hidden_one', hidden: true },
    ])
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    const items = wrapper.findAll('[data-testid^="combobox-item-"]')
    expect(items.length).toBe(2)
  })

  it('emits string[] when adapter is selected', async () => {
    const { wrapper } = await mountAdapterCombobox([
      { adapter_type: 'knx' },
      { adapter_type: 'mqtt' },
    ])
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    await wrapper.find('[data-testid="combobox-item-1"]').trigger('click')
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    const last = events[events.length - 1][0]
    expect(Array.isArray(last)).toBe(true)
    expect(last).toEqual(['mqtt'])
  })

  it('renders chips for pre-selected adapters', async () => {
    const { wrapper } = await mountAdapterCombobox(
      [
        { adapter_type: 'knx', label: 'KNX' },
        { adapter_type: 'mqtt', label: 'MQTT' },
      ],
      { modelValue: ['knx', 'mqtt'] },
    )
    const chips = wrapper.findAll('[data-testid^="combobox-chip-"]:not([data-testid*="remove"])')
    expect(chips.length).toBe(2)
  })

  it('filters adapters by query', async () => {
    const { wrapper } = await mountAdapterCombobox([
      { adapter_type: 'knx', label: 'KNX' },
      { adapter_type: 'mqtt', label: 'MQTT' },
      { adapter_type: 'modbus_tcp', label: 'Modbus TCP' },
    ])
    const input = wrapper.find('input')
    await input.trigger('focus')
    await flushPromises()
    input.element.value = 'mod'
    await input.trigger('input')
    await new Promise((r) => setTimeout(r, 250))
    await flushPromises()
    const items = wrapper.findAll('[data-testid^="combobox-item-"]')
    expect(items.length).toBe(1)
  })

  it('survives a rejected list call', async () => {
    const adapterApi = { list: vi.fn().mockRejectedValue(new Error('boom')) }
    vi.doMock('@/api/client', () => ({ adapterApi }))
    const mod = await import('@/components/ui/AdapterCombobox.vue')
    const wrapper = mount(mod.default, { props: { modelValue: [] }, attachTo: document.body })
    await flushPromises()
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(wrapper.find('[data-testid="combobox-empty"]').exists()).toBe(true)
  })
})
