/**
 * Seam S9 (#1266 P9): DpPicker over props, events and operation.
 *
 * The API client is replaced by a fake that answers from
 * `fixtures/dp-picker-api.json`, recorded from a real .knxproj import by
 * `tests/integration/test_dp_picker_api_fixture.py` (a room project in main
 * group 30: rooms with ETS functions and generic address names, three devices).
 * A search the recording does not hold fails the test instead of inventing an
 * answer. The K/R layout families come from `search-ets-layouts.json` and
 * `search-same-name.json`, recorded the same way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import picker from '../../fixtures/dp-picker-api.json'
import layouts from '../../fixtures/search-ets-layouts.json'
import sameName from '../../fixtures/search-same-name.json'

const SPLIT = ' › '
const byAddress = (ga) => picker.search[0].response.items.find((item) => item.group_address === ga).id
const KITCHEN_SWITCH = byAddress('30/0/1') // Kueche › Licht Decke › Schalten
const KITCHEN_STATUS = byAddress('30/0/2') // Kueche › Licht Decke › Status

beforeEach(() => {
  vi.resetModules()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  try {
    window.localStorage.clear()
  } catch {
    /* jsdom always has it */
  }
})

afterEach(() => {
  vi.doUnmock('@/api/client')
  document.body.innerHTML = ''
})

function paramsKey(params) {
  const full = { page: 0, ...params }
  return JSON.stringify(Object.keys(full).sort().map((key) => [key, String(full[key])]))
}

/** Fake client answering from the recording; unknown searches reject loudly. */
function recordedApi({ deviceData = picker.knx_device_data, failSearch = 0 } = {}) {
  const recorded = new Map(picker.search.map((entry) => [paramsKey(entry.params), entry.response]))
  let failures = failSearch
  const searchApi = {
    search: vi.fn(async (params) => {
      if (failures > 0) {
        failures -= 1
        throw new Error('network down')
      }
      const response = recorded.get(paramsKey(params))
      if (!response) throw new Error(`no recorded search for ${JSON.stringify(params)}`)
      return { data: response }
    }),
    knxDeviceData: vi.fn(async () => ({ data: deviceData })),
  }
  const hierarchyApi = {
    listTrees: vi.fn(async () => ({ data: picker.trees })),
    getTreeNodes: vi.fn(async (treeId) => ({ data: picker.nodes[treeId] ?? [] })),
  }
  const knxprojApi = {
    listDevices: vi.fn(async ({ q = '' } = {}) => {
      const needle = q.toLowerCase()
      const items = picker.devices.items.filter((d) => !needle || `${d.pa} ${d.name}`.toLowerCase().includes(needle))
      return { data: { items, total: items.length } }
    }),
    getDevice: vi.fn(async (pa) => ({ data: picker.devices.items.find((d) => d.pa === pa) })),
  }
  return { searchApi, hierarchyApi, knxprojApi }
}

/** Fake client serving one recorded layout family: one tree, every search answers with its datapoints. */
function layoutApi(items) {
  const [ref] = items.flatMap((item) => item.hierarchy_nodes)
  const tree = { id: ref.tree_id, name: ref.tree_name, description: 'ets_import:groups', display_depth: 0, root_node_id: 'root' }
  return {
    searchApi: {
      search: vi.fn(async ({ size = 50, page = 0 } = {}) => ({
        data: { items: items.slice(page * size, (page + 1) * size), total: items.length, page, size, pages: Math.max(1, Math.ceil(items.length / size)) },
      })),
      knxDeviceData: vi.fn(async () => ({ data: { knx_device_data: false } })),
    },
    hierarchyApi: { listTrees: vi.fn(async () => ({ data: [tree] })), getTreeNodes: vi.fn(async () => ({ data: [] })) },
    knxprojApi: { listDevices: vi.fn(async () => ({ data: { items: [] } })), getDevice: vi.fn() },
  }
}

