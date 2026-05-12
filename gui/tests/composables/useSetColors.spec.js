/**
 * Tests for the useSetColors composable (issue #437).
 *
 * The composable maps a list of matched filter-set ids on a ring-buffer entry
 * to a CSS row style ({ backgroundColor, color }) using the colours of the
 * configured topbar filtersets:
 *
 *   - `refreshSets()` (or `setSets()` in tests) loads the topbar-active sets
 *     into the local cache.
 *   - `getRowStyle(matchedIds)` returns a style object for the first set in
 *     topbar order that appears in `matchedIds`. Text colour is auto-derived
 *     from the background luminance via chroma-js (luminance > 0.5 → dark
 *     text, otherwise white).
 *   - Robust against `null`, empty lists, unknown ids, invalid colours.
 *
 * Tie-break for multi-matches: the topbar order (`topbar_order` ascending)
 * decides — first wins. Sets that are not topbar-active are ignored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeSet(overrides = {}) {
  return {
    id: 'set-a',
    name: 'Set A',
    color: '#3b82f6',
    topbar_active: true,
    topbar_order: 0,
    ...overrides,
  }
}

describe('useSetColors', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns undefined for empty / null matchedIds', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([makeSet()])

    expect(getRowStyle(null)).toBeUndefined()
    expect(getRowStyle(undefined)).toBeUndefined()
    expect(getRowStyle([])).toBeUndefined()
  })

  it('returns undefined when no matched id is in the topbar cache', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([makeSet({ id: 'set-a', topbar_order: 0 })])

    // matched id "set-unknown" is not in the cache → no style
    expect(getRowStyle(['set-unknown'])).toBeUndefined()
  })

  it('returns dark text on a very light background (#fff700 → luminance > 0.5)', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([makeSet({ id: 's', color: '#fff700' })])

    const style = getRowStyle(['s'])
    expect(style).toBeTruthy()
    expect(style.backgroundColor).toBe('#fff700')
    expect(style.color).toBe('#0f172a')
  })

  it('returns light text on a very dark background (#0f172a → luminance < 0.5)', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([makeSet({ id: 's', color: '#0f172a' })])

    const style = getRowStyle(['s'])
    expect(style).toBeTruthy()
    expect(style.backgroundColor).toBe('#0f172a')
    expect(style.color).toBe('#ffffff')
  })

  it('returns light text on a mid-tone blue (#3b82f6 → luminance < 0.5)', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([makeSet({ id: 's', color: '#3b82f6' })])

    const style = getRowStyle(['s'])
    expect(style).toBeTruthy()
    expect(style.color).toBe('#ffffff')
  })

  it('picks the first topbar-order match when an entry matches multiple sets', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([
      makeSet({ id: 's-b', color: '#ef4444', topbar_order: 1 }),
      makeSet({ id: 's-a', color: '#10b981', topbar_order: 0 }),
    ])

    // matchedIds order is irrelevant — topbar_order decides
    const style = getRowStyle(['s-b', 's-a'])
    expect(style.backgroundColor).toBe('#10b981')
  })

  it('ignores sets that are not topbar-active', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([
      makeSet({ id: 's-a', color: '#10b981', topbar_active: false, topbar_order: 0 }),
      makeSet({ id: 's-b', color: '#ef4444', topbar_active: true,  topbar_order: 1 }),
    ])

    // s-a would win by topbar_order, but is not active → s-b wins
    const style = getRowStyle(['s-a', 's-b'])
    expect(style.backgroundColor).toBe('#ef4444')
  })

  it('returns undefined when the matched set has an invalid colour', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([makeSet({ id: 's', color: 'not-a-color' })])

    expect(getRowStyle(['s'])).toBeUndefined()
  })

  it('returns undefined when the matched set has a null or empty colour', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { setSets, getRowStyle } = mod.useSetColors()
    setSets([
      makeSet({ id: 's-null', color: null }),
      makeSet({ id: 's-empty', color: '' }),
    ])

    expect(getRowStyle(['s-null'])).toBeUndefined()
    expect(getRowStyle(['s-empty'])).toBeUndefined()
  })

  it('refreshSets() pulls topbar-active sets from ringbufferApi.listFiltersets()', async () => {
    vi.doMock('@/api/client', () => ({
      ringbufferApi: {
        listFiltersets: vi.fn().mockResolvedValue({
          data: [
            { id: 's-a', color: '#10b981', topbar_active: true,  topbar_order: 0 },
            { id: 's-b', color: '#ef4444', topbar_active: false, topbar_order: 1 },
          ],
        }),
      },
    }))
    const mod = await import('@/composables/useSetColors.js')
    const { refreshSets, getRowStyle } = mod.useSetColors()
    await refreshSets()

    expect(getRowStyle(['s-a']).backgroundColor).toBe('#10b981')
    // s-b is not topbar_active → no style
    expect(getRowStyle(['s-b'])).toBeUndefined()
  })

  it('refreshSets() tolerates API errors and leaves the cache empty', async () => {
    vi.doMock('@/api/client', () => ({
      ringbufferApi: {
        listFiltersets: vi.fn().mockRejectedValue(new Error('boom')),
      },
    }))
    const mod = await import('@/composables/useSetColors.js')
    const { refreshSets, getRowStyle } = mod.useSetColors()
    await refreshSets()

    expect(getRowStyle(['anything'])).toBeUndefined()
  })

  it('shares the module-level cache across useSetColors() calls', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const a = mod.useSetColors()
    a.setSets([makeSet({ id: 'shared', color: '#22c55e' })])

    const b = mod.useSetColors()
    expect(b.getRowStyle(['shared']).backgroundColor).toBe('#22c55e')
  })

  it('getAccentText returns a readable text colour for a given hex', async () => {
    const mod = await import('@/composables/useSetColors.js')
    const { getAccentText } = mod.useSetColors()
    expect(getAccentText('#fff700')).toBe('#0f172a')
    expect(getAccentText('#0f172a')).toBe('#ffffff')
    expect(getAccentText('not-a-color')).toBe('#0f172a') // sensible fallback
  })
})
