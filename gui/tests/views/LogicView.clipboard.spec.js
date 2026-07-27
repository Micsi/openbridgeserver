/**
 * Tests for copy/paste of selected logic-editor nodes (#1084).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

beforeEach(() => {
  vi.resetModules()
  const storage = {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  vi.doMock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
  vi.doMock('@vue-flow/core', () => ({
    VueFlow: { name: 'VueFlow', props: ['snapToGrid', 'snapGrid'], template: '<div data-testid="vue-flow"><slot /></div>' },
    Handle: { template: '<span />' },
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    useVueFlow: () => ({ project: (point) => point }),
    addEdge: (edge, edges) => [...edges, edge],
  }))
  vi.doMock('@vue-flow/background', () => ({ Background: { name: 'Background', props: ['gap', 'offset'], template: '<div />' } }))
  vi.doMock('@vue-flow/controls', () => ({ Controls: { template: '<div />' } }))
  vi.doMock('@vue-flow/minimap', () => ({ MiniMap: { template: '<div />' } }))
})

const mountedWrappers = []

afterEach(() => {
  // LogicView registers a window-level keydown listener in onMounted; without
  // unmounting, it leaks across tests and every leftover instance also reacts
  // to keydown events dispatched by later tests in this file.
  while (mountedWrappers.length) mountedWrappers.pop().unmount()
  vi.doUnmock('@/api/client')
  vi.doUnmock('vue-router')
  vi.doUnmock('@vue-flow/core')
  vi.doUnmock('@vue-flow/background')
  vi.doUnmock('@vue-flow/controls')
  vi.doUnmock('@vue-flow/minimap')
})

function makeGraph(id = 'graph-1', overrides = {}) {
  return {
    id,
    name: 'Main Graph',
    description: '',
    enabled: true,
    flow_data: {
      nodes: [
        { id: 'n1', type: 'and', position: { x: 0, y: 0 }, data: { input_count: 2 } },
        { id: 'n2', type: 'and', position: { x: 100, y: 0 }, data: { input_count: 2 } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'in1' },
      ],
    },
    ...overrides,
  }
}

async function mountLogicView({ isAdmin = true, graph = makeGraph() } = {}) {
  const logicApi = {
    nodeTypes: vi.fn().mockResolvedValue({ data: [{ type: 'and', config_schema: {} }] }),
    listGraphs: vi.fn().mockResolvedValue({ data: [graph] }),
    getGraph: vi.fn().mockResolvedValue({ data: graph }),
    saveGraph: vi.fn().mockResolvedValue({ data: graph }),
  }
  vi.doMock('@/api/client', () => ({ logicApi }))

  const pinia = createPinia()
  setActivePinia(pinia)
  const { useAuthStore } = await import('@/stores/auth')
  useAuthStore().user = { id: 'u1', username: isAdmin ? 'admin' : 'viewer', is_admin: isAdmin }

  const mod = await import('@/views/LogicView.vue')
  const wrapper = mount(mod.default, {
    global: {
      plugins: [pinia],
      stubs: {
        NodePalette: true,
        NodeConfigPanel: true,
        Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        ConfirmDialog: true,
        Spinner: { template: '<span />' },
      },
    },
    attachTo: document.body,
  })
  await flushPromises()
  wrapper.vm.activeGraphId = graph.id
  await wrapper.vm.loadGraph()
  mountedWrappers.push(wrapper)
  return { wrapper, logicApi }
}

describe('LogicView node copy/paste', () => {
  it('copySelection does nothing and reports empty when no node is selected', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.copySelection()
    expect(wrapper.vm.clipboard).toBeNull()
    expect(wrapper.vm.statusMsg.ok).toBe(false)
  })

  it('copies the selected node(s) and their internal edge into the clipboard', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => ({ ...n, selected: true }))

    wrapper.vm.copySelection()

    expect(wrapper.vm.clipboard.nodes).toHaveLength(2)
    expect(wrapper.vm.clipboard.edges).toHaveLength(1)
    expect(wrapper.vm.statusMsg.ok).toBe(true)
  })

  it('pasteClipboard is a no-op without a clipboard', async () => {
    const { wrapper } = await mountLogicView()
    const before = wrapper.vm.nodes.length
    wrapper.vm.pasteClipboard()
    expect(wrapper.vm.nodes).toHaveLength(before)
  })

  it('pastes new nodes with fresh ids and preserves settings/data', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()

    wrapper.vm.pasteClipboard()

    expect(wrapper.vm.nodes).toHaveLength(3)
    const pasted = wrapper.vm.nodes.at(-1)
    expect(pasted.id).not.toBe('n1')
    expect(pasted.data).toEqual({ input_count: 2 })
  })

  it('selects only the pasted nodes so they can be dragged as a group right away', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()

    wrapper.vm.pasteClipboard()

    const source = wrapper.vm.nodes.find(n => n.id === 'n1')
    const pasted = wrapper.vm.nodes.at(-1)
    expect(source.selected).toBe(false)
    expect(pasted.selected).toBe(true)
  })

  it('offsets repeated pastes of the same clipboard so blocks do not stack', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()

    wrapper.vm.pasteClipboard()
    wrapper.vm.pasteClipboard()

    const [first, second] = wrapper.vm.nodes.slice(-2)
    expect(second.position.x).toBeGreaterThan(first.position.x)
  })

  it('survives switching to a different logic page — clipboard is not tied to the loaded graph', async () => {
    const otherGraph = makeGraph('graph-2', { name: 'Other Graph', flow_data: { nodes: [], edges: [] } })
    const { wrapper, logicApi } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()

    logicApi.getGraph.mockResolvedValueOnce({ data: otherGraph })
    wrapper.vm.activeGraphId = 'graph-2'
    await wrapper.vm.loadGraph()
    expect(wrapper.vm.nodes).toHaveLength(0)

    wrapper.vm.pasteClipboard()
    expect(wrapper.vm.nodes).toHaveLength(1)
  })

  it('does not expose copy/paste actions for non-admin users', async () => {
    const { wrapper } = await mountLogicView({ isAdmin: false })
    expect(wrapper.find('[data-testid="btn-copy-nodes"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-paste-nodes"]').exists()).toBe(false)
  })

  it('Ctrl+C / Ctrl+V keyboard shortcuts copy and paste the selection', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))
    expect(wrapper.vm.clipboard).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))
    expect(wrapper.vm.nodes).toHaveLength(3)
  })

  it('ignores Ctrl+C / Ctrl+V while a text input is focused', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))
    expect(wrapper.vm.clipboard).toBeNull()

    document.body.removeChild(input)
  })

  it('Ctrl+V still works right after focusing the graph-select dropdown', async () => {
    // Regression: SELECT must not count as an "editable" target — the
    // graph-select dropdown is the documented way to switch sheets before
    // pasting, and it retains focus after the change event fires.
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()

    const select = wrapper.find('[data-testid="select-graph"]').element
    select.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))
    expect(wrapper.vm.nodes).toHaveLength(3)
  })

  it('clears the config-panel selection after paste so it cannot silently edit the wrong node', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()
    wrapper.vm.selectedNode = { id: 'n1', type: 'and', data: {} }

    wrapper.vm.pasteClipboard()

    expect(wrapper.vm.selectedNode).toBeNull()
  })

  it('ignores Ctrl+C / Ctrl+V while a modal is open', async () => {
    const { wrapper } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()
    wrapper.vm.showNewGraph = true

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))

    expect(wrapper.vm.nodes).toHaveLength(2)
  })

  it('does not paste while the target sheet is still loading', async () => {
    const { wrapper, logicApi } = await mountLogicView()
    wrapper.vm.nodes = wrapper.vm.nodes.map(n => n.id === 'n1' ? { ...n, selected: true } : n)
    wrapper.vm.copySelection()

    let resolveGetGraph
    logicApi.getGraph.mockReturnValueOnce(new Promise(resolve => { resolveGetGraph = resolve }))
    wrapper.vm.activeGraphId = 'graph-1'
    const loadPromise = wrapper.vm.loadGraph()

    wrapper.vm.pasteClipboard()
    expect(wrapper.vm.graphLoading).toBe(true)

    resolveGetGraph({ data: { flow_data: { nodes: [], edges: [] } } })
    await loadPromise

    // The still-in-flight load must not have been clobbered by a paste that
    // ran while it was pending, and pasting is possible again once it settles.
    expect(wrapper.vm.nodes).toHaveLength(0)
    wrapper.vm.pasteClipboard()
    expect(wrapper.vm.nodes).toHaveLength(1)
  })
})
