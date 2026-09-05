import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Die Backend-Naht des V2-Editors (M5 C1 Issue #168, C2 Issue #169, C3 Issue #170).
 *
 * Kein neuer Endpunkt: der Editor benutzt genau die Wege, die
 * `obs/api/v1/visu.py` seit jeher anbietet. Gepinnt werden die PFADE und die
 * Nutzlasten, weil sie die Naht zum Backend sind: sie stehen so in
 * `obs/api/v1/visu.py` (`@router.get("/tree")`, `/nodes/{node_id}`,
 * `/pages/{node_id}`, `@router.put("/pages/{node_id}")`) und haengen unter dem
 * `/api/v1`-Praefix des gemeinsamen Clients. Ein Tippfehler hier waere im Editor
 * ein leerer Baum, im Test aber sonst unsichtbar - und eine verrutschte URL
 * faellt hier auf, nicht erst im E2E gegen den echten Server.
 */

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

  it('liest Baum, Knoten und Seiten unter den Pfaden des Backends', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.tree()
    await visuApi.node('n1')
    await visuApi.page('n1')
    expect(api.get.mock.calls.map((call) => call[0])).toEqual([
      '/visu/tree',
      '/visu/nodes/n1',
      '/visu/pages/n1',
    ])
  })

  it('schreibt die Seiten-Konfiguration per PUT auf dieselbe Seiten-Adresse', async () => {
    const { visuApi } = await import('@/api/visu')
    const config = { widgets: [], includes: [], ignore_global_includes: false, popup: null }
    await visuApi.savePage('n1', config)
    expect(api.put).toHaveBeenCalledWith('/visu/pages/n1', config)
  })

  /**
   * `page` und `getPage` sind ZWEI NAMEN FUER EINEN AUFRUF (C1 nennt ihn
   * `getPage`, C3 `page`). Driften sie auseinander, laesen Editor-Store und
   * Entwurfs-Composable die Seite unter verschiedenen Adressen - und die
   * Vorschau zeigte etwas anderes als das Eigenschaftsformular.
   */
  it('liest die Seite unter beiden Namen an derselben Adresse', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.getPage('seite/1')
    await visuApi.page('seite/1')
    expect(api.get.mock.calls.map((call) => call[0])).toEqual([
      '/visu/pages/seite%2F1',
      '/visu/pages/seite%2F1',
    ])
  })

  it('haelt kein Token in einer URL oder einer Query', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.tree()
    await visuApi.getPage('seite-1')
    await visuApi.page('seite-1')
    await visuApi.node('seite-1')
    for (const call of [...api.get.mock.calls, ...api.put.mock.calls, ...api.post.mock.calls]) {
      expect(String(call[0])).not.toMatch(/token|bearer|\?/i)
      expect(JSON.stringify(call)).not.toContain('token')
    }
  })

  /**
   * Die Aufrufe, die der WYSIWYG-Canvas aus Teil C2 braucht (Issue #169), unter
   * SEINEN Namen: `getNode` fuer Name und Seitentyp, `getTree` fuer die Layer
   * der Seite. Sie sind Zweitnamen von `node`/`tree` - genau die Konstruktion,
   * die `page`/`getPage` oben schon traegt. Driften sie auseinander, liest der
   * Canvas den Baum unter einer anderen Adresse als der Editor-Store.
   */
  it('liest Knoten und Baum auch unter den Namen des Canvas (C2)', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.getNode('n1')
    await visuApi.getTree()
    expect(api.get.mock.calls.map((call) => call[0])).toEqual(['/visu/nodes/n1', '/visu/tree'])
    expect(visuApi.getNode).toBe(visuApi.node)
    expect(visuApi.getTree).toBe(visuApi.tree)
  })

  /** Der Canvas importiert die Vorgabe-Ausfuhr; sie muss dasselbe Objekt sein. */
  it('liegt auch als Vorgabe-Ausfuhr bereit', async () => {
    const mod = await import('@/api/visu')
    expect(mod.default).toBe(mod.visuApi)
  })
})
