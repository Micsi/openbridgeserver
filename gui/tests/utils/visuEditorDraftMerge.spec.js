import { describe, expect, it } from 'vitest'

import { mergePreviewDrafts } from '@/utils/visuEditorDraftMerge'

/**
 * Der Zusammenleger der beiden Editor-Entwuerfe (Integration M5 C1/C2/C3).
 *
 * Gepinnt wird die ZUSTAENDIGKEIT, nicht die Form: welche Haelfte bei welchem
 * Belang gewinnt. Genau daran entscheidet sich, ob nach dem Merge noch beide
 * Teile wirken - der Autorenteil (Bindung, Sichtbarkeitsregel, frisch gesetzte
 * Elemente) und der Canvas (Lage, Modus, Ausblenden, Layer). Eine Regression
 * hier waere im Browser eine Vorschau, die eine der beiden Haelften vergisst,
 * und in den Messlatten E1/E2/E4/E8 gegen E10/E11/E16 ein Patt.
 */

const box = (id, x, y) => ({ id, name: id, type: 'Licht', x, y, w: 2, h: 2 })

/** Der Entwurf des Autorenteils: Bindung und Regel, KEINE verlaessliche Lage. */
function autoren(overrides = {}) {
  return {
    skin: 'edomi',
    pageId: 'seite-1',
    nodes: [
      {
        id: 'seite-1',
        name: 'M5 Seite',
        kind: 'normal',
        page_config: {
          layout_mode: 'pixel',
          grid: 8,
          includes: ['inc-1'],
          ignore_global_includes: false,
          widgets: [
            {
              id: 'w1',
              name: 'Licht',
              type: 'Licht',
              datapoint_id: 'dp-1',
              config: { visible_when: { datapoint_id: 'dp-9', op: 'eq', value: 1 } },
              x: 0,
              y: 0,
              w: 2,
              h: 2,
            },
            { id: 'w2', name: 'Frisch', type: 'Licht', config: {} },
          ],
        },
      },
      { id: 'inc-1', name: 'Include', kind: 'include', page_config: { widgets: [] } },
    ],
    ...overrides,
  }
}

/** Der Entwurf des Canvas: Lage und Modus, KEINE Bindung. */
function canvas(overrides = {}) {
  return {
    skin: 'edomi',
    pageId: 'seite-1',
    nodes: [
      {
        id: 'seite-1',
        name: 'M5 Seite',
        kind: 'normal',
        page_config: {
          layout_mode: 'responsive',
          grid: 16,
          breakpoints: [480, 768],
          includes: ['inc-1'],
          ignore_global_includes: false,
          widgets: [box('w1', 40, 24)],
        },
      },
    ],
    ...overrides,
  }
}

const seite = (draft) => draft.nodes.find((n) => n.id === draft.pageId)

describe('mergePreviewDrafts - beide Haelften des Editors', () => {
  it('gibt die vorhandene Haelfte zurueck, wenn die andere fehlt', () => {
    expect(mergePreviewDrafts(autoren(), null)).toEqual(autoren())
    expect(mergePreviewDrafts(null, canvas())).toEqual(canvas())
    expect(mergePreviewDrafts(null, null)).toBeNull()
  })

  it('nimmt den Canvas, solange der Autorenteil noch auf der alten Seite steht', () => {
    const alt = autoren({ pageId: 'seite-0' })
    expect(mergePreviewDrafts(alt, canvas()).pageId).toBe('seite-1')
  })

  it('behaelt Bindung und Sichtbarkeitsregel des Autorenteils (C3/E11/E16)', () => {
    const w1 = seite(mergePreviewDrafts(autoren(), canvas())).page_config.widgets[0]
    expect(w1.datapoint_id).toBe('dp-1')
    expect(w1.config.visible_when).toEqual({ datapoint_id: 'dp-9', op: 'eq', value: 1 })
  })

  it('nimmt Lage und Layout-Modus vom Canvas (C2/E1/E2)', () => {
    const config = seite(mergePreviewDrafts(autoren(), canvas())).page_config
    expect(config.layout_mode).toBe('responsive')
    expect(config.grid).toBe(16)
    expect(config.breakpoints).toEqual([480, 768])
    expect(config.widgets[0]).toMatchObject({ id: 'w1', x: 40, y: 24, w: 2, h: 2 })
  })

  /**
   * Die Koordinaten bleiben auch im responsiven Modus stehen (R17): der Host
   * entscheidet an `layout_mode`, ob sie wirken - nicht der Editor, und schon
   * gar nicht dieser Zusammenleger.
   */
  it('loescht im responsiven Modus keine Koordinate', () => {
    const config = seite(mergePreviewDrafts(autoren(), canvas())).page_config
    expect(config.layout_mode).toBe('responsive')
    expect(config.widgets[0].x).toBe(40)
  })

  it('laesst ein frisch gesetztes Element stehen, das der Canvas noch nicht kennt', () => {
    const ids = seite(mergePreviewDrafts(autoren(), canvas())).page_config.widgets.map((w) => w.id)
    expect(ids).toEqual(['w1', 'w2'])
  })

  it('nimmt eine ausgeblendete Kachel aus dem Entwurf (C2/E8)', () => {
    const zusammen = mergePreviewDrafts(autoren(), canvas(), { hiddenIds: ['w1'] })
    expect(seite(zusammen).page_config.widgets.map((w) => w.id)).toEqual(['w2'])
  })

  it('behaelt die Seiteneigenschaften des Autorenteils (C1: Skin, Name, Zugriff)', () => {
    const basis = autoren()
    basis.skin = 'terminal'
    seite(basis).access = 'admin'
    const zusammen = mergePreviewDrafts(basis, canvas())
    expect(zusammen.skin).toBe('terminal')
    expect(seite(zusammen).access).toBe('admin')
  })

  it('behaelt die Include-Knoten des Autorenteils', () => {
    expect(mergePreviewDrafts(autoren(), canvas()).nodes.map((n) => n.id)).toEqual([
      'seite-1',
      'inc-1',
    ])
  })

  /**
   * Die Layer-Schalter des Canvas nehmen ADDITIV weg. Sie koennen einen Layer
   * nie hinzufuegen - deshalb oder-verknuepft und deshalb leert eine leere
   * Include-Liste des Canvas auch die gemeinsame.
   */
  it('nimmt Layer weg, wenn der Canvas sie ausblendet', () => {
    const ohneGlobale = canvas()
    seite(ohneGlobale).page_config.ignore_global_includes = true
    expect(seite(mergePreviewDrafts(autoren(), ohneGlobale)).page_config.ignore_global_includes).toBe(
      true,
    )

    const ohneIncludes = canvas()
    seite(ohneIncludes).page_config.includes = []
    expect(seite(mergePreviewDrafts(autoren(), ohneIncludes)).page_config.includes).toEqual([])
  })

  it('fuegt keinen Layer hinzu, den der Autorenteil ausgeblendet hat', () => {
    const basis = autoren()
    seite(basis).page_config.ignore_global_includes = true
    expect(seite(mergePreviewDrafts(basis, canvas())).page_config.ignore_global_includes).toBe(true)
  })

  /** Ein Vue-Proxy scheitert im `postMessage` der Bruecke mit „could not be cloned". */
  it('liefert reine Daten', () => {
    const zusammen = mergePreviewDrafts(autoren(), canvas())
    expect(() => structuredClone(zusammen)).not.toThrow()
  })
})
