// Path formatter on real search responses for each ETS layout (#1266 P6, seams S3 → S8).
//
// fixtures/search-ets-layouts.json holds GET /api/v1/search per family and tree,
// written by tests/integration/test_knxproj_hierarchy_layouts.py from synthetic
// projects: K1 three-level with names repeated over middle groups and one name
// twice in a range (K4), K2 two-level, K3 free with nested ranges, R1 a
// room-oriented project with generic address names in a meaningless main group,
// K5 a switch datapoint that also listens to its status address. That
// integration test fails when the fixture is stale.
import { describe, expect, it } from 'vitest'
import layouts from '../fixtures/search-ets-layouts.json'
import { datapointPathRows } from '@/utils/hierarchyDisplay'

const rows = (key, style = 'ThreeLevel') => datapointPathRows(layouts[key], { treeId: 'tree', groupAddressStyle: style })
const spots = '01 Esszimmer - Spots'
const ceiling = '02 Kueche - Decke'

describe('datapointPathRows on real responses of every ETS layout', () => {
  it.each(Object.keys(layouts))('%s: every line decided, unique, the name once', key => {
    const result = rows(key)
    expect(result.length).toBeGreaterThan(0)
    for (const row of result) {
      expect(row.label).not.toBeNull()
      expect(row.ambiguous).toBe(false)
      expect(row.label.split(' › ').filter(part => part === row.datapoint.name)).toHaveLength(1)
    }
    const shown = result.map(row => `${row.label} ${row.groupAddress ?? ''}`)
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('K1/K4: the path tells middle groups apart, the address only the twin in one range', () => {
    expect(rows('K1 groups').map(row => [row.label, row.groupAddress])).toEqual([
      [`Beleuchtung › Schalten › ${spots}`, '28/1/1'],
      [`Beleuchtung › Schalten › ${ceiling}`, null],
      [`Beleuchtung › Schalten › ${spots}`, '28/1/3'],
      [`Beleuchtung › Status › ${spots}`, null],
      [`Beleuchtung › Status › ${ceiling}`, null],
      [`Beleuchtung › Dimmen › ${spots}`, null],
    ])
  })

  it('K2/K3: two-level and free trees follow their ranges, the address in the project style', () => {
    expect(rows('K2 groups', 'TwoLevel').map(row => row.label)).toEqual([`Beleuchtung › ${spots}`, `Beleuchtung › ${ceiling}`])
    expect(rows('K3 mid', 'Free').map(row => row.label)).toEqual([`Haus › EG › ${spots}`, `Haus › EG › ${ceiling}`])
  })

  it.each(['K5 groups', 'K5 mid'])('%s: the switch path is the main path, the status path stays in the detail', key => {
    const [switchRow] = rows(key).filter(row => row.datapoint.group_address === '29/1/2')
    expect(switchRow.label).toBe(`Beleuchtung › Schalten › ${ceiling}`)
    expect(switchRow.paths).toEqual([`Beleuchtung › Schalten › ${ceiling}`, `Beleuchtung › Status › ${ceiling}`])
  })

  it('R1/R2: room › function tells generic names apart without an address, the meaningless group tree needs it', () => {
    expect(rows('R1 buildings').map(row => [row.label, row.groupAddress])).toEqual([
      ['Demo-Test-Projekt › EG › Kueche › Licht Decke › Schalten', null],
      ['Demo-Test-Projekt › EG › Kueche › Licht Decke › Status', null],
      ['Demo-Test-Projekt › EG › Kueche › Licht Insel › Schalten', null],
      ['Demo-Test-Projekt › EG › Kueche › Licht Insel › Status', null],
      ['Demo-Test-Projekt › EG › Bad › Licht Decke › Schalten', null],
    ])
    expect(rows('R1 groups').every(row => row.groupAddress !== null)).toBe(true)
  })
})
