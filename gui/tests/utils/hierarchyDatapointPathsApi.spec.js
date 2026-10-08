// Path formatter on a real search response (#1266, seams S3 → S8).
//
// fixtures/search-same-name.json is GET /api/v1/search after importing the demo
// project plus three group addresses named "Spots P8": two in one middle range
// (1/1/96, 1/1/97), one in another (1/4/128), with the ETS "groups" tree.
// tests/integration/test_search_datapoint_paths.py produces it from the live
// response and fails when it is stale (ids replaced, unread fields left out).
// That integration test is the only guard of the field names: renaming a field
// of the search response leaves this spec green until the fixture is rebuilt.
import { describe, expect, it } from 'vitest'
import response from '../fixtures/search-same-name.json'
import { datapointPathRows } from '@/utils/hierarchyDisplay'

const rows = style => datapointPathRows(response, { treeId: 'tree-groups', groupAddressStyle: style })
const main = 'Demo 01 - Binaersignale'

describe('datapointPathRows on the real search response', () => {
  it.each([
    ['ThreeLevel', '1/1/96', '1/1/97'],
    ['TwoLevel', '1/352', '1/353'],
    ['Free', '2400', '2401'],
  ])('%s: the name once, the address only on the two lines of one range', (style, first, second) => {
    expect(rows(style).map(row => [row.label, row.groupAddress, row.ambiguous])).toEqual([
      [`${main} › Schalten › Spots P8`, first, false],
      [`${main} › Schalten › Spots P8`, second, false],
      [`${main} › Status Rueckmeldung › Spots P8`, null, false],
    ])
  })
})
