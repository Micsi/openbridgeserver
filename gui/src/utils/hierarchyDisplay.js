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

function comparePaths(a, b) {
  const ka = a.join('\u0000')
  const kb = b.join('\u0000')
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/**
 * Paths of a datapoint in one tree (the caller picks the tree), each from
 * datapointRefPath(), in code-point order, and the main path among them.
 *
 * The main path is the one of the command group address: the link whose
 * `group_address` equals the datapoint's `group_address`. The search API
 * delivers neither field yet (#1266 P6/P7); without them, and when no link
 * matches, the first path in code-point order is the main path, so the
 * choice is deterministic whatever order the API returns the links in.
 */
export function datapointTreePaths(datapoint, treeId) {
  const refs = (datapoint.hierarchy_nodes ?? []).filter(ref => ref.tree_id === treeId)
  const entries = refs
    .map(ref => ({ ref, path: datapointRefPath(ref, datapoint.name) }))
    .sort((a, b) => comparePaths(a.path, b.path))
  if (!entries.length) return { primary: null, paths: [] }
  const command = datapoint.group_address
  const main = entries.find(entry => command && entry.ref.group_address === command) ?? entries[0]
  return { primary: main.path, paths: entries.map(entry => entry.path) }
}
