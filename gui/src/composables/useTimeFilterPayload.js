/**
 * useTimeFilterPayload — convert the TimeFilterPopover state (#432) into
 * the backend time-filter shape:
 *
 *   { from?: iso, to?: iso,
 *     from_relative_seconds?: int, to_relative_seconds?: int }
 *
 * Date bounds → ISO strings; relative durations → signed seconds.
 * Point mode (point ± span) collapses into an absolute (from, to) pair.
 *
 * Extracted from RingBufferView.vue in #438 to keep that file small.
 * The helper is a pure function — no Vue reactivity — so it stays trivial
 * to unit-test.
 *
 * @param {{ mode?: 'range'|'point', from?: any, to?: any, point?: any, span?: any } | null} filter
 * @returns {Record<string, string | number> | null}
 */
export function timeFilterToPayload(filter) {
  if (!filter) return null
  const time = {}

  function applyBound(bound, key, relKey) {
    if (!bound) return
    if (bound instanceof Date) {
      time[key] = bound.toISOString()
    } else if (Number.isFinite(bound.seconds)) {
      time[relKey] = (bound.sign === -1 ? -1 : 1) * bound.seconds
    }
  }

  if (filter.mode === 'point') {
    const point = filter.point instanceof Date
      ? filter.point
      : (Number.isFinite(filter.point?.seconds)
          ? new Date(Date.now() + (filter.point.sign === -1 ? -1 : 1) * filter.point.seconds * 1000)
          : null)
    const spanSeconds = Number.isFinite(filter.span?.seconds) ? filter.span.seconds : 0
    if (point && spanSeconds > 0) {
      time.from = new Date(point.getTime() - spanSeconds * 1000).toISOString()
      time.to = new Date(point.getTime() + spanSeconds * 1000).toISOString()
    } else if (point) {
      time.from = point.toISOString()
      time.to = point.toISOString()
    }
  } else {
    applyBound(filter.from, 'from', 'from_relative_seconds')
    applyBound(filter.to, 'to', 'to_relative_seconds')
  }

  return Object.keys(time).length ? time : null
}
