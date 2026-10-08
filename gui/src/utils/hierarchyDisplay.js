import { formatGa } from '@/utils/groupAddress'

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
// Input is a datapoint as GET /api/v1/search delivers it: `name`,
// `group_address` (command group address of its KNX binding, internal
// notation, or null) and `hierarchy_nodes`, each { node_id, node_name,
// tree_id, tree_name, node_path: [{ node_id, node_name }] (root → parent),
// display_depth }.
// ---------------------------------------------------------------------------

/** Name comparison for collapsing a leaf: trimmed, inner whitespace
 * collapsed, case-insensitive. */
export function normalizeHierarchyName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
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

/**
 * Paths of a datapoint in one tree (the caller picks the tree), each from
 * datapointRefPath(), in the order the API delivers them, and the main path.
 *
 * With one path that is the main path. With several (a switch and a status
 * address in two middle groups of one tree) the main path is undecided
 * (`primary: null`): it should be the path of the command group address, but
 * a link does not record which address created it (hierarchy_import.py keeps
 * the address → node mapping only while importing). Recording it is #1266 P6;
 * until then the caller shows all paths.
 */
export function datapointTreePaths(datapoint, treeId) {
  const paths = (datapoint.hierarchy_nodes ?? [])
    .filter(ref => ref.tree_id === treeId)
    .map(ref => datapointRefPath(ref, datapoint.name))
  return { primary: paths.length === 1 ? paths[0] : null, paths }
}

/**
 * One picker line per datapoint for one tree: `label` is the main path plus
 * the name (once), the name alone without a path in that tree, and null while
 * the main path is undecided; `paths` holds every path as a line (for a
 * tooltip or detail text).
 *
 * Lines that read exactly the same are collisions; only there `groupAddress`
 * carries the datapoint's command group address in the project's style
 * (formatGa; pass knxProject.groupAddressStyle, an unknown style throws),
 * elsewhere it is null. `ambiguous` marks a collision the address cannot
 * resolve: the datapoint has none or shares it with another line.
 */
export function datapointPathRows(datapoints, { treeId, groupAddressStyle }) {
  const rows = datapoints.map(datapoint => {
    const { primary, paths } = datapointTreePaths(datapoint, treeId)
    const line = path => [...path, datapoint.name].join(' › ')
    const label = paths.length ? primary && line(primary) : datapoint.name
    return { datapoint, label, paths: paths.map(line), groupAddress: null, ambiguous: false }
  })
  const byLabel = new Map()
  for (const row of rows) {
    if (row.label === null) continue
    if (!byLabel.has(row.label)) byLabel.set(row.label, [])
    byLabel.get(row.label).push(row)
  }
  for (const group of byLabel.values()) {
    if (group.length < 2) continue
    for (const row of group) {
      const address = row.datapoint.group_address
      row.groupAddress = address ? formatGa(address, groupAddressStyle) : null
    }
    for (const row of group) {
      row.ambiguous = !row.groupAddress || group.filter(other => other.groupAddress === row.groupAddress).length > 1
    }
  }
  return rows
}
