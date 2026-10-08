/**
 * Tests for DpCombobox.vue.
 *
 * After the FE-05 refactor the component is a wrapper around the generic
 * Combobox.vue. Its public API must stay compatible with #429-era callers:
 *   - modelValue: string (DP id)
 *   - displayName: string (label shown when an item is selected)
 *   - emits update:modelValue (string) and select (item | null)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import sameName from '../../fixtures/search-same-name.json'
import picker from '../../fixtures/dp-picker-api.json'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('@/api/client')
})

async function mountDpCombobox(props = {}, { searchResult = [] } = {}) {
  const searchApi = {
    search: vi.fn().mockResolvedValue({ data: { items: searchResult } }),
  }
  vi.doMock('@/api/client', () => ({ searchApi }))
  const mod = await import('@/components/ui/DpCombobox.vue')
  const DpCombobox = mod.default
  const wrapper = mount(DpCombobox, { props, attachTo: document.body })
  await flushPromises()
  return { wrapper, searchApi }
}

describe('DpCombobox', () => {
  it('mounts with empty state', async () => {
    const { wrapper } = await mountDpCombobox({ modelValue: '', displayName: '' })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('emits a string id on selection (not an array)', async () => {
    const items = [
      { id: 'dp-1', name: 'Temperatur', data_type: 'float', unit: '°C' },
      { id: 'dp-2', name: 'Schalter', data_type: 'bool' },
    ]
    const { wrapper, searchApi } = await mountDpCombobox(
      { modelValue: '', displayName: '' },
      { searchResult: items },
    )
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(searchApi.search).toHaveBeenCalled()
    await wrapper.find('[data-testid="combobox-item-0"]').trigger('click')

    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    const last = events[events.length - 1][0]
    expect(typeof last).toBe('string')
    expect(last).toBe('dp-1')

    const selectEvents = wrapper.emitted('select')
    expect(selectEvents).toBeTruthy()
    expect(selectEvents[selectEvents.length - 1][0]).toMatchObject({ id: 'dp-1', name: 'Temperatur' })
  })

  it('shows the displayName when provided', async () => {
    const { wrapper } = await mountDpCombobox({ modelValue: 'dp-1', displayName: 'Vorbelegt' })
    expect(wrapper.find('input').element.value).toBe('Vorbelegt')
  })

  it('renders no chips (single mode)', async () => {
    const { wrapper } = await mountDpCombobox({ modelValue: 'dp-1', displayName: 'X' })
    expect(wrapper.findAll('[data-testid^="combobox-chip-"]:not([data-testid*="remove"])').length).toBe(0)
  })

  it('emits select(null) on clear', async () => {
    const items = [{ id: 'dp-1', name: 'T', data_type: 'float' }]
    const { wrapper } = await mountDpCombobox(
      { modelValue: 'dp-1', displayName: 'T' },
      { searchResult: items },
    )
    const btn = wrapper.find('[data-testid="combobox-clear"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await flushPromises()
    const selEvents = wrapper.emitted('select')
    expect(selEvents).toBeTruthy()
    expect(selEvents[selEvents.length - 1][0]).toBeNull()
  })

  it('handles a rejected search call by showing empty state', async () => {
    const searchApi = { search: vi.fn().mockRejectedValue(new Error('boom')) }
    vi.doMock('@/api/client', () => ({ searchApi }))
    const mod = await import('@/components/ui/DpCombobox.vue')
    const wrapper = mount(mod.default, {
      props: { modelValue: '', displayName: '' },
      attachTo: document.body,
    })
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(wrapper.find('[data-testid="combobox-empty"]').exists()).toBe(true)
  })

  it('updates the displayName watcher when both id+name change', async () => {
    const items = [{ id: 'dp-2', name: 'Two', data_type: 'int' }]
    const { wrapper } = await mountDpCombobox(
      { modelValue: '', displayName: '' },
      { searchResult: items },
    )
    await wrapper.setProps({ modelValue: 'dp-2', displayName: 'Two' })
    await flushPromises()
    expect(wrapper.find('input').element.value).toBe('Two')
  })

  it('passes empty array as items when search returns plain data', async () => {
    const searchApi = { search: vi.fn().mockResolvedValue({ data: [] }) }
    vi.doMock('@/api/client', () => ({ searchApi }))
    const mod = await import('@/components/ui/DpCombobox.vue')
    const wrapper = mount(mod.default, {
      props: { modelValue: '', displayName: '' },
      attachTo: document.body,
    })
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(wrapper.find('[data-testid="combobox-empty"]').exists()).toBe(true)
  })
})

// #1266 P9: the combobox lines come from the picker's path formatter, fed with
// search responses recorded from real imports (see the fixtures' integration tests).
describe('DpCombobox – path lines (#1266)', () => {
  const groupsTree = picker.search.find((entry) => entry.params.tree_id === 'tree-groups' && entry.params.size === 500 && Object.keys(entry.params).length === 2).response.items

  const lines = (wrapper) =>
    wrapper.findAll('[data-testid^="combobox-item-"]').map((li) => li.findAll('[data-testid="dp-path-line"]').map((l) => l.text()).join(' | '))
  const gas = (wrapper) =>
    wrapper.findAll('[data-testid^="combobox-item-"]').map((li) => (li.find('[data-testid="dp-path-ga"]').exists() ? li.get('[data-testid="dp-path-ga"]').text() : null))

  it.each([
    ['ThreeLevel', ['1/1/96', '1/1/97', null]],
    ['TwoLevel', ['1/352', '1/353', null]],
    ['Free', ['2400', '2401', null]],
  ])('shows the path once with the name, and the address only for the twins (%s)', async (style, expected) => {
    const { useKnxProjectStore } = await import('@/stores/knxProject')
    useKnxProjectStore().groupAddressStyle = style
    const { wrapper } = await mountDpCombobox({ modelValue: '' }, { searchResult: sameName })
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(lines(wrapper)).toEqual([
      'Demo 01 - Binaersignale › Schalten › Spots P8',
      'Demo 01 - Binaersignale › Schalten › Spots P8',
      'Demo 01 - Binaersignale › Status Rueckmeldung › Spots P8',
    ])
    expect(gas(wrapper)).toEqual(expected)
  })

  it('puts the picked line into the input and the select event', async () => {
    const { wrapper } = await mountDpCombobox({ modelValue: '' }, { searchResult: sameName })
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    await wrapper.find('[data-testid="combobox-item-1"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('input').element.value).toBe('Demo 01 - Binaersignale › Schalten › Spots P8 · 1/1/97')
    expect(wrapper.emitted('select').at(-1)[0]).toMatchObject({ id: 'dp-5', label: 'Demo 01 - Binaersignale › Schalten › Spots P8 · 1/1/97' })
  })

  it('takes the paths from the tree most suggestions have one in, or from the given tree', async () => {
    const auto = await mountDpCombobox({ modelValue: '' }, { searchResult: groupsTree })
    await auto.wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(lines(auto.wrapper).every((line) => line.startsWith('Neue Hauptgruppe › Neue Mittelgruppe › '))).toBe(true)

    vi.resetModules()
    const chosen = await mountDpCombobox({ modelValue: '', treeId: 'tree-buildings' }, { searchResult: groupsTree })
    await chosen.wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(lines(chosen.wrapper)).toContain('Demo-Test-Projekt › EG › Kueche › Licht Decke › Schalten')
    expect(gas(chosen.wrapper).every((ga) => ga === null)).toBe(true)
  })

  it('labels chips of preset ids with their line (multi mode)', async () => {
    const searchApi = {
      search: vi.fn(async ({ q }) => ({ data: { items: sameName.filter((item) => item.id === q) } })),
    }
    vi.doMock('@/api/client', () => ({ searchApi }))
    const { default: DpCombobox } = await import('@/components/ui/DpCombobox.vue')
    const wrapper = mount(DpCombobox, { props: { multi: true, modelValue: ['dp-7'] }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.get('[data-testid="combobox-chip-0"]').text()).toBe('Demo 01 - Binaersignale › Status Rueckmeldung › Spots P8')
  })

  it('keeps the raw id as chip label when a preset id is not found', async () => {
    const searchApi = { search: vi.fn(async () => ({ data: { items: [] } })) }
    vi.doMock('@/api/client', () => ({ searchApi }))
    const { default: DpCombobox } = await import('@/components/ui/DpCombobox.vue')
    const wrapper = mount(DpCombobox, { props: { multi: true, modelValue: ['gone'] }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.get('[data-testid="combobox-chip-0"]').text()).toBe('gone')
  })

  it('marks twins it cannot tell apart, e.g. without a visible group address', async () => {
    const hidden = sameName.map((item) => ({ ...item, group_address: null }))
    const { wrapper } = await mountDpCombobox({ modelValue: '' }, { searchResult: hidden })
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    const marks = wrapper
      .findAll('[data-testid^="combobox-item-"]')
      .map((li) => li.find('[data-testid="dp-path-ambiguous"]').exists())
    expect(marks).toEqual([true, true, false])
    expect(gas(wrapper)).toEqual([null, null, null])
  })
})
