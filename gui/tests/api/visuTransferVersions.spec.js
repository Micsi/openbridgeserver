import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Die Backend-Naht von Teil C6 (Issue #173): Verlauf, Export, Import.
 *
 * Gepinnt werden die PFADE, weil sie die Naht sind - sie stehen so in
 * `obs/api/v1/visu.py` (`@router.get("/nodes/{node_id}/versions")`,
 * `/versions/{revision}`, `/nodes/{node_id}/export`, `@router.post`
 * `/nodes/import`). Ein Tippfehler hier waere im Editor ein leerer Verlauf, im
 * Test aber sonst unsichtbar.
 *
 * ES GIBT KEINEN SCHREIB-ENDPUNKT FUER DAS WIEDERHERSTELLEN, und diese Datei
 * haelt das fest: der Verlauf wird gelesen, geschrieben wird ueber
 * `PUT /visu/pages/{id}` wie eh und je. Ein eigener Restore-Pfad waere der
 * dritte Schreiber auf `page_config` (Micsi/openbridgeserver#187).
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

describe('visuApi - Verlauf, Export, Import (C6)', () => {
  it('liest den Verlauf und eine einzelne Version unter den Pfaden des Backends', async () => {
    const { visuApi } = await import('@/api/visu')

    await visuApi.pageVersions('seite/1')
    await visuApi.pageVersion('seite/1', 3)

    expect(api.get.mock.calls.map((call) => call[0])).toEqual([
      '/visu/nodes/seite%2F1/versions',
      '/visu/nodes/seite%2F1/versions/3',
    ])
  })

  it('exportiert einen Teilbaum und importiert ihn wieder', async () => {
    const { visuApi } = await import('@/api/visu')
    const doc = { obs_export: 'visu_subtree', version: 1, nodes: [], target_parent_id: null }

    await visuApi.exportNode('seite/1')
    await visuApi.importNodes(doc)

    expect(api.get).toHaveBeenCalledWith('/visu/nodes/seite%2F1/export')
    expect(api.post).toHaveBeenCalledWith('/visu/nodes/import', doc)
  })

  it('kennt keinen Schreibweg fuer den Verlauf', async () => {
    const { visuApi } = await import('@/api/visu')

    expect(visuApi.restoreVersion).toBeUndefined()
    expect(Object.keys(visuApi).filter((name) => /restore/i.test(name))).toEqual([])
  })

  it('haelt kein Token in einer URL oder einer Query', async () => {
    const { visuApi } = await import('@/api/visu')
    await visuApi.pageVersions('seite-1')
    await visuApi.pageVersion('seite-1', 2)
    await visuApi.exportNode('seite-1')
    for (const call of [...api.get.mock.calls, ...api.post.mock.calls]) {
      expect(String(call[0])).not.toMatch(/token|bearer|\?/i)
    }
  })
})