async function mountPicker(props = {}, api = recordedApi()) {
  vi.doMock('@/api/client', () => api)
  const { default: DpPicker } = await import('@/components/ui/DpPicker.vue')
  const wrapper = mount(DpPicker, {
    props: { debounceMs: 0, pageSize: 500, ...props },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  return { wrapper, api }
}

async function openPicker(wrapper) {
  await wrapper.get('[data-testid="dp-picker-trigger"]').trigger('click')
  await flushPromises()
  await flushPromises()
}

const optionTexts = (wrapper) =>
  wrapper.findAll('[role="option"]').map((li) => li.findAll('[data-testid="dp-path-line"]').map((l) => l.text()).join(' | '))

const optionGas = (wrapper) =>
  wrapper.findAll('[role="option"]').map((li) => li.find('[data-testid="dp-path-ga"]').exists() ? li.get('[data-testid="dp-path-ga"]').text() : null)

const optionRowText = (option) => option.get('[data-testid="dp-path-row"]').text()

async function chooseTree(wrapper, treeId) {
  await wrapper.get('[data-testid="dp-picker-tree"]').setValue(treeId)
  await flushPromises()
}

async function pickFromCombobox(wrapper, testid, text) {
  const box = wrapper.get(`[data-testid="${testid}"]`)
  await box.get('[data-testid="combobox-input"]').trigger('focus')
  await flushPromises()
  const item = box.findAll('[data-testid^="combobox-item-"]').find((li) => li.text().includes(text))
  expect(item, `${testid}: ${text}`).toBeTruthy()
  await item.trigger('click')
  await flushPromises()
  await flushPromises()
}

describe('DpPicker – hierarchy lens', () => {
  it('lists the chosen tree and tells the generic names apart by room and function, without an address', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)

    expect(api.searchApi.search).toHaveBeenLastCalledWith({ tree_id: 'tree-buildings', size: 500, page: 0 })
    const texts = optionTexts(wrapper)
    expect(texts).toHaveLength(5)
    expect(new Set(texts).size).toBe(5)
    expect(texts).toContain(['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Schalten'].join(SPLIT))
    expect(texts).toContain(['Demo-Test-Projekt', 'EG', 'Bad', 'Licht Decke', 'Schalten'].join(SPLIT))
    expect(optionGas(wrapper)).toEqual([null, null, null, null, null])
  })

  it('shows the group address only where the group tree reads the same (generic names in one range)', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')

    const texts = optionTexts(wrapper)
    expect(texts.filter((t) => t === ['Neue Hauptgruppe', 'Neue Mittelgruppe', 'Schalten'].join(SPLIT))).toHaveLength(4)
    const gas = optionGas(wrapper)
    expect(gas.every(Boolean)).toBe(true)
    const full = wrapper.findAll('[role="option"]').map(optionRowText)
    expect(new Set(full).size).toBe(6)
    expect(window.localStorage.getItem('obs.dpPicker.treeId')).toBe('tree-groups')
  })

  it('narrows to a node of the tree through the monitor hierarchy filter', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)
    await pickFromCombobox(wrapper, 'dp-picker-nodes', 'Kueche›Licht Decke')

    expect(api.searchApi.search).toHaveBeenLastCalledWith({ node_id: 'node-7', size: 500, page: 0 })
    expect(optionTexts(wrapper)).toEqual([
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Schalten'].join(SPLIT),
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Status'].join(SPLIT),
    ])
  })

  it('emits the datapoint id and shows the picked line in the field', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    const option = wrapper.findAll('[role="option"]')[1]
    const text = optionRowText(option)
    await option.trigger('click')
    await flushPromises()

    const [id] = wrapper.emitted('update:modelValue').at(-1)
    const [selected] = wrapper.emitted('select').at(-1)
    expect(selected.id).toBe(id)
    expect(picker.search[0].response.items.map((item) => item.id)).toContain(id)
    expect(selected.text).toContain(selected.row.groupAddress)
    expect(wrapper.find('[data-testid="dp-picker-panel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toBe(text)
  })

  it('pages through large results with "load more"', async () => {
    const { wrapper } = await mountPicker({ pageSize: 4 })
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(4)
    expect(wrapper.get('[data-testid="dp-picker-count"]').text()).toBe('4 von 6')

    await wrapper.get('[data-testid="dp-picker-more"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(6)
    expect(wrapper.find('[data-testid="dp-picker-more"]').exists()).toBe(false)
    expect(new Set(wrapper.findAll('[role="option"]').map(optionRowText)).size).toBe(6)
  })

  it('filters by text through the search field', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    await wrapper.get('[data-testid="dp-picker-search"]').setValue('status')
    await flushPromises()
    expect(api.searchApi.search).toHaveBeenLastCalledWith({ q: 'status', tree_id: 'tree-groups', size: 500, page: 0 })
    expect(optionTexts(wrapper)).toEqual([
      ['Neue Hauptgruppe', 'Neue Mittelgruppe', 'Status'].join(SPLIT),
      ['Neue Hauptgruppe', 'Neue Mittelgruppe', 'Status'].join(SPLIT),
    ])
  })
})

