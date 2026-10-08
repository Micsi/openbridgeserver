// Path formatter for datapoint pickers (#1266, seam S8).
//
// Fixtures follow the shape GET /api/v1/search delivers per datapoint
// (obs/api/v1/search.py `_add_hierarchy`): `hierarchy_nodes` is a list of
// { node_id, node_name, tree_id, tree_name, node_path: [{ node_id, node_name }],
// display_depth }, where node_path runs root → parent and excludes the linked
// node itself and the tree name. The ETS trees are built the way
// obs/api/v1/services/hierarchy_import.py builds them today: "groups" puts one
// node per group address (named like the address) under main › middle group
// and the import names the datapoint like the address.
import { describe, expect, it } from 'vitest'
import { datapointRefPath } from '@/utils/hierarchyDisplay'

let seq = 0
function nodeRef(treeId, treeName, names) {
  seq += 1
  const path = names.slice(0, -1).map((name, i) => ({ node_id: `${treeId}-${seq}-${i}`, node_name: name }))
  return {
    node_id: `${treeId}-${seq}-leaf`,
    node_name: names[names.length - 1],
    tree_id: treeId,
    tree_name: treeName,
    node_path: path,
    display_depth: 0,
  }
}
const gaTree = names => nodeRef('t-groups', 'ETS Gruppenadressen', names)

describe('datapointRefPath — leaf collapse', () => {
  it('K1: drops a leaf that repeats the datapoint name, so the name shows once', () => {
    const ref = gaTree(['Beleuchtung', 'Schalten', '01 Esszimmer - Spots'])
    expect(datapointRefPath(ref, '01 Esszimmer - Spots')).toEqual(['Beleuchtung', 'Schalten'])
  })

  it('K6: repairs a stored "groups" tree without re-import, compared after normalizing', () => {
    // The import strips the node name but keeps the datapoint name as parsed.
    const ref = gaTree(['Beleuchtung', 'Schalten', '01 Esszimmer -  Spots'])
    expect(datapointRefPath(ref, ' 01 ESSZIMMER - Spots ')).toEqual(['Beleuchtung', 'Schalten'])
  })

  it('keeps a leaf that names something else than the datapoint', () => {
    const ref = nodeRef('t-b', 'ETS Gebäude und Räume', ['Haus', 'EG', 'Esszimmer'])
    expect(datapointRefPath(ref, 'Schalten')).toEqual(['Haus', 'EG', 'Esszimmer'])
  })

  it('collapses only the leaf, never an inner node with the same name', () => {
    const ref = gaTree(['Spots', 'Schalten'])
    expect(datapointRefPath(ref, 'Spots')).toEqual(['Spots', 'Schalten'])
  })

  it('tolerates a ref without node_path and an empty datapoint name', () => {
    expect(datapointRefPath({ node_name: 'Licht' }, '')).toEqual(['Licht'])
    expect(datapointRefPath(null, 'x')).toEqual([])
  })
})
