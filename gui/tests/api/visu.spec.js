import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Die Visu-Endpunkte des Editors (M5 C3, Issue #170).
 *
 * Gepinnt werden die PFADE, weil sie die Naht zum Backend sind: sie stehen so in
 * `obs/api/v1/visu.py` (`@router.get("/tree")`, `/nodes/{node_id}`,
 * `/pages/{node_id}` und `@router.put("/pages/{node_id}")`) und haengen unter
 * dem `/api/v1`-Praefix des gemeinsamen Clients. Ein Tippfehler hier waere im
 * Editor ein leerer Baum, im Test aber sonst unsichtbar.
 */

let get
let put

beforeEach(() => {
  vi.resetModules()
  get = vi.fn(async () => ({ data: null }))
  put = vi.fn(async () => ({ status: 204 }))
  vi.doMock('@/api/client', () => ({ default: { get, put } }))
})

afterEach(() => {
  vi.doUnmock('@/api/client')
})

describe('visuApi', () => {
  it('liest Baum, Knoten und Seiten unter den Pfaden des Backends', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.tree()
    await visuApi.node('n1')
    await visuApi.page('n1')
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/visu/tree',
      '/visu/nodes/n1',
      '/visu/pages/n1',
    ])
  })

  it('schreibt die Seiten-Konfiguration per PUT auf dieselbe Seiten-Adresse', async () => {
    const { visuApi } = await import('@/api/visu')
    const config = { widgets: [], includes: [], ignore_global_includes: false, popup: null }
    await visuApi.savePage('n1', config)
    expect(put).toHaveBeenCalledWith('/visu/pages/n1', config)
  })

  it('benutzt den gemeinsamen Client — der Token steht in keinem Pfad', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.page('n1')
    for (const call of get.mock.calls) expect(JSON.stringify(call)).not.toContain('token')
  })
})