describe('DpPicker – function lens', () => {
  it('lists the ETS functions of the building tree and shows the datapoints of the chosen one', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)
    await wrapper.get('[data-testid="dp-picker-lens-functions"]').trigger('click')
    await flushPromises()
    expect(api.searchApi.search).toHaveBeenCalledWith({ tree_id: 'tree-buildings', size: 500, page: 0 })
    expect(wrapper.get('[data-testid="dp-picker-prompt"]').text()).toBe('Eine Funktion wählen, um ihre Datenpunkte zu sehen.')

    const box = wrapper.get('[data-testid="dp-picker-functions"]')
    await box.get('[data-testid="combobox-input"]').trigger('focus')
    await flushPromises()
    expect(box.findAll('[data-testid^="combobox-item-"]').map((li) => li.text())).toEqual([
      expect.stringContaining('Bad›Licht Decke1 Datenpunkte'),
      expect.stringContaining('Kueche›Licht Decke2 Datenpunkte'),
      expect.stringContaining('Kueche›Licht Insel2 Datenpunkte'),
    ])

    await pickFromCombobox(wrapper, 'dp-picker-functions', 'Kueche›Licht Decke')
    expect(api.searchApi.search).toHaveBeenLastCalledWith({ node_id: 'node-7', size: 500, page: 0 })
    expect(optionTexts(wrapper)).toEqual([
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Schalten'].join(SPLIT),
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Status'].join(SPLIT),
    ])
    await wrapper.findAll('[role="option"]')[1].trigger('click')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([KITCHEN_STATUS])
  })

  it('takes the lines from the function\'s tree even while another tree is chosen for the other lenses', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    await wrapper.get('[data-testid="dp-picker-lens-functions"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="dp-picker-tree"]').exists()).toBe(false)
    await pickFromCombobox(wrapper, 'dp-picker-functions', 'Kueche›Licht Decke')
    expect(optionTexts(wrapper)).toEqual([
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Schalten'].join(SPLIT),
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Status'].join(SPLIT),
    ])
    expect(optionGas(wrapper)).toEqual([null, null])
  })

  it('explains where functions come from when no function tree exists', async () => {
    const api = recordedApi()
    api.hierarchyApi.listTrees = vi.fn(async () => ({ data: picker.trees.filter((tree) => tree.id === 'tree-groups') }))
    const { wrapper } = await mountPicker({}, api)
    await openPicker(wrapper)
    await wrapper.get('[data-testid="dp-picker-lens-functions"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-no-functions"]').text()).toContain('Gebäude')
    expect(wrapper.find('[data-testid="dp-picker-prompt"]').exists()).toBe(false)
  })

  it('reports a failed function load and retries', async () => {
    const api = recordedApi()
    const { wrapper } = await mountPicker({}, api)
    await openPicker(wrapper)
    api.searchApi.search.mockRejectedValueOnce(new Error('down'))
    await wrapper.get('[data-testid="dp-picker-lens-functions"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-functions-error"]').attributes('role')).toBe('alert')
    await wrapper.get('[data-testid="dp-picker-functions-error"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="dp-picker-functions"]').exists()).toBe(true)
  })
})

