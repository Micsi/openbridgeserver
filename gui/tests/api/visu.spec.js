import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let api

beforeEach(() => {
  vi.resetModules()
  api = {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  }
  vi.doMock('@/api/client', () => ({ default: api }))
})

afterEach(() => {
  vi.doUnmock('@/api/client')
})

/**
 * Die Backend-Naht des V2-Editors (M5 C1, Issue #168).
 *
 * Kein neuer Endpunkt: der Editor benutzt genau die Wege, die `obs/api/v1/visu.py`
 * seit jeher anbietet. Diese Spec haelt die Adressen und die Nutzlasten fest -
 * eine verrutschte URL faellt hier auf, nicht erst im E2E gegen den echten Server.
 */
describe('visuApi', () => {
  it('bindet Baum, Knoten und Seiten an ihre Adressen', async () => {
    const { visuApi } = await import('@/api/visu')

    await visuApi.tree()
    await visuApi.getPage('seite/1')
    await visuApi.savePage('seite/1', { includes: [] })
    await visuApi.createNode({ name: 'M5 Neu' })
    await visuApi.updateNode('seite/1', { name: 'M5 Neu' })
    await visuApi.deleteNode('seite/1')
    await visuApi.moveNode('seite/1', { new_parent_id: null, order: 3 })
    await visuApi.nodeUsers('seite/1')
    await visuApi.usernames()

    expect(api.get).toHaveBeenNthCalledWith(1, '/visu/tree')
    expect(api.get).toHaveBeenNthCalledWith(2, '/visu/pages/seite%2F1')
    expect(api.put).toHaveBeenNthCalledWith(1, '/visu/pages/seite%2F1', { includes: [] })
    expect(api.post).toHaveBeenCalledWith('/visu/nodes', { name: 'M5 Neu' })
    expect(api.patch).toHaveBeenCalledWith('/visu/nodes/seite%2F1', { name: 'M5 Neu' })
    expect(api.delete).toHaveBeenCalledWith('/visu/nodes/seite%2F1')
    expect(api.put).toHaveBeenNthCalledWith(2, '/visu/nodes/seite%2F1/move', {
      new_parent_id: null,
      order: 3,
    })
    expect(api.get).toHaveBeenNthCalledWith(3, '/visu/nodes/seite%2F1/users')
    expect(api.get).toHaveBeenNthCalledWith(4, '/auth/users')
  })

  it('haelt kein Token in einer URL oder einer Query', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.tree()
    await visuApi.getPage('seite-1')
    for (const call of [...api.get.mock.calls, ...api.put.mock.calls, ...api.post.mock.calls]) {
      expect(String(call[0])).not.toMatch(/token|bearer|\?/i)
    }
  })
})
