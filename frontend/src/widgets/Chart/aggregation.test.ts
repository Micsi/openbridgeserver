import { describe, expect, it } from 'vitest'
import { sortedUniqueTimestamps, weightedAverage, weightedValuesByTimestamp } from './aggregation'

describe('weightedAverage', () => {
  it('uses equal weights when sample counts are absent', () => {
    expect(weightedAverage([{ v: 10 }, { v: 20 }])).toBe(15)
  })

  it('preserves backend sample weights for aggregated chart buckets', () => {
    expect(weightedAverage([{ v: 10, n: 1 }, { v: 20, n: 9 }])).toBe(19)
  })

  it('ignores non-numeric values', () => {
    expect(weightedAverage([{ v: 'bad', n: 10 }, { v: 12, n: 2 }])).toBe(12)
  })

  it('returns null when no numeric values are available', () => {
    expect(weightedAverage([{ v: 'bad', n: 10 }])).toBeNull()
  })
})

describe('aggregated bar bucket alignment', () => {
  const t0 = Date.parse('2026-06-03T10:00:00Z')
  const t1 = Date.parse('2026-06-03T11:00:00Z')
  const t2 = Date.parse('2026-06-03T12:00:00Z')

  it('uses backend aggregate bucket timestamps directly', () => {
    const timestamps = sortedUniqueTimestamps([
      [{ ts: '2026-06-03T12:00:00Z', v: 30 }],
      [{ ts: '2026-06-03T10:00:00Z', v: 10 }, { ts: '2026-06-03T11:00:00Z', v: 20 }],
    ])

    expect(timestamps).toEqual([t0, t1, t2])
  })

  it('does not create empty frontend buckets between hourly aggregate buckets', () => {
    const timestamps = [t0, t1]
    const values = weightedValuesByTimestamp([
      { ts: '2026-06-03T10:00:00Z', v: 10, n: 1 },
      { ts: '2026-06-03T11:00:00Z', v: 20, n: 9 },
    ], timestamps)

    expect(values).toEqual([10, 20])
  })

  it('keeps missing series buckets as null without shifting values', () => {
    const values = weightedValuesByTimestamp([
      { ts: '2026-06-03T11:00:00Z', v: 20, n: 9 },
    ], [t0, t1])

    expect(values).toEqual([null, 20])
  })
})
