/**
 * RingBufferView — live-entry matching against active topbar sets.
 *
 * Bug (#36 follow-up): live WebSocket entries always landed in the table
 * with `matched_set_ids: []`, so the colour painting from the initial REST
 * OR-union scrolled off the top of the table as live updates pushed it down.
 * User expectation:
 *   1. Only entries that match at least one active topbar set are shown
 *      when filter sets are active in the topbar.
 *   2. Newly arrived (live) entries that match are painted with the
 *      corresponding set colour, like REST-loaded matches.
 *   3. With no topbar sets active the table is unfiltered, as before.
 *
 * The matcher is the client-side equivalent of FilterCriteria
 * (datapoints / adapters / tags / q / value_filter; hierarchy is pass-through).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountRingBufferView, makeRingbufferApiMock, flushPromises } from '../helpers/mountRingBufferView'

const ACTIVE_SET_HEIZUNG = {
  id: 'set-heizung',
  name: 'Heizung',
  is_active: true,
  color: '#3b82f6',
  topbar_active: true,
  topbar_order: 0,
  filter: {
    hierarchy_nodes: [],
    datapoints: [],
    tags: ['heizung'],
    adapters: [],
    q: null,
    value_filter: null,
  },
  filter_json: '{"tags":["heizung"]}',
}

const ACTIVE_SET_KNX = {
  id: 'set-knx',
  name: 'KNX',
  is_active: true,
  color: '#ef4444',
  topbar_active: true,
  topbar_order: 1,
  filter: {
    hierarchy_nodes: [],
    datapoints: [],
    tags: [],
    adapters: ['knx'],
    q: null,
    value_filter: null,
  },
  filter_json: '{"adapters":["knx"]}',
}

function makeLiveEntry(overrides = {}) {
  return {
    id: 9999,
    ts: '2026-05-12T20:00:00Z',
    datapoint_id: 'dp-live',
    name: 'Live DP',
    new_value: 1,
    old_value: 0,
    source_adapter: 'knx',
    unit: '°C',
    quality: 'good',
    metadata: { tags: [] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('RingBufferView — live-entry matching (#36 follow-up)', () => {
  it('annotates live entries with matched_set_ids derived from active topbar sets', async () => {
    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi.fn().mockResolvedValue({ data: [ACTIVE_SET_HEIZUNG, ACTIVE_SET_KNX] }),
      queryMultiFiltersets: vi.fn().mockResolvedValue({ data: [] }),
    })
    const { wrapper, emitLive } = await mountRingBufferView({ ringbufferApi })
    await flushPromises()

    // Live entry with tag "heizung" AND adapter "knx" — should be matched by both sets
    emitLive(makeLiveEntry({ metadata: { tags: ['heizung'] }, source_adapter: 'knx' }))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 120))
    await flushPromises()

    // The component should have enqueued the entry with matched_set_ids populated
    // (via the table render). The exact data is internal; we check via the table row count.
    const rows = wrapper.findAll('[data-testid="ringbuffer-entry"]')
    expect(rows.length).toBe(1)
    wrapper.unmount()
  })

  it('drops a live entry that matches none of the active topbar sets', async () => {
    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi.fn().mockResolvedValue({ data: [ACTIVE_SET_HEIZUNG] }),
      queryMultiFiltersets: vi.fn().mockResolvedValue({ data: [] }),
    })
    const { wrapper, emitLive } = await mountRingBufferView({ ringbufferApi })
    await flushPromises()

    // Tag is "licht", set requires "heizung" — should NOT appear in the table
    emitLive(makeLiveEntry({ metadata: { tags: ['licht'] } }))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 120))
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="ringbuffer-entry"]')
    expect(rows.length).toBe(0)
    wrapper.unmount()
  })

  it('keeps live entries flowing when no topbar sets are active', async () => {
    const ringbufferApi = makeRingbufferApiMock({
      listFiltersets: vi.fn().mockResolvedValue({ data: [] }),
    })
    const { wrapper, emitLive } = await mountRingBufferView({ ringbufferApi })
    await flushPromises()

    emitLive(makeLiveEntry({ metadata: { tags: ['anything'] } }))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 120))
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="ringbuffer-entry"]')
    expect(rows.length).toBe(1)
    wrapper.unmount()
  })
})

describe('RingBufferView — single status indicator (#36 follow-up)', () => {
  it('renders exactly one "Live"/"Pausiert"/"Offline" status badge in the topbar', async () => {
    const ringbufferApi = makeRingbufferApiMock()
    const { wrapper } = await mountRingBufferView({ ringbufferApi })
    await flushPromises()

    // The bug: there were two badges both rendering the word "Live" (the
    // WebSocket-connection badge AND the pause-state badge). The fix is a
    // single consolidated badge.
    const badges = wrapper.findAll('[data-testid="status-badge"]')
    expect(badges.length).toBe(1)
    // The old, redundant pause-state badge must be gone.
    const liveModeBadges = wrapper.findAll('[data-testid="live-mode-badge"]')
    expect(liveModeBadges.length).toBe(0)
    wrapper.unmount()
  })
})
