export interface WeightedChartPoint {
  v: unknown
  n?: number | null
}

export interface TimedWeightedChartPoint extends WeightedChartPoint {
  ts: string
}

export function weightedAverage(points: WeightedChartPoint[]): number | null {
  const weighted = points.reduce((acc, p) => {
    const value = Number(p.v)
    const weight = Math.max(1, Number(p.n ?? 1))
    if (!Number.isFinite(value) || !Number.isFinite(weight)) return acc
    return { sum: acc.sum + value * weight, weight: acc.weight + weight }
  }, { sum: 0, weight: 0 })

  return weighted.weight > 0 ? weighted.sum / weighted.weight : null
}

export function sortedUniqueTimestamps(series: TimedWeightedChartPoint[][]): number[] {
  return [...new Set(series.flatMap(points => points.map(p => new Date(p.ts).getTime()).filter(Number.isFinite)))]
    .sort((a, b) => a - b)
}

export function weightedValuesByTimestamp(points: TimedWeightedChartPoint[], timestamps: number[]): (number | null)[] {
  const grouped = new Map<number, TimedWeightedChartPoint[]>()

  for (const point of points) {
    const ts = new Date(point.ts).getTime()
    if (!Number.isFinite(ts)) continue
    const bucket = grouped.get(ts) ?? []
    bucket.push(point)
    grouped.set(ts, bucket)
  }

  return timestamps.map(ts => {
    const bucket = grouped.get(ts)
    return bucket ? weightedAverage(bucket) : null
  })
}
