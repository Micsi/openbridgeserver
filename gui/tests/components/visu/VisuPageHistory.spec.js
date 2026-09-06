import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * Der Seitenverlauf des V2-Editors (M5 C6, Issue #173, Messlatte E12).
 *
 * Die Playwright-Haelfte dieser Abnahme ist E12 in
 * `apps/visu/e2e/m5-editor-matrix.spec.ts`; hier stehen dieselben Behauptungen
 * als Einzelfragen - und die Fehlerpfade, die ein Browser-Szenario nicht
 * herstellen kann.
 *
 * DER SERVER IST EIN STAND, KEIN STUMPF: `savePage` legt ab, `getPage` liefert,
 * was zuletzt abgelegt wurde. Nur so ist die Aussage pruefbar, an der alles
 * haengt - dass „wiederhergestellt" erst gemeldet wird, wenn der Server den
 * alten Stand WIRKLICH traegt. Eine zu freundliche Attrappe, die auf jedes
 * `savePage` mit „ja" antwortet, haette in Runde 1 des Canvas einen echten
 * Datenverlust verdeckt; derselbe Fehler wird hier nicht wiederholt.
 */

const pageVersions = vi.fn()
const pageVersion = vi.fn()
const savePage = vi.fn()
const getPage = vi.fn()

vi.mock('@/api/visu', () => ({
  visuApi: {
    pageVersions: (...args) => pageVersions(...args),
    pageVersion: (...args) => pageVersion(...args),
    savePage: (...args) => savePage(...args),
    getPage: (...args) => getPage(...args),
  },
}))

const konfig = (x) => ({
  grid_cols: 12,
  grid_row_height: 80,
  grid_cell_width: 80,
  background: null,
  widgets: [{ id: 'w-1', name: 'Kachel', type: 'Toggle', x, y: 0, w: 2, h: 2, config: {} }],
  includes: [],
  ignore_global_includes: false,
  popup: null,
  layout_mode: 'pixel',
  grid: 8,
  breakpoints: [480],
  skin: null,
})

/** Der Serverstand waehrend eines Tests: Verlauf plus die ausgelieferte Seite. */
const server = { verlauf: {}, seite: null, saveFails: false }

function wireServer() {
  server.verlauf = { 1: konfig(1), 2: konfig(2), 3: konfig(3) }
  server.seite = konfig(3)
  server.saveFails = false
  pageVersions.mockImplementation(async () => ({
    data: Object.keys(server.verlauf)
      .map(Number)
      .sort((a, b) => b - a)
      .map((revision) => ({
        revision,
        created_at: `2026-09-0${revision}T10:00:00+00:00`,
        created_by: 'admin',
      })),
  }))
  pageVersion.mockImplementation(async (_id, revision) => {
    const config = server.verlauf[revision]
    if (!config) throw new Error('404')
    return { data: JSON.parse(JSON.stringify(config)) }
  })
  savePage.mockImplementation(async (_id, config) => {
    if (server.saveFails) throw new Error('500')
    server.seite = JSON.parse(JSON.stringify(config))
    const next = Math.max(...Object.keys(server.verlauf).map(Number)) + 1
    server.verlauf[next] = JSON.parse(JSON.stringify(config))
    return { status: 204 }
  })
  getPage.mockImplementation(async () => ({ data: JSON.parse(JSON.stringify(server.seite)) }))
}

async function mountHistory(props = {}) {
  const { default: VisuPageHistory } = await import('@/components/visu/VisuPageHistory.vue')
  const wrapper = mount(VisuPageHistory, { props: { pageId: 'p1', ...props } })
  await flushPromises()
  return wrapper
}

const byButton = (wrapper, text) =>
  wrapper.findAll('button').find((b) => b.text().includes(text)) ?? null
const eintraege = (wrapper) => wrapper.findAll('.editor-version')

async function open(wrapper) {
  await byButton(wrapper, 'Verlauf').trigger('click')
  await flushPromises()
  return wrapper
}

/**
 * Ein Klick, der NICHT auf das Netz wartet - so wie ein echter Klick auch nicht
 * wartet. Damit misst der Test, was der Autor im selben Augenblick SIEHT.
 */
function openSofort(wrapper) {
  byButton(wrapper, 'Verlauf').element.click()
  return wrapper.vm.$nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  wireServer()
})

