import { describe, it, expect } from 'vitest'
import {
  LOGIC_DATE_VARIABLES,
  LOGIC_STANDARD_VARIABLES,
  configuredObsSlots,
  normaliseObjectVariables,
  unresolvedVariables,
  variableToken,
} from '@/utils/logicVariables'

describe('logicVariables', () => {
  it('lists the documented variables', () => {
    expect(LOGIC_DATE_VARIABLES).toContain('HH')
    expect(LOGIC_DATE_VARIABLES).toContain('MMMM')
    expect(LOGIC_STANDARD_VARIABLES).toEqual(['DATE', 'TIME', 'TS'])
    expect(variableToken('H')).toBe('###H###')
  })

  it('reports only unknown names and unconfigured OBS slots', () => {
    expect(unresolvedVariables('[###H###].a.###mm###', [])).toEqual([])
    expect(unresolvedVariables('###FOO###/###FOO###/###OBS1###/###OBS2###', [1])).toEqual(['FOO', 'OBS2'])
    expect(unresolvedVariables('###h###')).toEqual(['h'])
    expect(unresolvedVariables(undefined)).toEqual([])
  })

  it('collects configured OBS slots', () => {
    expect(configuredObsSlots(undefined)).toEqual([])
    expect(configuredObsSlots([
      { slot: 2, datapoint_id: 'a' },
      { slot: 3, datapoint_id: '' },
      { datapoint_id: 'b' },
      { slot: 'x', datapoint_id: 'c' },
    ])).toEqual([2, 3, 4])
  })

  it('normalises variables from arrays and JSON strings', () => {
    expect(normaliseObjectVariables('not json')).toEqual([])
    expect(normaliseObjectVariables({})).toEqual([])
    expect(normaliseObjectVariables('[{"slot":"5","datapoint_id":"a","datapoint_name":"A"},{}]')).toEqual([
      { slot: 5, datapoint_id: 'a', datapoint_name: 'A' },
      { slot: 2, datapoint_id: '', datapoint_name: '' },
    ])
  })
})
