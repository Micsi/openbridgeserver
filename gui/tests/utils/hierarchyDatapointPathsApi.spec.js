// Path formatter on a real search response (#1266, seams S3 → S8).
//
// fixtures/search-same-name.json is GET /api/v1/search after importing the demo
// project with "Spots P8" given to two group addresses of one middle range
// (1/1/1, 1/1/2) and to one of another range (1/4/1), with the ETS "groups"
// tree. tests/integration/test_search_datapoint_paths.py produces it from the
// live response and fails when it is stale (ids replaced, unread fields left out).
import { describe, expect, it } from 'vitest'
import response from '../fixtures/search-same-name.json'
import { datapointPathRows } from '@/utils/hierarchyDisplay'

const rows = style => datapointPathRows(response, { treeId: 'tree-groups', groupAddressStyle: style })
const main = 'Demo 01 - Binaersignale'

describe('datapointPathRows on the real search response', () => {
  it.each([
    ['ThreeLevel', '1/1/1', '1/1/2'],
    ['TwoLevel', '1/257', '1/258'],
    ['Free', '2305', '2306'],
  ])('%s: the name once, the address only on the two lines of one range', (style, first, second) => {
    expect(rows(style).map(row => [row.label, row.groupAddress, row.ambiguous])).toEqual([
      [`${main} › Schalten › Spots P8`, first, false],
      [`${main} › Schalten › Spots P8`, second, false],
      [`${main} › Status Rueckmeldung › Spots P8`, null, false],
    ])
  })
})
