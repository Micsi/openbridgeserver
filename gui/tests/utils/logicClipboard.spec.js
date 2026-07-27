/**
 * Tests for the logic-editor node copy/paste helpers (#1084).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cloneSelectionForClipboard, remapClipboardForPaste } from '@/utils/logicClipboard'

function makeNode(id, overrides = {}) {
  return { id, type: 'and', position: { x: 10, y: 20 }, data: { input_count: 2 }, ...overrides }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('cloneSelectionForClipboard', () => {
  it('returns null when nothing is selected', () => {
    const nodes = [makeNode('n1'), makeNode('n2')]
    expect(cloneSelectionForClipboard(nodes, [])).toBeNull()
  })

  it('clones a single selected node', () => {
    const nodes = [makeNode('n1', { selected: true }), makeNode('n2')]
    const result = cloneSelectionForClipboard(nodes, [])
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({ id: 'n1', type: 'and', position: { x: 10, y: 20 }, data: { input_count: 2 } })
    expect(result.edges).toEqual([])
  })

  it('keeps internal edges and drops edges leaving the selection', () => {
    const nodes = [
      makeNode('n1', { selected: true }),
      makeNode('n2', { selected: true }),
      makeNode('n3'),
    ]
    const edges = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null },
      { id: 'e2', source: 'n2', target: 'n3', sourceHandle: null, targetHandle: null },
    ]
    const result = cloneSelectionForClipboard(nodes, edges)
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toMatchObject({ source: 'n1', target: 'n2' })
  })

  it('strips transient debug fields from node data', () => {
    const nodes = [makeNode('n1', { selected: true, data: { input_count: 2, _dbg: '= 1', _dbg_title: 'value=1' } })]
    const result = cloneSelectionForClipboard(nodes, [])
    expect(result.nodes[0].data).toEqual({ input_count: 2 })
  })

  it('deep-clones node data so mutating the source does not affect the clipboard', () => {
    const source = makeNode('n1', { selected: true, data: { nested: { value: 1 } } })
    const result = cloneSelectionForClipboard([source], [])
    source.data.nested.value = 99
    expect(result.nodes[0].data.nested.value).toBe(1)
  })
})

describe('remapClipboardForPaste', () => {
  it('returns null for an empty clipboard', () => {
    expect(remapClipboardForPaste(null)).toBeNull()
  })

  it('assigns fresh ids to nodes and rewires edges through the id map', () => {
    const clipboard = {
      nodes: [makeNode('n1'), makeNode('n2')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'a', targetHandle: 'b' }],
    }
    const result = remapClipboardForPaste(clipboard, 0)
    const [p1, p2] = result.nodes
    expect(p1.id).not.toBe('n1')
    expect(p2.id).not.toBe('n2')
    expect(result.edges[0].source).toBe(p1.id)
    expect(result.edges[0].target).toBe(p2.id)
    expect(result.edges[0].sourceHandle).toBe('a')
    expect(result.edges[0].targetHandle).toBe('b')
  })

  it('produces different ids on repeated remaps of the same clipboard', () => {
    const clipboard = { nodes: [makeNode('n1')], edges: [] }
    const first  = remapClipboardForPaste(clipboard, 0)
    const second = remapClipboardForPaste(clipboard, 1)
    expect(first.nodes[0].id).not.toBe(second.nodes[0].id)
  })

  it('offsets node positions further apart for later paste indices', () => {
    const clipboard = { nodes: [makeNode('n1', { position: { x: 0, y: 0 } })], edges: [] }
    const first  = remapClipboardForPaste(clipboard, 0)
    const second = remapClipboardForPaste(clipboard, 1)
    expect(second.nodes[0].position.x).toBeGreaterThan(first.nodes[0].position.x)
    expect(second.nodes[0].position.y).toBeGreaterThan(first.nodes[0].position.y)
  })

  it('marks pasted nodes as selected so they can be dragged as a group', () => {
    const clipboard = { nodes: [makeNode('n1'), makeNode('n2')], edges: [] }
    const result = remapClipboardForPaste(clipboard, 0)
    expect(result.nodes.every(n => n.selected === true)).toBe(true)
  })
})

describe('remapClipboardForPaste — id generation outside a secure context', () => {
  // crypto.randomUUID() is unavailable (or throws) when OBS is opened over
  // plain http:// from another machine — a normal LAN deployment. These
  // exercise the crypto.getRandomValues()/Math.random() fallback paths.
  const realGetRandomValues = crypto.getRandomValues.bind(crypto)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to crypto.getRandomValues when randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: realGetRandomValues })
    const clipboard = { nodes: [makeNode('n1'), makeNode('n2')], edges: [] }
    const result = remapClipboardForPaste(clipboard, 0)
    expect(result.nodes[0].id).toMatch(UUID_RE)
    expect(result.nodes[0].id).not.toBe(result.nodes[1].id)
  })

  it('falls back when randomUUID throws instead of being missing', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => { throw new DOMException('not allowed outside a secure context') },
      getRandomValues: realGetRandomValues,
    })
    const clipboard = { nodes: [makeNode('n1')], edges: [] }
    const result = remapClipboardForPaste(clipboard, 0)
    expect(result.nodes[0].id).toMatch(UUID_RE)
  })

  it('falls back to Math.random when crypto is entirely unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    const clipboard = { nodes: [makeNode('n1'), makeNode('n2')], edges: [] }
    const result = remapClipboardForPaste(clipboard, 0)
    expect(result.nodes[0].id).toMatch(UUID_RE)
    expect(result.nodes[0].id).not.toBe(result.nodes[1].id)
  })
})
