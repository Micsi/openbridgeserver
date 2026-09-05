import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BOX,
  DEFAULT_GRID,
  bringToFront,
  distributeHorizontally,
  ensureBoxes,
  guidesFor,
  matchSize,
  moveItem,
  snapBox,
  snapSize,
  snapValue,
  sendToBack,
} from '@/utils/visuEditorLayout'

/**
 * Die Rechenregeln des WYSIWYG-Canvas (M5 C2, Issue #169) - ohne DOM, ohne Vue.
 *
 * Sie stehen getrennt von der Komponente, weil die Messlatte sie einzeln nennt:
 * **E1** (Snap an einstellbarer Rasterweite), **E4** (Ausrichtlinie bei
 * Kantendeckung, „Verteilen" ab drei Elementen, „gleiche Groesse") und **E8**
 * (Z-Ordnung). Eine Zahl, die hier falsch ist, ist im Browser nicht mehr
 * auffindbar - hier ist sie eine Zeile.
 *
 * Alle Koordinaten sind ganze Autoreneinheiten: das Backend-Modell
 * (`obs/models/visu.py` → `WidgetInstance.x/y/w/h`) traegt `int`, ein
 * gebrochener Wert waere also gar nicht speicherbar.
 */

const box = (id, x, y, w = 3, h = 2) => ({ id, x, y, w, h })

describe('snapValue - Raster mit einstellbarer Weite (E1)', () => {
  it('rastet auf das naechste Vielfache der Rasterweite ein', () => {
    expect(snapValue(47, 20)).toBe(40)
    expect(snapValue(33, 20)).toBe(40)
    expect(snapValue(50, 20)).toBe(60)
    expect(snapValue(-47, 20)).toBe(-40)
  })

  it('gibt bei Rasterweite 1 oder kleiner die gerundete Zahl zurueck', () => {
    expect(snapValue(47.4, 1)).toBe(47)
    expect(snapValue(47.6, 0)).toBe(48)
    expect(snapValue(47.6, -5)).toBe(48)
  })

  it('rechnet absolut, nicht relativ zum Startpunkt', () => {
    // Ein Element, das krumm liegt, landet nach dem Ziehen AUF dem Raster.
    expect(snapValue(7 + 47, 20)).toBe(60)
    expect(snapValue(7 + 47, 20) % 20).toBe(0)
  })

  it('haelt eine Vorgabe fuer die Rasterweite bereit', () => {
    expect(DEFAULT_GRID).toBeGreaterThan(0)
    expect(Number.isInteger(DEFAULT_GRID)).toBe(true)
  })
})

describe('snapBox - die verschobene Kachel (E1)', () => {
  it('verschiebt um dx/dy und rastet das Ergebnis ein', () => {
    expect(snapBox(box('a', 0, 0), 47, 33, 20)).toEqual({ x: 40, y: 40 })
  })

  it('laesst Breite und Hoehe unberuehrt', () => {
    const moved = snapBox(box('a', 0, 0, 3, 2), 47, 33, 20)
    expect(moved.w).toBeUndefined()
    expect(moved.h).toBeUndefined()
  })

  it('geht nie ins Negative - der Canvas hat einen Ursprung', () => {
    expect(snapBox(box('a', 0, 0), -100, -100, 20)).toEqual({ x: 0, y: 0 })
  })
})

describe('guidesFor - Ausrichtlinie bei Kantendeckung <=4px (E4)', () => {
  const boxes = [box('a', 0, 0), box('b', 4, 0), box('c', 4, 40)]

  it('meldet eine senkrechte Linie, wenn linke Kanten aufeinanderliegen', () => {
    const guides = guidesFor(boxes, 'c', 4)
    expect(guides).toContainEqual({ axis: 'x', at: 4 })
  })

  it('meldet eine waagerechte Linie, wenn obere Kanten aufeinanderliegen', () => {
    const guides = guidesFor([box('a', 0, 0), box('b', 40, 3)], 'b', 4)
    expect(guides).toContainEqual({ axis: 'y', at: 0 })
  })

  it('schweigt jenseits der Toleranz', () => {
    expect(guidesFor([box('a', 0, 0), box('b', 40, 9)], 'b', 4)).toEqual([])
  })

  it('vergleicht auch rechte/untere Kanten und die Mitten', () => {
    // b endet rechts bei 3+3=6, a endet rechts bei 0+3=3 -> keine Deckung.
    // c beginnt bei 3, endet bei 6: Deckung der rechten Kanten mit b.
    const guides = guidesFor([box('a', 0, 0), box('b', 3, 20), box('c', 3, 40)], 'c', 0)
    expect(guides).toContainEqual({ axis: 'x', at: 3 })
    expect(guides).toContainEqual({ axis: 'x', at: 6 })
  })

  it('kennt kein aktives Element, kein Element, keine Linie', () => {
    expect(guidesFor(boxes, 'gibt-es-nicht', 4)).toEqual([])
    expect(guidesFor([], 'a', 4)).toEqual([])
  })

  it('meldet jede Linie nur einmal, auch wenn drei Kanten sie treffen', () => {
    const many = [box('a', 4, 0), box('b', 4, 20), box('c', 4, 40), box('d', 4, 60)]
    const xs = guidesFor(many, 'd', 4).filter((g) => g.axis === 'x' && g.at === 4)
    expect(xs).toHaveLength(1)
  })
})