describe('VisuPageHistory (E12)', () => {
  /**
   * DER VERLAUF WIRD IM VORAUS GEHOLT, nicht erst beim Aufklappen.
   *
   * Das ist eine Zusage an die Bedienung: „Verlauf" ist ein Schalter, kein
   * Ladevorgang. Wer ihn drueckt, sieht die Liste - und zwar im selben
   * Augenblick, nicht nach einer Anfrage. Deshalb klickt dieser Test bewusst
   * OHNE auf das Netz zu warten.
   */
  it('holt den Verlauf im Voraus und zeigt ihn beim Klick sofort', async () => {
    const wrapper = await mountHistory()

    expect(pageVersions).toHaveBeenCalledWith('p1')
    expect(eintraege(wrapper)).toHaveLength(0)

    await openSofort(wrapper)

    expect(eintraege(wrapper)).toHaveLength(3)
  })

  /**
   * Und er laesst sich von aussen nachziehen - genau das ruft der Canvas auf,
   * bevor er „Gespeichert" meldet.
   */
  it('zieht sich auf Zuruf nach, ohne die vorhandene Liste zu leeren', async () => {
    const wrapper = await open(await mountHistory())
    server.verlauf[4] = konfig(4)

    const laeuft = wrapper.vm.reload()
    expect(eintraege(wrapper)).toHaveLength(3)
    await laeuft
    await flushPromises()

    expect(eintraege(wrapper)).toHaveLength(4)
  })

  it('listet die Versionen mit der neuesten zuerst', async () => {
    const wrapper = await open(await mountHistory())

    expect(eintraege(wrapper).map((e) => e.attributes('data-revision'))).toEqual(['3', '2', '1'])
    expect(eintraege(wrapper)[0].text()).toContain('Version 3')
  })

  it('nennt den zuletzt gespeicherten Stand als solchen', async () => {
    const wrapper = await open(await mountHistory())

    expect(eintraege(wrapper)[0].text()).toContain('Zuletzt gespeichert')
    expect(eintraege(wrapper)[1].text()).not.toContain('Zuletzt gespeichert')
  })

  it('nennt den Urheber einer Version, wenn die Zeile einen traegt', async () => {
    const wrapper = await open(await mountHistory())

    expect(eintraege(wrapper)[0].text()).toContain('admin')
  })

  it('kommt ohne Urheber aus - eine Zeile ohne den Namen bleibt lesbar', async () => {
    pageVersions.mockResolvedValue({
      data: [{ revision: 1, created_at: '2026-09-01T10:00:00+00:00', created_by: null }],
    })
    const wrapper = await open(await mountHistory())

    expect(eintraege(wrapper)).toHaveLength(1)
    expect(eintraege(wrapper)[0].text()).not.toContain('null')
  })

  it('sagt es, wenn eine Seite noch keinen Verlauf hat', async () => {
    pageVersions.mockResolvedValue({ data: [] })
    const wrapper = await open(await mountHistory())

    expect(eintraege(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('noch kein früherer Stand')
  })

  it('meldet einen Fehlschlag beim Laden, statt „kein Verlauf" vorzutaeuschen', async () => {
    pageVersions.mockRejectedValue(new Error('403'))
    const wrapper = await open(await mountHistory())

    expect(wrapper.find('[data-testid="editor-history-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('noch kein früherer Stand')
  })

  it('schliesst sich wieder', async () => {
    const wrapper = await open(await mountHistory())
    await byButton(wrapper, 'Verlauf').trigger('click')
    await flushPromises()

    expect(eintraege(wrapper)).toHaveLength(0)
  })

  /* ------------------------------------------------------------ Wiederherstellen */

  it('schreibt beim Wiederherstellen GENAU den alten Stand auf die Seite', async () => {
    const wrapper = await open(await mountHistory())

    await eintraege(wrapper)[2].find('button').trigger('click')
    await flushPromises()

    expect(pageVersion).toHaveBeenCalledWith('p1', 1)
    expect(savePage).toHaveBeenCalledWith('p1', konfig(1))
    expect(server.seite.widgets[0].x).toBe(1)
  })

  /**
   * Die Reihenfolge der Meldungen ist tragend, nicht Kosmetik: der Editor
   * blendet den Canvas ab, SOLANGE wiederhergestellt wird. Ohne ein Signal
   * VOR der ersten Anfrage stuende der alte Stand noch auf dem Schirm,
   * waehrend die Seite darunter schon eine andere ist.
   */
  it('meldet den Beginn, bevor die erste Anfrage laeuft', async () => {
    const wrapper = await open(await mountHistory())
    let startsBeimLesen = null
    pageVersion.mockImplementation(async () => {
      startsBeimLesen = (wrapper.emitted('restore-start') ?? []).length
      return { data: konfig(1) }
    })

    await eintraege(wrapper)[2].find('button').trigger('click')
    await flushPromises()

    expect(startsBeimLesen).toBe(1)
    expect(wrapper.emitted('restore-start')).toHaveLength(1)
  })

  it('meldet den Erfolg erst, nachdem die Seite zurueckgelesen wurde', async () => {
    const wrapper = await open(await mountHistory())

    await eintraege(wrapper)[2].find('button').trigger('click')
    await flushPromises()

    expect(getPage).toHaveBeenCalledWith('p1')
    expect(wrapper.emitted('restored')).toEqual([[{ ok: true }]])
  })

  /**
   * Die Luecke aus Runde 1 des Canvas, hier gar nicht erst aufgemacht: ein
   * `savePage`, dem der Server folgt, ohne den Stand zu tragen, ist KEIN Erfolg.
   */
  it('meldet keinen Erfolg, wenn der Server danach etwas anderes traegt', async () => {
    const wrapper = await open(await mountHistory())
    getPage.mockResolvedValue({ data: konfig(99) })

    await eintraege(wrapper)[2].find('button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('restored')).toEqual([[{ ok: false }]])
    expect(wrapper.find('[data-testid="editor-history-error"]').exists()).toBe(true)
  })

  it('meldet einen abgelehnten Schreibvorgang als Fehlschlag', async () => {
    const wrapper = await open(await mountHistory())
    server.saveFails = true

    await eintraege(wrapper)[2].find('button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('restored')).toEqual([[{ ok: false }]])
    expect(wrapper.find('[data-testid="editor-history-error"]').exists()).toBe(true)
  })

  it('meldet einen Fehlschlag auch, wenn der alte Stand gar nicht lesbar ist', async () => {
    const wrapper = await open(await mountHistory())
    pageVersion.mockRejectedValue(new Error('404'))

    await eintraege(wrapper)[2].find('button').trigger('click')
    await flushPromises()

    expect(savePage).not.toHaveBeenCalled()
    expect(wrapper.emitted('restored')).toEqual([[{ ok: false }]])
  })

  it('frischt den Verlauf nach dem Wiederherstellen auf - er ist um einen Stand laenger', async () => {
    const wrapper = await open(await mountHistory())

    await eintraege(wrapper)[2].find('button').trigger('click')
    await flushPromises()

    expect(eintraege(wrapper)).toHaveLength(4)
    expect(eintraege(wrapper)[0].attributes('data-revision')).toBe('4')
  })

  it('haengt am Wechsel der Seite: eine andere Seite hat einen anderen Verlauf', async () => {
    const wrapper = await open(await mountHistory())
    expect(eintraege(wrapper)).toHaveLength(3)

    await wrapper.setProps({ pageId: 'p2' })
    await flushPromises()

    // Zugeklappt (die offene Liste gehoerte zur vorigen Seite) und neu geholt.
    expect(eintraege(wrapper)).toHaveLength(0)
    expect(pageVersions).toHaveBeenLastCalledWith('p2')
    await openSofort(wrapper)
    expect(eintraege(wrapper)).toHaveLength(3)
  })

  it('bietet ohne Seite gar keinen Verlauf an - und fragt auch nicht nach', async () => {
    const wrapper = await mountHistory({ pageId: null })

    expect(byButton(wrapper, 'Verlauf')).toBeNull()
    expect(pageVersions).not.toHaveBeenCalled()
  })
})
