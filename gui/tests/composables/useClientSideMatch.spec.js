/**
 * useClientSideMatch — client-side filter matcher used to colour and gate
 * live WebSocket entries (#36 follow-up).
 *
 * Background: the backend WS push does not include `matched_set_ids` — only
 * the REST multi-query response does. Live entries therefore arrived in the
 * table un-matched, so the row paint that the initial load applied to the
 * 500 rows of the OR-union disappeared as live updates pushed them off the
 * top of the table. Expected behaviour (user feedback): live entries are
 * matched against the active topbar sets on the client side; entries that
 * do not match any active set are not shown when filters are active.
 *
 * The matcher mirrors the simple, server-equivalent fields of FilterCriteria:
 *   datapoints — list of datapoint UUIDs, OR
 *   adapters   — list of adapter type strings, OR
 *   tags       — list of tag strings, OR over entry.metadata.tags
 *   q          — substring match over name | datapoint_id | source_adapter
 *   value_filter — operator over new_value
 *
 * hierarchy_nodes is intentionally pass-through: the frontend does not have
 * a hierarchy resolver, and live-entry filtering is best-effort. A set with
 * only hierarchy filters therefore matches every entry on the client (the
 * REST OR-union will still be correct on the next refresh).
 */
import { describe, it, expect } from 'vitest'
import { matchEntry } from '@/composables/useClientSideMatch'

function makeEntry(overrides = {}) {
  return {
    id: 1,
    ts: '2026-05-12T20:00:00Z',
    datapoint_id: 'dp-1',
    name: 'Wohnzimmer Temperatur',
    new_value: 22.5,
    old_value: 22.4,
    source_adapter: 'knx',
    unit: '°C',
    quality: 'good',
    metadata: { tags: ['heizung', 'wohnen'] },
    ...overrides,
  }
}

describe('matchEntry — empty criteria', () => {
  it('returns true for an empty FilterCriteria (every entry matches)', () => {
    expect(matchEntry(makeEntry(), {})).toBe(true)
  })

  it('returns true when FilterCriteria is null/undefined', () => {
    expect(matchEntry(makeEntry(), null)).toBe(true)
    expect(matchEntry(makeEntry(), undefined)).toBe(true)
  })
})

describe('matchEntry — datapoints (OR)', () => {
  it('matches when entry.datapoint_id is in the list', () => {
    expect(matchEntry(makeEntry({ datapoint_id: 'dp-7' }), { datapoints: ['dp-1', 'dp-7'] })).toBe(true)
  })

  it('does not match when entry.datapoint_id is not in the list', () => {
    expect(matchEntry(makeEntry({ datapoint_id: 'dp-99' }), { datapoints: ['dp-1', 'dp-7'] })).toBe(false)
  })

  it('matches when the datapoints list is empty (no constraint)', () => {
    expect(matchEntry(makeEntry(), { datapoints: [] })).toBe(true)
  })
})

describe('matchEntry — adapters (OR)', () => {
  it('matches when entry.source_adapter is in the list', () => {
    expect(matchEntry(makeEntry({ source_adapter: 'mqtt' }), { adapters: ['knx', 'mqtt'] })).toBe(true)
  })

  it('does not match when entry.source_adapter is not in the list', () => {
    expect(matchEntry(makeEntry({ source_adapter: 'modbus' }), { adapters: ['knx', 'mqtt'] })).toBe(false)
  })
})

describe('matchEntry — tags (OR)', () => {
  it('matches when entry has at least one of the requested tags', () => {
    expect(matchEntry(makeEntry({ metadata: { tags: ['heizung', 'küche'] } }), { tags: ['küche'] })).toBe(true)
  })

  it('does not match when entry has none of the requested tags', () => {
    expect(matchEntry(makeEntry({ metadata: { tags: ['licht'] } }), { tags: ['heizung'] })).toBe(false)
  })

  it('handles missing metadata.tags gracefully', () => {
    expect(matchEntry(makeEntry({ metadata: {} }), { tags: ['heizung'] })).toBe(false)
    expect(matchEntry(makeEntry({ metadata: undefined }), { tags: ['heizung'] })).toBe(false)
  })
})

describe('matchEntry — q (substring)', () => {
  it('matches q against the entry name', () => {
    expect(matchEntry(makeEntry({ name: 'Wohnzimmer Temp' }), { q: 'wohnzimmer' })).toBe(true)
  })

  it('matches q against the datapoint_id', () => {
    expect(matchEntry(makeEntry({ datapoint_id: 'abc-def' }), { q: 'def' })).toBe(true)
  })

  it('matches q against the source_adapter', () => {
    expect(matchEntry(makeEntry({ source_adapter: 'knx' }), { q: 'kn' })).toBe(true)
  })

  it('does not match when q is in no searchable field', () => {
    expect(matchEntry(makeEntry({ name: 'X', datapoint_id: 'y', source_adapter: 'z' }), { q: 'nope' })).toBe(false)
  })
})

describe('matchEntry — value_filter', () => {
  it('numeric > works on new_value', () => {
    expect(matchEntry(makeEntry({ new_value: 25 }), { value_filter: { operator: 'gt', value: 20 } })).toBe(true)
    expect(matchEntry(makeEntry({ new_value: 15 }), { value_filter: { operator: 'gt', value: 20 } })).toBe(false)
  })

  it('numeric eq', () => {
    expect(matchEntry(makeEntry({ new_value: 22 }), { value_filter: { operator: 'eq', value: 22 } })).toBe(true)
  })

  it('regex on string new_value', () => {
    expect(matchEntry(makeEntry({ new_value: 'OK-200' }), { value_filter: { operator: 'regex', pattern: '^OK-' } })).toBe(true)
    expect(matchEntry(makeEntry({ new_value: 'ERR-500' }), { value_filter: { operator: 'regex', pattern: '^OK-' } })).toBe(false)
  })

  it('between numeric inclusive on lower/upper', () => {
    expect(matchEntry(makeEntry({ new_value: 50 }), { value_filter: { operator: 'between', lower: 0, upper: 100 } })).toBe(true)
    expect(matchEntry(makeEntry({ new_value: 150 }), { value_filter: { operator: 'between', lower: 0, upper: 100 } })).toBe(false)
  })
})

describe('matchEntry — AND across criteria', () => {
  it('all populated criteria must match', () => {
    const filter = {
      adapters: ['knx'],
      tags: ['heizung'],
      value_filter: { operator: 'gt', value: 20 },
    }
    expect(matchEntry(makeEntry({ source_adapter: 'knx', metadata: { tags: ['heizung'] }, new_value: 25 }), filter)).toBe(true)
    // Same entry but wrong adapter → no match
    expect(matchEntry(makeEntry({ source_adapter: 'mqtt', metadata: { tags: ['heizung'] }, new_value: 25 }), filter)).toBe(false)
    // Same entry but wrong tag → no match
    expect(matchEntry(makeEntry({ source_adapter: 'knx', metadata: { tags: ['licht'] }, new_value: 25 }), filter)).toBe(false)
    // Same entry but value too low → no match
    expect(matchEntry(makeEntry({ source_adapter: 'knx', metadata: { tags: ['heizung'] }, new_value: 5 }), filter)).toBe(false)
  })
})

describe('matchEntry — hierarchy pass-through', () => {
  it('matches even when hierarchy_nodes is set, since the frontend has no resolver', () => {
    expect(matchEntry(makeEntry(), { hierarchy_nodes: [{ tree_id: 't', node_id: 'n', include_descendants: true }] })).toBe(true)
  })
})
