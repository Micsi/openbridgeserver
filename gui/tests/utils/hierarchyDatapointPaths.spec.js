// Path formatter for datapoint pickers (#1266, seam S8).
//
// Fixtures follow the shape GET /api/v1/search delivers per datapoint
// (obs/api/v1/search.py): `group_address`, the command group address of the
// KNX binding (internal notation or null), and `hierarchy_nodes`, a list of
// { node_id, node_name, tree_id, tree_name, node_path: [{ node_id, node_name }],
// display_depth, group_address }, where node_path runs root → parent and
// excludes the linked node itself and the tree name, and group_address is the
// address the link was made through (null when unknown). Real responses are
// checked in hierarchyDatapointPathsApi.spec.js and
// hierarchyDatapointPathsLayouts.spec.js. Trees named "after P6"/"after P7" do not
// exist yet; they have the same shape. The ETS trees are built the way
// obs/api/v1/services/hierarchy_import.py builds them today: "groups" puts one
// node per group address (named like the address) under main › middle group
// and the import names the datapoint like the address.
import { describe, expect, it } from 'vitest'
import { datapointPathRows, datapointRefPath, datapointTreePaths } from '@/utils/hierarchyDisplay'

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
    expect(datapointRefPath({ node_name: 'Licht' }, undefined)).toEqual(['Licht'])
    expect(datapointRefPath(null, 'x')).toEqual([])
  })
})

describe('datapointTreePaths — main path of a datapoint in one tree', () => {
  const name = '01 Esszimmer - Spots'
  const schalten = gaTree(['Beleuchtung', 'Schalten', name])
  const status = gaTree(['Beleuchtung', 'Status', name])
  const room = nodeRef('t-b', 'ETS Gebäude und Räume', ['Haus', 'EG', 'Esszimmer'])

  it('K5: links without their address (made by hand or before P6) leave the main path undecided, every path listed', () => {
    // Without the address of each link neither the command address nor any
    // order of the paths can decide.
    expect(datapointTreePaths({ name, group_address: '1/0/1', hierarchy_nodes: [status, schalten, room] }, 't-groups')).toEqual({
      primary: null,
      paths: [['Beleuchtung', 'Status'], ['Beleuchtung', 'Schalten']],
    })
  })

  it('K5: the path of the link made through the command group address is the main path', () => {
    const dp = { name, group_address: '1/0/1', hierarchy_nodes: [{ ...status, group_address: '1/1/1' }, { ...schalten, group_address: '1/0/1' }, room] }
    expect(datapointTreePaths(dp, 't-groups')).toEqual({
      primary: ['Beleuchtung', 'Schalten'],
      paths: [['Beleuchtung', 'Status'], ['Beleuchtung', 'Schalten']],
    })
  })

  it('K5: stays undecided without a command address or with two links through it', () => {
    const linked = [{ ...status, group_address: '1/1/1' }, { ...schalten, group_address: '1/0/1' }]
    expect(datapointTreePaths({ name, group_address: null, hierarchy_nodes: linked }, 't-groups').primary).toBeNull()
    const twice = [{ ...status, group_address: '1/0/1' }, { ...schalten, group_address: '1/0/1' }]
    expect(datapointTreePaths({ name, group_address: '1/0/1', hierarchy_nodes: twice }, 't-groups').primary).toBeNull()
  })

  it('works per tree: another tree gives its own path, a tree without link gives none', () => {
    const dp = { name, hierarchy_nodes: [schalten, room] }
    expect(datapointTreePaths(dp, 't-b')).toEqual({ primary: ['Haus', 'EG', 'Esszimmer'], paths: [['Haus', 'EG', 'Esszimmer']] })
    expect(datapointTreePaths(dp, 't-none')).toEqual({ primary: null, paths: [] })
    expect(datapointTreePaths({ name }, 't-groups')).toEqual({ primary: null, paths: [] })
  })

  it('lists two links with the same names twice, the tooltip shows what the tree holds', () => {
    const twin = gaTree(['Beleuchtung', 'Schalten', name])
    expect(datapointTreePaths({ name, hierarchy_nodes: [schalten, twin] }, 't-groups').paths).toEqual([
      ['Beleuchtung', 'Schalten'],
      ['Beleuchtung', 'Schalten'],
    ])
  })
})

