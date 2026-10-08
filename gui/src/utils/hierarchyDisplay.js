export function normalizeHierarchyDisplayDepth(displayDepth) {
  const depth = Number(displayDepth)
  if (!Number.isFinite(depth) || depth <= 0) return 0
  return Math.trunc(depth)
}

export function hierarchyDisplayPath({
  treeName,
  path,
  displayDepth,
  treeHasDisplayDepth = false,
  hideShallow = false,
}) {
  const nodePath = Array.isArray(path) ? path : []
  const depth = normalizeHierarchyDisplayDepth(displayDepth)

  if (depth <= 0) {
    return treeName ? [treeName, ...nodePath] : nodePath.slice()
  }

  const startIndex = depth - 1
  if (nodePath.length > startIndex) return nodePath.slice(startIndex)
  if (hideShallow && treeHasDisplayDepth) return []
  return treeName ? [treeName, ...nodePath] : nodePath.slice()
}

export function hierarchyDisplayIndent(path, displayDepth) {
  const depth = normalizeHierarchyDisplayDepth(displayDepth)
  const nodePath = Array.isArray(path) ? path : []
  const firstVisibleNodeLevel = depth > 0 ? depth : 1
  return Math.max(0, nodePath.length - firstVisibleNodeLevel)
}

export function hierarchyDisplayLabel(options) {
  return hierarchyDisplayPath(options).join(' › ')
}

/**
 * `HierarchyCombobox`/`Combobox` (multi mode) emit an array of composite
 * `"<tree_id>:<node_id>"` strings, not the full item objects — split one
 * back into its parts. Returns `null` for a malformed id (no `:`, or an
 * empty tree_id) rather than throwing, so a caller can skip it defensively.
 */
export function parseHierarchyCompositeId(compositeId) {
  const idx = String(compositeId).indexOf(':')
  if (idx <= 0) return null
  return { tree_id: compositeId.slice(0, idx), node_id: compositeId.slice(idx + 1) }
}

// ---------------------------------------------------------------------------
// Datapoint paths for pickers and lenses (#1266, seam S8)
//
// Input is a datapoint as GET /api/v1/search delivers it: `name` plus
// `hierarchy_nodes`, each { node_id, node_name, tree_id, tree_name,
// node_path: [{ node_id, node_name }] (root → parent), display_depth }.
// ---------------------------------------------------------------------------

/** Name comparison used by the formatter: Unicode-compatible, trimmed, inner
 * whitespace collapsed, case-insensitive. */
export function normalizeHierarchyName(name) {
  return String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Node names of one hierarchy link of a datapoint, root → linked node, without
 * the tree name. A last node named like the datapoint (an ETS "groups" tree
 * holds one node per group address, named like it) is dropped, so the name is
 * shown once — this repairs stored trees without a re-import.
 */
export function datapointRefPath(ref, datapointName) {
  if (!ref) return []
  const path = [...(ref.node_path ?? []).map(seg => seg.node_name), ref.node_name]
  if (path.length && normalizeHierarchyName(path[path.length - 1]) === normalizeHierarchyName(datapointName)) {
    path.pop()
  }
  return path
}
