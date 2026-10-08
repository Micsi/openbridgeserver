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
// display_depth, group_address } — the last one is the address the ETS
// import linked through (internal notation, null for links made by hand or
// before #1266 P6).
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
 * address in two middle groups of one tree) it is the path of the one link
 * made through the datapoint's command group address. Without such a link
 * (links made by hand or before #1266 P6, or several through that address)
 * the main path is undecided (`primary: null`) and the caller shows all paths.
 */
export function datapointTreePaths(datapoint, treeId) {
  const refs = (datapoint.hierarchy_nodes ?? []).filter(ref => ref.tree_id === treeId)
  const paths = refs.map(ref => datapointRefPath(ref, datapoint.name))
  if (paths.length === 1) return { primary: paths[0], paths }
  const command = datapoint.group_address ? refs.flatMap((ref, i) => (ref.group_address === datapoint.group_address ? [paths[i]] : [])) : []
  return { primary: command.length === 1 ? command[0] : null, paths }
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

/**
 * The lines a picker shows for one row of datapointPathRows(): the label, or
 * every path while the main path is undecided (`label: null`).
 */
export function datapointRowLines(row) {
  return row.label === null ? row.paths : [row.label]
}

/**
 * A row as one plain text – its lines, then the group address where the row
 * shows one. An input that shows the chosen datapoint uses it, so the field
 * reads like the row that was picked.
 */
export function datapointRowText(row) {
  const text = datapointRowLines(row).join(' | ')
  return row.groupAddress ? `${text} · ${row.groupAddress}` : text
}

/**
 * The tree a picker without an explicit choice shows paths from: the one in
 * which most of the given datapoints have a path (the first such tree on a
 * tie), or null when none has one.
 */
export function preferredDatapointTreeId(datapoints) {
  const counts = new Map()
  for (const datapoint of datapoints) {
    for (const treeId of new Set((datapoint.hierarchy_nodes ?? []).map(ref => ref.tree_id))) {
      counts.set(treeId, (counts.get(treeId) ?? 0) + 1)
    }
  }
  let best = null
  for (const [treeId, count] of counts) {
    if (best === null || count > counts.get(best)) best = treeId
  }
  return best
}

/** Trees the .knxproj import builds from ETS functions (Room › function, trade › function). */
const KNX_FUNCTION_TREE_SOURCES = ['ets_import:buildings', 'ets_import:trades']

export function isKnxFunctionTree(tree) {
  return KNX_FUNCTION_TREE_SOURCES.includes(tree?.description)
}

/**
 * ETS functions as the picker's function lens lists them, from datapoints as
 * GET /api/v1/search delivers them for the function trees: in those trees the
 * import links a datapoint to the node of its ETS function, so every linked
 * node there is a function. One entry per node, with its path (root → function,
 * without the tree name) and how many of the datapoints it holds, sorted by path.
 */
export function knxFunctionsOf(datapoints, treeIds) {
  const wanted = new Set(treeIds)
  const functions = new Map()
  for (const datapoint of datapoints) {
    for (const ref of datapoint.hierarchy_nodes ?? []) {
      if (!wanted.has(ref.tree_id)) continue
      if (!functions.has(ref.node_id)) {
        const path = [...(ref.node_path ?? []).map(seg => seg.node_name), ref.node_name]
        functions.set(ref.node_id, { id: ref.node_id, tree_id: ref.tree_id, tree_name: ref.tree_name, path, label: path.join(' › '), datapoints: new Set() })
      }
      functions.get(ref.node_id).datapoints.add(datapoint.id)
    }
  }
  return [...functions.values()]
    .map(({ datapoints: ids, ...fn }) => ({ ...fn, count: ids.size }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