describe('DpPicker – device lens and link filter', () => {
  it('shows the datapoints of the chosen devices', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)
    await wrapper.get('[data-testid="dp-picker-lens-devices"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-prompt"]').text()).toBe('Ein Gerät wählen, um seine Datenpunkte zu sehen.')

    await pickFromCombobox(wrapper, 'dp-picker-devices', '1.1.21')
    expect(api.searchApi.search).toHaveBeenLastCalledWith({ device: '1.1.21', size: 500, page: 0 })
    expect(optionTexts(wrapper)).toEqual([
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Schalten'].join(SPLIT),
      ['Demo-Test-Projekt', 'EG', 'Kueche', 'Licht Decke', 'Status'].join(SPLIT),
    ])
    expect(wrapper.get('[data-testid="dp-picker-devices"]').text()).toContain('1.1.21 Testgeraet 21')

    await pickFromCombobox(wrapper, 'dp-picker-devices', '1.1.22')
    expect(api.searchApi.search).toHaveBeenLastCalledWith({ device: '1.1.21,1.1.22', size: 500, page: 0 })
    expect(wrapper.findAll('[role="option"]')).toHaveLength(4)
  })

  it('says so when a device has no datapoints', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    await wrapper.get('[data-testid="dp-picker-lens-devices"]').trigger('click')
    await pickFromCombobox(wrapper, 'dp-picker-devices', '1.1.23')
    expect(wrapper.get('[data-testid="dp-picker-empty"]').text()).toBe('Keine passenden Datenpunkte.')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })

  it('hides datapoints without a device link when the switch is on', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    const toggle = wrapper.get('[data-testid="dp-picker-linked"]')
    expect(toggle.attributes('disabled')).toBeUndefined()
    await toggle.setValue(true)
    await flushPromises()
    expect(api.searchApi.search).toHaveBeenLastCalledWith({ knx_linked: true, tree_id: 'tree-groups', size: 500, page: 0 })
    expect(wrapper.findAll('[role="option"]')).toHaveLength(4)
    expect(optionGas(wrapper).every(Boolean)).toBe(true)
  })

  it('switches the link filter off with an explanation when the project links no device (K7)', async () => {
    const { wrapper, api } = await mountPicker({}, recordedApi({ deviceData: { knx_device_data: false } }))
    await openPicker(wrapper)
    const toggle = wrapper.get('[data-testid="dp-picker-linked"]')
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.element.checked).toBe(false)
    const hint = wrapper.get(`#${toggle.attributes('aria-describedby')}`)
    expect(hint.text()).toContain('verknüpft keine Gruppenadresse mit einem Gerät')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(5)
    for (const [params] of api.searchApi.search.mock.calls) expect(params).not.toHaveProperty('knx_linked')
  })
})

describe('DpPicker – states', () => {
  it('shows an error with a retry when the search fails', async () => {
    const { wrapper } = await mountPicker({}, recordedApi({ failSearch: 1 }))
    await openPicker(wrapper)
    expect(wrapper.get('[data-testid="dp-picker-error"]').attributes('role')).toBe('alert')
    expect(wrapper.find('[role="option"]').exists()).toBe(false)
    await wrapper.get('[data-testid="dp-picker-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="dp-picker-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="option"]')).toHaveLength(5)
  })

  it('shows a loading state until the first page arrives', async () => {
    const api = recordedApi()
    let release
    const original = api.searchApi.search.getMockImplementation()
    api.searchApi.search.mockImplementationOnce((params) => new Promise((resolve) => (release = () => resolve(original(params)))))
    const { wrapper } = await mountPicker({}, api)
    await wrapper.get('[data-testid="dp-picker-trigger"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-loading"]').text()).toBe('Laden …')
    release()
    await flushPromises()
    expect(wrapper.find('[data-testid="dp-picker-loading"]').exists()).toBe(false)
  })

  it('works without any hierarchy: names only, with a hint', async () => {
    const api = layoutApi(sameName)
    api.hierarchyApi.listTrees = vi.fn(async () => ({ data: [] }))
    const { wrapper } = await mountPicker({}, api)
    await openPicker(wrapper)
    expect(wrapper.get('[data-testid="dp-picker-no-trees"]').exists()).toBe(true)
    expect(api.searchApi.search).toHaveBeenLastCalledWith({ size: 500, page: 0 })
    expect(optionTexts(wrapper)).toEqual(['Spots P8', 'Spots P8', 'Spots P8'])
    expect(optionGas(wrapper)).toEqual(['1/1/96', '1/1/97', '1/4/128'])
  })
})

