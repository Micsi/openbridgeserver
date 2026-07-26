const PASTE_OFFSET_STEP = 40

function stripDebugFields(data) {
  // eslint-disable-next-line no-unused-vars
  const { _dbg, _dbg_title, ...rest } = data ?? {}
  return rest
}

/**
 * Build a clipboard payload from the currently selected Vue Flow nodes.
 * Only edges whose source and target are both part of the selection are kept.
 * Returns null when nothing is selected.
 */
export function cloneSelectionForClipboard(nodes, edges) {
  const selected = (nodes ?? []).filter(n => n.selected)
  if (selected.length === 0) return null

  const selectedIds = new Set(selected.map(n => n.id))
  const clonedNodes = selected.map(n => ({
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: stripDebugFields(JSON.parse(JSON.stringify(n.data ?? {}))),
  }))
  const clonedEdges = (edges ?? [])
    .filter(e => selectedIds.has(e.source) && selectedIds.has(e.target))
    .map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }))

  return { nodes: clonedNodes, edges: clonedEdges }
}

/**
 * Produce a pastable copy of a clipboard payload: fresh ids for every node/edge,
 * edges rewired through the id map, node positions offset so repeated pastes of
 * the same clipboard don't stack exactly on top of each other, and the pasted
 * nodes marked `selected` so they can be dragged as a group right away.
 */
export function remapClipboardForPaste(clipboard, pasteIndex = 0) {
  if (!clipboard) return null

  const idMap = new Map(clipboard.nodes.map(n => [n.id, crypto.randomUUID()]))
  const offset = PASTE_OFFSET_STEP * (pasteIndex + 1)

  const nodes = clipboard.nodes.map(n => ({
    id: idMap.get(n.id),
    type: n.type,
    position: { x: n.position.x + offset, y: n.position.y + offset },
    data: JSON.parse(JSON.stringify(n.data ?? {})),
    selected: true,
  }))
  const edges = clipboard.edges.map(e => ({
    id: crypto.randomUUID(),
    source: idMap.get(e.source),
    target: idMap.get(e.target),
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }))

  return { nodes, edges }
}