// `group_address` on a datapoint is the command address of its KNX binding
// (search API, #1266); null for a datapoint without KNX binding.
describe('datapointPathRows — collisions show the group address, only there', () => {
  const spots = '01 Esszimmer - Spots'
  const k4 = [
    { id: 'a', name: spots, group_address: '1/0/1', hierarchy_nodes: [gaTree(['Beleuchtung', 'Schalten', spots])] },
    { id: 'b', name: spots, group_address: '1/0/2', hierarchy_nodes: [gaTree(['Beleuchtung', 'Schalten', spots])] },
    { id: 'c', name: spots, group_address: '1/1/1', hierarchy_nodes: [gaTree(['Beleuchtung', 'Status', spots])] },
  ]
  const opts = style => ({ treeId: 't-groups', groupAddressStyle: style })

  it('K1: one line, path then the name exactly once', () => {
    const [row] = datapointPathRows([k4[2]], opts('ThreeLevel'))
    expect(row).toMatchObject({ label: `Beleuchtung › Status › ${spots}`, paths: [`Beleuchtung › Status › ${spots}`], groupAddress: null, ambiguous: false })
    expect(row.datapoint).toBe(k4[2])
  })

  it.each([
    ['ThreeLevel', '1/0/1', '1/0/2'],
    ['TwoLevel', '1/1', '1/2'],
    ['Free', '2049', '2050'],
  ])('K4 (%s): same name twice in one range, the address in the project style tells them apart', (style, first, second) => {
    const rows = datapointPathRows(k4, opts(style))
    expect(rows.map(row => [row.label, row.groupAddress, row.ambiguous])).toEqual([
      [`Beleuchtung › Schalten › ${spots}`, first, false],
      [`Beleuchtung › Schalten › ${spots}`, second, false],
      [`Beleuchtung › Status › ${spots}`, null, false],
    ])
  })

  it('K4 without KNX binding: the twins stay ambiguous, the rest is unaffected', () => {
    const today = k4.map(({ group_address: _ga, ...dp }) => dp)
    expect(datapointPathRows(today, opts('ThreeLevel')).map(row => [row.groupAddress, row.ambiguous])).toEqual([
      [null, true],
      [null, true],
      [null, false],
    ])
  })

  it('stays ambiguous when the colliding rows share their address too', () => {
    const twins = [k4[0], { ...k4[1], group_address: '1/0/1' }]
    expect(datapointPathRows(twins, opts('ThreeLevel')).map(row => row.ambiguous)).toEqual([true, true])
  })

  it('K5: an undecided main path gives no line, the detail lists every path, nothing collides with it', () => {
    const dp = { id: 'k5', name: spots, group_address: '1/0/9', hierarchy_nodes: [gaTree(['Beleuchtung', 'Status', spots]), gaTree(['Beleuchtung', 'Schalten', spots])] }
    const rows = datapointPathRows([dp, k4[2]], opts('ThreeLevel'))
    expect(rows.map(row => [row.label, row.groupAddress, row.ambiguous])).toEqual([
      [null, null, false],
      [`Beleuchtung › Status › ${spots}`, null, false],
    ])
    expect(rows[0].paths).toEqual([`Beleuchtung › Status › ${spots}`, `Beleuchtung › Schalten › ${spots}`])
  })

  it('two datapoints with undecided main paths do not collide with each other', () => {
    const undecided = id => ({
      id,
      name: spots,
      group_address: id === 'u1' ? '1/0/1' : '1/0/2',
      hierarchy_nodes: [gaTree(['Beleuchtung', 'Status', spots]), gaTree(['Beleuchtung', 'Schalten', spots])],
    })
    const rows = datapointPathRows([undecided('u1'), undecided('u2')], opts('ThreeLevel'))
    expect(rows.map(row => [row.label, row.groupAddress, row.ambiguous])).toEqual([
      [null, null, false],
      [null, null, false],
    ])
  })

  it('a path that is only the collapsed leaf reads as the name alone', () => {
    const [row] = datapointPathRows([{ id: 'leaf', name: 'Licht', hierarchy_nodes: [gaTree(['Licht'])] }], opts('ThreeLevel'))
    expect([row.label, row.paths]).toEqual(['Licht', ['Licht']])
  })

  it('only lines that read exactly the same collide; case or spacing tells them apart', () => {
    const rows = datapointPathRows(
      [
        { id: 'x', name: 'Licht', group_address: '1/0/1', hierarchy_nodes: [] },
        { id: 'y', name: 'licht', group_address: '1/0/2', hierarchy_nodes: [] },
        { id: 'z', name: 'Licht ', group_address: '1/0/3', hierarchy_nodes: [] },
        { id: 'w', name: 'Licht', group_address: '1/0/4', hierarchy_nodes: [] },
      ],
      opts('ThreeLevel'),
    )
    expect(rows.map(row => [row.label, row.groupAddress])).toEqual([
      ['Licht', '1/0/1'],
      ['licht', null],
      ['Licht ', null],
      ['Licht', '1/0/4'],
    ])
  })
})

// Fixture families of the #1266 plan, as rows a picker would show.
const lines = (datapoints, treeId) =>
  datapointPathRows(datapoints, { treeId, groupAddressStyle: 'ThreeLevel' }).map(row => [row.label, row.groupAddress, row.ambiguous])