describe('DpPicker – keyboard and ARIA', () => {
  it('opens from the keyboard, moves through the options and picks with Enter', async () => {
    const { wrapper } = await mountPicker()
    const trigger = wrapper.get('[data-testid="dp-picker-trigger"]')
    expect(trigger.attributes('aria-haspopup')).toBe('dialog')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')

    const search = wrapper.get('[data-testid="dp-picker-search"]')
    expect(document.activeElement).toBe(search.element)
    const list = wrapper.get('[role="listbox"]')
    expect(search.attributes('aria-controls')).toBe(list.attributes('id'))
    expect(search.attributes('aria-activedescendant')).toBe(wrapper.findAll('[role="option"]')[0].attributes('id'))

    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'ArrowUp' })
    const second = wrapper.findAll('[role="option"]')[1]
    expect(search.attributes('aria-activedescendant')).toBe(second.attributes('id'))
    await search.trigger('keydown', { key: 'End' })
    expect(search.attributes('aria-activedescendant')).toBe(wrapper.findAll('[role="option"]')[4].attributes('id'))
    await search.trigger('keydown', { key: 'Home' })
    await search.trigger('keydown', { key: 'ArrowDown' })
    const text = optionRowText(second)
    await search.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    expect(document.activeElement).toBe(trigger.element)
    expect(trigger.text()).toBe(text)
  })

  it('marks the chosen datapoint as the selected option', async () => {
    const { wrapper } = await mountPicker({ modelValue: KITCHEN_SWITCH })
    await openPicker(wrapper)
    const selected = wrapper.findAll('[role="option"]').filter((li) => li.attributes('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(optionRowText(selected[0])).toBe(wrapper.get('[data-testid="dp-picker-trigger"]').text())
  })

  it('switches lenses with the arrow keys and closes with Escape', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.attributes('aria-selected'))).toEqual(['true', 'false', 'false'])
    await tabs[0].trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[2].attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(wrapper.findAll('[role="tab"]')[2].element)
    await wrapper.findAll('[role="tab"]')[2].trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')

    await wrapper.get('[data-testid="dp-picker-search"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-testid="dp-picker-panel"]').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('DpPicker – a stored choice', () => {
  it('shows the line of a preset datapoint among its namesakes, as the list would', async () => {
    window.localStorage.setItem('obs.dpPicker.treeId', 'tree-groups')
    const { wrapper, api } = await mountPicker({ modelValue: KITCHEN_SWITCH })
    expect(api.searchApi.search).toHaveBeenCalledWith({ q: KITCHEN_SWITCH, size: 1 })
    expect(api.searchApi.search).toHaveBeenCalledWith({ q: 'Schalten', size: 500, page: 0 })
    const hydrated = wrapper.get('[data-testid="dp-picker-trigger"]').text()

    await openPicker(wrapper)
    const option = wrapper.findAll('[role="option"]').find((li) => li.attributes('aria-selected') === 'true')
    expect(optionRowText(option)).toBe(hydrated)
    expect(hydrated).toContain('30/0/1')
  })

  it('clears the field when the value is cleared from outside', async () => {
    const { wrapper } = await mountPicker({ modelValue: KITCHEN_SWITCH })
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toContain('Kueche')
    await wrapper.setProps({ modelValue: '' })
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toBe('Datenpunkt wählen …')
  })
})

describe('DpPicker – group addresses in the project style', () => {
  it.each([
    ['ThreeLevel', ['30/0/1', '30/0/2']],
    ['TwoLevel', ['30/1', '30/2']],
    ['Free', ['61441', '61442']],
  ])('%s', async (style, expected) => {
    const { useKnxProjectStore } = await import('@/stores/knxProject')
    useKnxProjectStore().groupAddressStyle = style
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    const gas = optionGas(wrapper)
    for (const ga of expected) expect(gas).toContain(ga)
    expect(gas.filter((ga) => ga.startsWith('30/0/'))).toHaveLength(style === 'ThreeLevel' ? 6 : 0)
  })
})

describe('DpPicker – layout families from the ETS import', () => {
  const families = [...Object.entries(layouts), ['K4 same name', sameName]]

  it.each(families)('%s: every line in the lens is unique and names the datapoint once', async (_family, items) => {
    const { wrapper } = await mountPicker({}, layoutApi(items))
    await openPicker(wrapper)
    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(items.length)
    const full = options.map(optionRowText)
    expect(new Set(full).size).toBe(items.length)
    options.forEach((option, i) => {
      for (const line of option.findAll('[data-testid="dp-path-line"]')) {
        const segments = line.text().split(SPLIT)
        expect(segments.filter((segment) => segment === items[i].name)).toHaveLength(1)
        expect(segments.at(-1)).toBe(items[i].name)
      }
    })
  })

  it('K5: the switch address picks the main path and the tooltip names both', async () => {
    const items = layouts['K5 groups']
    const { wrapper } = await mountPicker({}, layoutApi(items))
    await openPicker(wrapper)
    const twoPaths = items.findIndex((item) => item.hierarchy_nodes.length === 2)
    expect(twoPaths).toBeGreaterThanOrEqual(0)
    const row = wrapper.findAll('[role="option"]')[twoPaths].get('[data-testid="dp-path-row"]')
    expect(row.findAll('[data-testid="dp-path-line"]')).toHaveLength(1)
    const tooltip = row.attributes('title').split('\n')
    expect(tooltip.filter((line) => line.endsWith(items[twoPaths].name))).toHaveLength(2)
    expect(tooltip.at(-1)).toMatch(/^Gruppenadresse /)
  })

  it('K5 linked before #1266: no switch link, so all paths with a hint, the field shows the same', async () => {
    const items = layouts['K5 groups'].map((item) => ({
      ...item,
      hierarchy_nodes: item.hierarchy_nodes.map((ref) => ({ ...ref, group_address: null })),
    }))
    const { wrapper } = await mountPicker({}, layoutApi(items))
    await openPicker(wrapper)
    const index = items.findIndex((item) => item.hierarchy_nodes.length === 2)
    const option = wrapper.findAll('[role="option"]')[index]
    expect(option.findAll('[data-testid="dp-path-line"]')).toHaveLength(2)
    expect(option.get('[data-testid="dp-path-several"]').text()).toBe('mehrere Pfade')
    const text = optionRowText(option)
    await option.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toBe(text)
    expect(wrapper.emitted('select').at(-1)[0].text).toContain(' | ')
  })
})

describe('DpPicker – robustness', () => {
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('follows the pointer over the options', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    const third = wrapper.findAll('[role="option"]')[2]
    await third.trigger('mouseenter')
    expect(wrapper.get('[data-testid="dp-picker-search"]').attributes('aria-activedescendant')).toBe(third.attributes('id'))
  })

  it('works when the browser storage is blocked', async () => {
    const { wrapper } = await mountPicker()
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      await openPicker(wrapper)
      expect(wrapper.get('[data-testid="dp-picker-tree"]').element.value).toBe('tree-buildings')
      await chooseTree(wrapper, 'tree-groups')
      expect(wrapper.findAll('[role="option"]')).toHaveLength(6)
    } finally {
      blocked.mockRestore()
    }
  })

  it('falls back to names when the trees cannot be loaded, and to an off link filter when the device data cannot', async () => {
    const api = layoutApi(sameName)
    api.hierarchyApi.listTrees = vi.fn(async () => {
      throw new Error('down')
    })
    api.searchApi.knxDeviceData = vi.fn(async () => {
      throw new Error('down')
    })
    const { wrapper } = await mountPicker({}, api)
    await openPicker(wrapper)
    expect(wrapper.find('[data-testid="dp-picker-no-trees"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="dp-picker-linked"]').attributes('disabled')).toBeDefined()
    expect(optionTexts(wrapper)).toEqual(['Spots P8', 'Spots P8', 'Spots P8'])
  })

  it('loads device data and functions once across reopening', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    await wrapper.get('[data-testid="dp-picker-lens-functions"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="dp-picker-lens-hierarchy"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="dp-picker-lens-functions"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="dp-picker-search"]').trigger('keydown', { key: 'Escape' })
    await openPicker(wrapper)
    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')
    expect(api.searchApi.knxDeviceData).toHaveBeenCalledTimes(1)
    const functionLoads = api.searchApi.search.mock.calls.filter(([params]) => params.tree_id === 'tree-buildings')
    // the first page of the hierarchy lens before the tree switch, then one function load
    expect(functionLoads).toHaveLength(2)
  })

  it('collects the functions over several pages and filters them by text', async () => {
    const api = recordedApi()
    const all = picker.search.find((entry) => entry.params.tree_id === 'tree-buildings').response
    const recorded = api.searchApi.search.getMockImplementation()
    api.searchApi.search.mockImplementation(async (params) => {
      if (params.tree_id !== 'tree-buildings') return recorded(params)
      const items = params.page === 0 ? all.items.slice(0, 3) : all.items.slice(3)
      return { data: { ...all, items, pages: 2, page: params.page } }
    })
    const { wrapper } = await mountPicker({}, api)
    await openPicker(wrapper)
    await wrapper.get('[data-testid="dp-picker-lens-functions"]').trigger('click')
    await flushPromises()
    const box = wrapper.get('[data-testid="dp-picker-functions"]')
    await box.get('[data-testid="combobox-input"]').setValue('insel')
    await flushPromises()
    const items = box.findAll('[data-testid^="combobox-item-"]').map((li) => li.text())
    expect(items).toEqual([expect.stringContaining('Kueche›Licht Insel2 Datenpunkte')])
  })

  it('shows only the answer to the latest request', async () => {
    const api = recordedApi()
    const recorded = api.searchApi.search.getMockImplementation()
    const { wrapper } = await mountPicker({}, api)
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    const search = wrapper.get('[data-testid="dp-picker-search"]')

    for (const late of ['answer', 'failure']) {
      const slow = deferred()
      api.searchApi.search.mockImplementationOnce(() => slow.promise)
      await search.setValue('sch')
      await search.setValue('status')
      await flushPromises()
      expect(optionTexts(wrapper)).toHaveLength(2)
      if (late === 'answer') slow.resolve(await recorded({ tree_id: 'tree-buildings', size: 500 }))
      else slow.reject(new Error('late'))
      await flushPromises()
      expect(optionTexts(wrapper)).toHaveLength(2)
      expect(wrapper.find('[data-testid="dp-picker-error"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="dp-picker-more"]').exists()).toBe(false)
    }
  })

  it('keeps the loaded lines when loading more fails and reloads on retry', async () => {
    const api = recordedApi()
    const { wrapper } = await mountPicker({ pageSize: 4 }, api)
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    api.searchApi.search.mockRejectedValueOnce(new Error('down'))
    await wrapper.get('[data-testid="dp-picker-more"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-error"]').exists()).toBe(true)
    expect(wrapper.vm.$.setupState.items).toHaveLength(4)
    await wrapper.get('[data-testid="dp-picker-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(4)
    expect(wrapper.find('[data-testid="dp-picker-error"]').exists()).toBe(false)
  })

  it('waits for a pause in typing before it searches', async () => {
    const { wrapper, api } = await mountPicker({ debounceMs: 250 })
    await openPicker(wrapper)
    await chooseTree(wrapper, 'tree-groups')
    const calls = api.searchApi.search.mock.calls.length
    vi.useFakeTimers()
    try {
      const search = wrapper.get('[data-testid="dp-picker-search"]')
      await search.setValue('sta')
      await search.setValue('status')
      expect(api.searchApi.search.mock.calls.length).toBe(calls)
      vi.advanceTimersByTime(250)
    } finally {
      vi.useRealTimers()
    }
    await flushPromises()
    expect(api.searchApi.search.mock.calls.length).toBe(calls + 1)
    expect(api.searchApi.search).toHaveBeenLastCalledWith({ q: 'status', tree_id: 'tree-groups', size: 500, page: 0 })
  })

  it('ignores arrow keys and Enter while the list is empty', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    await wrapper.get('[data-testid="dp-picker-lens-devices"]').trigger('click')
    await flushPromises()
    const search = wrapper.get('[data-testid="dp-picker-search"]')
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(search.attributes('aria-activedescendant')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('[data-testid="dp-picker-panel"]').exists()).toBe(true)
  })

  it('closes through the dialog close button without choosing', async () => {
    const { wrapper } = await mountPicker()
    await openPicker(wrapper)
    await wrapper.get('.card-header button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="dp-picker-panel"]').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('DpPicker – stored choice, edge cases', () => {
  it('does not search again for the datapoint it just emitted', async () => {
    const { wrapper, api } = await mountPicker()
    await openPicker(wrapper)
    await wrapper.findAll('[role="option"]')[0].trigger('click')
    const [id] = wrapper.emitted('update:modelValue').at(-1)
    const text = wrapper.get('[data-testid="dp-picker-trigger"]').text()
    await wrapper.setProps({ modelValue: id })
    await flushPromises()
    expect(api.searchApi.search).not.toHaveBeenCalledWith({ q: id, size: 1 })
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toBe(text)
  })

  it('keeps the placeholder for an unknown id or a failed lookup', async () => {
    const api = recordedApi()
    api.searchApi.search.mockResolvedValueOnce({ data: { items: [], total: 0, page: 0, size: 1, pages: 1 } })
    const { wrapper } = await mountPicker({ modelValue: 'gone' }, api)
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toBe('Datenpunkt wählen …')

    api.searchApi.search.mockRejectedValueOnce(new Error('down'))
    await wrapper.setProps({ modelValue: KITCHEN_SWITCH })
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toBe('Datenpunkt wählen …')
  })

  it('shows the line without namesakes when their search fails, names only without trees', async () => {
    const api = recordedApi()
    api.hierarchyApi.listTrees = vi.fn(async () => ({ data: [] }))
    const recorded = api.searchApi.search.getMockImplementation()
    api.searchApi.search.mockImplementation(async (params) => {
      if (params.q === 'Schalten') throw new Error('down')
      return recorded(params)
    })
    const { wrapper } = await mountPicker({ modelValue: KITCHEN_SWITCH }, api)
    expect(wrapper.get('[data-testid="dp-path-row"]').text()).toBe('SchaltenBOOLEAN')
    expect(wrapper.find('[data-testid="dp-path-ga"]').exists()).toBe(false)
  })

  it('drops the answer for a value that was replaced meanwhile', async () => {
    const api = recordedApi()
    const recorded = api.searchApi.search.getMockImplementation()
    let releaseFirst
    api.searchApi.search.mockImplementation(async (params) => {
      if (params.q === 'Schalten' && !releaseFirst) {
        await new Promise((resolve) => (releaseFirst = resolve))
      }
      return recorded(params)
    })
    const { wrapper } = await mountPicker({ modelValue: KITCHEN_SWITCH }, api)
    await wrapper.setProps({ modelValue: '' })
    await flushPromises()
    releaseFirst()
    await flushPromises()
    expect(wrapper.get('[data-testid="dp-picker-trigger"]').text()).toBe('Datenpunkt wählen …')
  })
})