describe('distributeHorizontally - „Verteilen" ab drei Elementen (E4)', () => {
  it('verweigert die Arbeit bei weniger als drei Elementen', () => {
    expect(distributeHorizontally([box('a', 0, 0), box('b', 10, 0)], ['a', 'b'])).toBeNull()
    expect(distributeHorizontally([box('a', 0, 0)], ['a'])).toBeNull()
  })

  it('macht die Abstaende exakt gleich - und zwar in ganzen Einheiten', () => {
    const boxes = [box('a', 0, 0), box('b', 4, 0), box('c', 4, 2), box('d', 4, 4)]
    const next = distributeHorizontally(boxes, ['a', 'b', 'c', 'd'])
    const xs = boxes.map((b) => next[b.id])
    expect(xs.every(Number.isInteger)).toBe(true)
    const gaps = xs.slice(1).map((x, i) => x - xs[i])
    expect(new Set(gaps).size).toBe(1)
  })

  it('laesst den linken Anker stehen', () => {
    const boxes = [box('a', 10, 0), box('b', 40, 0), box('c', 100, 0)]
    const next = distributeHorizontally(boxes, ['a', 'b', 'c'])
    expect(next.a).toBe(10)
    expect(next.b - next.a).toBe(next.c - next.b)
  })

  it('verteilt in der Reihenfolge der Seite, nicht nach der Zufallslage', () => {
    // Die Reihenfolge der Widget-Liste ist der Boden (§2.1) und zugleich die
    // Z-Ordnung; E4 misst die Abstaende genau in dieser Reihenfolge. Nach der
    // aktuellen X-Lage zu verteilen haette Abstaende, die von der Vorgeschichte
    // der Seite abhaengen - mal gleich, mal nicht.
    const boxes = [box('a', 100, 0), box('b', 0, 0), box('c', 50, 0)]
    const next = distributeHorizontally(boxes, ['a', 'b', 'c'])
    expect(next.a).toBeLessThan(next.b)
    expect(next.b).toBeLessThan(next.c)
    expect(next.b - next.a).toBe(next.c - next.b)
  })

  it('haelt die Abstaende auch dann gleich, wenn die Liste nicht nach x sortiert ist', () => {
    const boxes = [box('a', 40, 0), box('b', 4, 0), box('c', 4, 2), box('d', 4, 4)]
    const next = distributeHorizontally(boxes, ['a', 'b', 'c', 'd'])
    const xs = boxes.map((b) => next[b.id])
    const gaps = xs.slice(1).map((x, i) => x - xs[i])
    expect(new Set(gaps).size).toBe(1)
  })

  it('ignoriert Namen, die es auf der Seite nicht gibt', () => {
    const boxes = [box('a', 0, 0), box('b', 4, 0), box('c', 8, 0)]
    expect(distributeHorizontally(boxes, ['a', 'b', 'fremd'])).toBeNull()
  })
})

describe('matchSize - „gleiche Groesse" (E4)', () => {
  it('uebertraegt die Masse des zuerst gewaehlten Elements', () => {
    const boxes = [box('a', 0, 0, 5, 7), box('b', 4, 0, 1, 1), box('c', 8, 0, 2, 2)]
    expect(matchSize(boxes, ['a', 'b', 'c'])).toEqual({
      a: { w: 5, h: 7 },
      b: { w: 5, h: 7 },
      c: { w: 5, h: 7 },
    })
  })

  it('braucht mindestens zwei Elemente', () => {
    expect(matchSize([box('a', 0, 0)], ['a'])).toBeNull()
    expect(matchSize([box('a', 0, 0)], [])).toBeNull()
  })
})