describe('fixture families: classic group address structure', () => {
  it('K6: a "groups" tree as imported today reads name once and needs no address', () => {
    const spots = '01 Esszimmer - Spots'
    const dps = ['Schalten', 'Status', 'Dimmen'].map((mid, i) => ({
      id: `k6-${i}`,
      name: spots,
      group_address: `1/${i}/1`,
      hierarchy_nodes: [gaTree(['Beleuchtung', mid, spots])],
    }))
    expect(lines(dps, 't-groups')).toEqual([
      [`Beleuchtung › Schalten › ${spots}`, null, false],
      [`Beleuchtung › Status › ${spots}`, null, false],
      [`Beleuchtung › Dimmen › ${spots}`, null, false],
    ])
  })

  it('K2: two-level project, today with the generated middle group, after P6 without', () => {
    // Internally 1/0/x; today's import names the missing middle group itself.
    const today = ['Esszimmer Spots', 'Küche Spots'].map((name, i) => ({
      id: `k2-${i}`,
      name,
      hierarchy_nodes: [gaTree(['Beleuchtung', 'Mittelgruppe 0', name])],
    }))
    expect(lines(today, 't-groups')).toEqual([
      ['Beleuchtung › Mittelgruppe 0 › Esszimmer Spots', null, false],
      ['Beleuchtung › Mittelgruppe 0 › Küche Spots', null, false],
    ])
    const ranges = today.map(dp => ({ ...dp, hierarchy_nodes: [gaTree(['Beleuchtung', dp.name])] }))
    expect(lines(ranges, 't-groups').map(([label]) => label)).toEqual(['Beleuchtung › Esszimmer Spots', 'Beleuchtung › Küche Spots'])
  })

  it('K3 after P6: free addressing with nested ranges follows the range names', () => {
    const dps = [
      ['Haus', 'EG', 'Licht', 'Esszimmer Spots'],
      ['Haus', 'OG', 'Licht', 'Esszimmer Spots'],
    ].map((names, i) => ({ id: `k3-${i}`, name: 'Esszimmer Spots', hierarchy_nodes: [gaTree(names)] }))
    expect(lines(dps, 't-groups')).toEqual([
      ['Haus › EG › Licht › Esszimmer Spots', null, false],
      ['Haus › OG › Licht › Esszimmer Spots', null, false],
    ])
  })
})

describe('fixture families: room oriented with ETS functions', () => {
  // Room › function tree (after #1266 P7) and today's "buildings" tree, which
  // links a datapoint to its room only.
  const roomFn = names => nodeRef('t-room', 'Räume', names)
  const roomOnly = names => nodeRef('t-b', 'ETS Gebäude und Räume', names)
  const gaOld = names => gaTree(names)
  const r1 = []
  for (const fn of ['Decke', 'Wand']) {
    for (const [j, name] of ['Schalten', 'Status'].entries()) {
      r1.push({
        id: `r1-${fn}-${name}`,
        name,
        group_address: `0/0/${r1.length + 1}`,
        hierarchy_nodes: [
          roomFn(['Haus', 'EG', 'Esszimmer', fn]),
          roomOnly(['Haus', 'EG', 'Esszimmer']),
          // R2: an old main group with names that say nothing
          gaOld(['Neue Hauptgruppe', `Neue Mittelgruppe ${j}`, name]),
        ],
      })
    }
  }

  it('R1 after P7: two functions per room with generic names are unique by room › function', () => {
    expect(lines(r1, 't-room')).toEqual([
      ['Haus › EG › Esszimmer › Decke › Schalten', null, false],
      ['Haus › EG › Esszimmer › Decke › Status', null, false],
      ['Haus › EG › Esszimmer › Wand › Schalten', null, false],
      ['Haus › EG › Esszimmer › Wand › Status', null, false],
    ])
  })

  it('R1 in the buildings tree (room only, as imported today): the address tells the functions apart', () => {
    expect(lines(r1, 't-b')).toEqual([
      ['Haus › EG › Esszimmer › Schalten', '0/0/1', false],
      ['Haus › EG › Esszimmer › Status', '0/0/2', false],
      ['Haus › EG › Esszimmer › Schalten', '0/0/3', false],
      ['Haus › EG › Esszimmer › Status', '0/0/4', false],
    ])
  })

  it('R2: in the old main group the generic names collide and need the address', () => {
    expect(lines(r1, 't-groups').map(([label, ga]) => [label, ga])).toEqual([
      ['Neue Hauptgruppe › Neue Mittelgruppe 0 › Schalten', '0/0/1'],
      ['Neue Hauptgruppe › Neue Mittelgruppe 1 › Status', '0/0/2'],
      ['Neue Hauptgruppe › Neue Mittelgruppe 0 › Schalten', '0/0/3'],
      ['Neue Hauptgruppe › Neue Mittelgruppe 1 › Status', '0/0/4'],
    ])
  })

  it('R3: a group address without function shows its name, the address only on a collision', () => {
    const dps = [
      { id: 'r3-a', name: 'Zentral Aus', group_address: '0/7/1', hierarchy_nodes: [] },
      { id: 'r3-b', name: 'Reserve', group_address: '0/7/2', hierarchy_nodes: [] },
      { id: 'r3-c', name: 'Reserve', group_address: '0/7/3', hierarchy_nodes: [] },
      r1[0],
    ]
    expect(lines(dps, 't-room')).toEqual([
      ['Zentral Aus', null, false],
      ['Reserve', '0/7/2', false],
      ['Reserve', '0/7/3', false],
      ['Haus › EG › Esszimmer › Decke › Schalten', null, false],
    ])
  })
})
