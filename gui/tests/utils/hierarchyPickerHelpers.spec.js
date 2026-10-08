/**
 * Picker helpers of hierarchyDisplay.js (#1266 P9), fed with search responses
 * recorded from a real import (`fixtures/dp-picker-api.json`).
 */
import { describe, it, expect } from 'vitest'
import picker from '../fixtures/dp-picker-api.json'
import {
  datapointPathRows,
  datapointRowLines,
  datapointRowText,
  isKnxFunctionTree,
  knxFunctionsOf,
  preferredDatapointTreeId,
} from '@/utils/hierarchyDisplay'

const response = (params) =>
  picker.search.find((entry) => JSON.stringify(entry.params) === JSON.stringify(params)).response.items

const inGroups = response({ tree_id: 'tree-groups', size: 500 })
const inBuildings = response({ tree_id: 'tree-buildings', size: 500 })

describe('datapointRowLines / datapointRowText', () => {
  it('a decided row is its label, plus the address where it shows one', () => {
    const rows = datapointPathRows(inGroups, { treeId: 'tree-groups', groupAddressStyle: 'TwoLevel' })
    const switch1 = rows.find((row) => row.datapoint.group_address === '30/0/1')
    expect(datapointRowLines(switch1)).toEqual(['Neue Hauptgruppe › Neue Mittelgruppe › Schalten'])
    expect(datapointRowText(switch1)).toBe('Neue Hauptgruppe › Neue Mittelgruppe › Schalten · 30/1')

    const [unique] = datapointPathRows(inBuildings.slice(0, 1), { treeId: 'tree-buildings', groupAddressStyle: 'ThreeLevel' })
    expect(datapointRowText(unique)).toBe(unique.label)
  })

  it('an undecided row is all its paths', () => {
    const row = { label: null, paths: ['A › X', 'B › X'], groupAddress: null }
    expect(datapointRowLines(row)).toEqual(['A › X', 'B › X'])
    expect(datapointRowText(row)).toBe('A › X | B › X')
  })
})

describe('preferredDatapointTreeId', () => {
  it('takes the tree most datapoints have a path in', () => {
    // all 6 are in the group tree, 5 in the building tree
    expect(preferredDatapointTreeId(inGroups)).toBe('tree-groups')
  })

  it('keeps the first tree on a tie and is null without paths', () => {
    expect(preferredDatapointTreeId(inBuildings)).toBe(inBuildings[0].hierarchy_nodes[0].tree_id)
    expect(preferredDatapointTreeId([{ id: 'x', name: 'x' }])).toBeNull()
    expect(preferredDatapointTreeId([])).toBeNull()
  })

  it('counts a datapoint once per tree even with several links there', () => {
    const twoLinks = { id: 'a', hierarchy_nodes: [{ tree_id: 't1' }, { tree_id: 't1' }] }
    const other = [{ id: 'b', hierarchy_nodes: [{ tree_id: 't2' }] }, { id: 'c', hierarchy_nodes: [{ tree_id: 't2' }] }]
    expect(preferredDatapointTreeId([twoLinks, ...other])).toBe('t2')
  })
})

describe('isKnxFunctionTree', () => {
  it('knows the building and trade trees of the import by their source', () => {
    expect(picker.trees.filter(isKnxFunctionTree).map((tree) => tree.id)).toEqual(['tree-buildings'])
    expect(isKnxFunctionTree({ description: 'ets_import:trades' })).toBe(true)
    expect(isKnxFunctionTree({ description: 'Meine Räume' })).toBe(false)
    expect(isKnxFunctionTree(null)).toBe(false)
  })
})

describe('knxFunctionsOf', () => {
  it('lists the linked nodes of the function trees with their path and datapoint count', () => {
    expect(knxFunctionsOf(inBuildings, ['tree-buildings']).map(({ label, count, tree_id }) => [label, count, tree_id])).toEqual([
      ['Demo-Test-Projekt › EG › Bad › Licht Decke', 1, 'tree-buildings'],
      ['Demo-Test-Projekt › EG › Kueche › Licht Decke', 2, 'tree-buildings'],
      ['Demo-Test-Projekt › EG › Kueche › Licht Insel', 2, 'tree-buildings'],
    ])
  })

  it('ignores the links of other trees and copes with refs without a path', () => {
    expect(knxFunctionsOf(inGroups, [])).toEqual([])
    expect(knxFunctionsOf([{ id: 'd', hierarchy_nodes: [{ tree_id: 't', tree_name: 'T', node_id: 'n', node_name: 'Licht' }] }, { id: 'e' }], ['t'])).toEqual([
      { id: 'n', tree_id: 't', tree_name: 'T', path: ['Licht'], label: 'Licht', count: 1 },
    ])
  })
})