describe('Z-Ordnung und Reihenfolge (E2, E8)', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('bringToFront macht das Element zum letzten Kind', () => {
    expect(bringToFront(list, 'a').map((w) => w.id)).toEqual(['b', 'c', 'a'])
  })

  it('sendToBack macht das Element zum ersten Kind', () => {
    expect(sendToBack(list, 'c').map((w) => w.id)).toEqual(['c', 'a', 'b'])
  })

  it('laesst die Liste unberuehrt, wenn das Element schon dort steht', () => {
    expect(bringToFront(list, 'c').map((w) => w.id)).toEqual(['a', 'b', 'c'])
    expect(sendToBack(list, 'a').map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })

  it('kennt ein unbekanntes Element nicht und aendert dann nichts', () => {
    expect(bringToFront(list, 'x').map((w) => w.id)).toEqual(['a', 'b', 'c'])
    expect(sendToBack(list, 'x').map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })

  it('gibt immer eine neue Liste zurueck, nie die alte', () => {
    expect(bringToFront(list, 'a')).not.toBe(list)
    expect(sendToBack(list, 'a')).not.toBe(list)
  })

  it('moveItem setzt ein Element an eine andere Stelle (Drag im responsiven Modus)', () => {
    expect(moveItem(list, 2, 0).map((w) => w.id)).toEqual(['c', 'a', 'b'])
    expect(moveItem(list, 0, 2).map((w) => w.id)).toEqual(['b', 'c', 'a'])
    expect(moveItem(list, 1, 1).map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })

  it('moveItem laesst unmoegliche Indizes in Ruhe', () => {
    expect(moveItem(list, -1, 0).map((w) => w.id)).toEqual(['a', 'b', 'c'])
    expect(moveItem(list, 0, 9).map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('snapSize - Groesserziehen am Anfasser (E14, C2-Zeile „Drag/Resize")', () => {
  it('rastet die Masse auf die Rasterweite ein', () => {
    expect(snapSize({ w: 40, h: 40 }, 47, 33, 20)).toEqual({ w: 80, h: 80 })
  })

  it('laesst die Lage in Ruhe - der Anfasser zieht die Ecke, nicht die Kachel', () => {
    expect(snapSize({ x: 100, y: 100, w: 40, h: 40 }, 20, 20, 20)).toEqual({ w: 60, h: 60 })
  })

  it('geht nie unter eine Einheit, auch nicht bei grobem Raster', () => {
    expect(snapSize({ w: 40, h: 40 }, -400, -400, 20)).toEqual({ w: 1, h: 1 })
    expect(snapSize({ w: 4, h: 4 }, -4, -4, 20)).toEqual({ w: 1, h: 1 })
  })

  it('rundet ohne Raster nur', () => {
    expect(snapSize({ w: 10, h: 10 }, 7, 3, 1)).toEqual({ w: 17, h: 13 })
  })

  it('vertraegt eine Kachel ohne Masse', () => {
    expect(snapSize(null, 20, 20, 1)).toEqual({ w: 20, h: 20 })
  })
})

describe('ensureBoxes - eine Seite, die aus dem responsiven Modus kommt', () => {
  it('gibt jeder Kachel ohne Box die Vorgabe des Backend-Modells', () => {
    expect(ensureBoxes([{ id: 'a' }])).toEqual([{ id: 'a', ...DEFAULT_BOX }])
  })

  it('fuellt auch eine halbe Box auf, ohne die vorhandene Zahl zu verlieren', () => {
    expect(ensureBoxes([{ id: 'a', x: 40, y: null }])).toEqual([
      { id: 'a', x: 40, y: 0, w: 2, h: 2 },
    ])
  })

  it('laesst eine vollstaendige Box unangetastet', () => {
    expect(ensureBoxes([{ id: 'a', x: 4, y: 5, w: 6, h: 7 }])).toEqual([
      { id: 'a', x: 4, y: 5, w: 6, h: 7 },
    ])
  })

  it('gibt eine neue Liste zurueck und vertraegt Unsinn', () => {
    const list = [{ id: 'a', x: 1, y: 1, w: 1, h: 1 }]
    expect(ensureBoxes(list)).not.toBe(list)
    expect(ensureBoxes(null)).toEqual([])
  })
})
