import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const put = vi.fn()

vi.mock('@/api/client', () => ({ default: { get, put } }))

/**
 * Der Zugang des V2-Editors zum Visu-Backend (M5 C2, Issue #169).
 *
 * Drei Aufrufe, drei Adressen - und genau die werden hier festgehalten. Ein
 * verrutschter Pfad faellt sonst erst im Browser auf, und dort sieht er aus wie
 * ein leerer Canvas.
 */
describe('visuApi', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockReset()
  })

  it('liest den Knoten (Name und Seitentyp) unter /visu/nodes/{id}', async () => {
    get.mockResolvedValue({ data: { id: 'n1', name: 'M5 Home', kind: 'normal' } })
    const { visuApi } = await import('@/api/visu')

    const res = await visuApi.getNode('n1')

    expect(get).toHaveBeenCalledWith('/visu/nodes/n1')
    expect(res.data.name).toBe('M5 Home')
  })

  it('liest die Seitenkonfiguration unter /visu/pages/{id}', async () => {
    get.mockResolvedValue({ data: { widgets: [] } })
    const { visuApi } = await import('@/api/visu')

    await visuApi.getPage('n1')

    expect(get).toHaveBeenCalledWith('/visu/pages/n1')
  })

  it('speichert die Seitenkonfiguration per PUT auf dieselbe Adresse', async () => {
    put.mockResolvedValue({ status: 204 })
    const { visuApi } = await import('@/api/visu')
    const config = { widgets: [{ id: 'w1' }] }

    await visuApi.savePage('n1', config)

    expect(put).toHaveBeenCalledWith('/visu/pages/n1', config)
  })

  it('liegt auch als Vorgabe-Ausfuhr bereit', async () => {
    const mod = await import('@/api/visu')
    expect(mod.default).toBe(mod.visuApi)
  })
})
