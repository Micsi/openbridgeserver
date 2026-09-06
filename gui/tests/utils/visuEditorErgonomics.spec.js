import { describe, it, expect } from 'vitest'
import {
  copiesOf,
  expandToGroups,
  groupFrames,
  groupIdOf,
  idsInRect,
  newEditorId,
  normalizeRect,
  nudged,
  withGroup,
} from '@/utils/visuEditorErgonomics'
import { widgetFlags, withWidgetFlags } from '@/utils/visuEditorPage'

/**
 * Die Rechenregeln der Editor-Ergonomie (M5 C5, Issue #172).
 *
 * Diese Spec ist die Vitest-Haelfte der Abnahme von E5 (Rahmenauswahl,
 * Gruppenverschieben, Gruppieren), E6 (Kopieren, Einfuegen, Duplizieren) und
 * E7 (Nudging); die andere sind die Playwright-Szenarien E5/E6/E7/E14 in
 * `apps/visu/e2e/`. Was dort im Browser behauptet wird, steht hier als
 * Einzelfrage an eine reine Funktion - eine falsche Zahl ist damit eine Zeile
 * und keine Sitzung im Browser.
 */

const widget = (id, x, y, extra = {}) => ({
  id,
  name: `Kachel ${id}`,
  type: 'Toggle',
  datapoint_id: `dp-${id}`,
  status_datapoint_id: null,
  x,
  y,
  w: 10,
  h: 10,
  config: {},
  ...extra,
})

/** Ein Zaehler statt Zufall: die Erwartungen sollen die Ids nennen duerfen. */
function counter(prefix = 'neu') {
  let n = 0
  return () => `${prefix}-${++n}`
}

describe('normalizeRect - der aufgezogene Rahmen, in jeder Zugrichtung', () => {
  it('macht aus zwei Punkten eine Box mit nicht negativen Massen', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 50, y: 60 })).toEqual({ x: 10, y: 20, w: 40, h: 40 })
  })

  it('liefert dieselbe Box, wenn von rechts unten nach links oben gezogen wird', () => {
    expect(normalizeRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 40 })
  })

  it('haelt einen Rahmen ohne Ausdehnung aus, statt negative Masse zu liefern', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, w: 0, h: 0 })
  })
})

describe('idsInRect - der Rahmen trifft GENAU die umschlossenen Elemente', () => {
  const list = [widget('a', 0, 0), widget('b', 100, 0), widget('c', 100, 100)]

  it('waehlt jedes Element, das vollstaendig im Rahmen liegt', () => {
    expect(idsInRect(list, { x: -5, y: -5, w: 300, h: 300 })).toEqual(['a', 'b', 'c'])
  })

  it('laesst ein Element aus, das der Rahmen nur ANSCHNEIDET', () => {
    // Der Rahmen endet bei x=105, `b` reicht bis 110: nicht umschlossen.
    expect(idsInRect(list, { x: 0, y: 0, w: 105, h: 105 })).toEqual(['a'])
  })

  it('zaehlt Kantendeckung als umschlossen - der Rahmen endet genau auf der Kante', () => {
    expect(idsInRect(list, { x: 0, y: 0, w: 110, h: 10 })).toEqual(['a', 'b'])
  })

  it('liefert die Ids in der Reihenfolge der Seite, nicht in der des Zugs', () => {
    const rueckwaerts = [widget('c', 100, 100), widget('a', 0, 0)]
    expect(idsInRect(rueckwaerts, { x: -5, y: -5, w: 300, h: 300 })).toEqual(['c', 'a'])
  })

  it('waehlt bei einem Rahmen ohne Ausdehnung gar nichts', () => {
    expect(idsInRect(list, { x: 0, y: 0, w: 0, h: 0 })).toEqual([])
  })

  it('nimmt gesperrte und ausgeblendete Elemente mit - waehlen ist nicht aendern', () => {
    const marken = [
      widget('l', 0, 0, { config: { editor: { locked: true, hidden: false } } }),
      widget('h', 20, 0, { config: { editor: { locked: false, hidden: true } } }),
    ]
    expect(idsInRect(marken, { x: -5, y: -5, w: 300, h: 300 })).toEqual(['l', 'h'])
  })

  it('kommt mit einer Kachel ohne Box zurecht, statt sie mit NaN zu waehlen', () => {
    const ohne = [{ id: 'x', config: {} }, widget('a', 0, 0)]
    expect(idsInRect(ohne, { x: -5, y: -5, w: 300, h: 300 })).toEqual(['a'])
  })
})

describe('nudged - Pfeiltasten bewegen um GENAU einen Schritt', () => {
  it('bewegt jedes ausgewaehlte Element um dieselbe Distanz', () => {
    const list = [widget('a', 0, 0), widget('b', 100, 40), widget('c', 5, 5)]
    const { widgets, moved } = nudged(list, ['a', 'b'], 1, 0)
    expect(moved).toBe(true)
    expect(widgets.map((w) => [w.id, w.x, w.y])).toEqual([
      ['a', 1, 0],
      ['b', 101, 40],
      ['c', 5, 5],
    ])
  })

  it('rastet NICHT ein: ein Schritt ist ein Schritt, auch neben dem Raster', () => {
    const { widgets } = nudged([widget('a', 3, 3)], ['a'], 0, 1)
    expect(widgets[0]).toMatchObject({ x: 3, y: 4 })
  })

  it('laesst ein gesperrtes Element stehen und meldet, dass nichts geschah', () => {
    const gesperrt = [widget('a', 10, 10, { config: { editor: { locked: true } } })]
    const { widgets, moved } = nudged(gesperrt, ['a'], 1, 0)
    expect(moved).toBe(false)
    expect(widgets[0]).toMatchObject({ x: 10, y: 10 })
  })

  it('bewegt die ungesperrten einer gemischten Auswahl und laesst die gesperrten stehen', () => {
    const list = [widget('a', 10, 10, { config: { editor: { locked: true } } }), widget('b', 20, 20)]
    const { widgets, moved } = nudged(list, ['a', 'b'], -1, 0)
    expect(moved).toBe(true)
    expect(widgets.map((w) => w.x)).toEqual([10, 19])
  })

  it('haelt am Ursprung an, statt ins Negative zu laufen', () => {
    const { widgets } = nudged([widget('a', 0, 0)], ['a'], -1, -1)
    expect(widgets[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('laesst die Liste unangetastet und gibt eine neue zurueck', () => {
    const list = [widget('a', 0, 0)]
    const { widgets } = nudged(list, ['a'], 1, 0)
    expect(list[0].x).toBe(0)
    expect(widgets).not.toBe(list)
  })
})

describe('Gruppen - Zugehoerigkeit, Ausweitung der Auswahl, Rahmen', () => {
  it('liest die Gruppe eines Elements aus seinen Editor-Marken', () => {
    expect(groupIdOf(widget('a', 0, 0, { config: { editor: { group: 'g1' } } }))).toBe('g1')
    expect(groupIdOf(widget('a', 0, 0))).toBeNull()
  })

  it('setzt eine Gruppe, ohne die uebrigen Marken zu verlieren', () => {
    const start = widget('a', 0, 0, { config: { editor: { locked: true, hidden: true } } })
    const nachher = withGroup(start, 'g1')
    expect(nachher.config.editor).toEqual({ locked: true, hidden: true, group: 'g1' })
    expect(start.config.editor.group).toBeUndefined()
  })

  it('hebt die Gruppe mit `null` wieder auf', () => {
    const start = widget('a', 0, 0, { config: { editor: { group: 'g1', locked: true } } })
    expect(groupIdOf(withGroup(start, null))).toBeNull()
    expect(withGroup(start, null).config.editor.locked).toBe(true)
  })

  it('weitet die Auswahl auf die ganze Gruppe aus - ein Griff fasst alle', () => {
    const list = [
      widget('a', 0, 0, { config: { editor: { group: 'g1' } } }),
      widget('b', 20, 0, { config: { editor: { group: 'g1' } } }),
      widget('c', 40, 0),
    ]
    expect(expandToGroups(list, ['a'])).toEqual(['a', 'b'])
    expect(expandToGroups(list, ['c'])).toEqual(['c'])
  })

  it('liefert die ausgeweitete Auswahl in der Reihenfolge der Seite und ohne Dubletten', () => {
    const list = [
      widget('a', 0, 0, { config: { editor: { group: 'g1' } } }),
      widget('b', 20, 0),
      widget('c', 40, 0, { config: { editor: { group: 'g1' } } }),
    ]
    expect(expandToGroups(list, ['c', 'b', 'a'])).toEqual(['a', 'b', 'c'])
  })

  it('zieht je Gruppe genau EINEN Rahmen um alle ihre Elemente', () => {
    const list = [
      widget('a', 0, 0, { config: { editor: { group: 'g1' } } }),
      widget('b', 30, 40, { config: { editor: { group: 'g1' } } }),
      widget('c', 100, 0),
    ]
    expect(groupFrames(list)).toEqual([{ id: 'g1', x: 0, y: 0, w: 40, h: 50 }])
  })

  it('zieht keinen Rahmen, wo keine Gruppe ist', () => {
    expect(groupFrames([widget('a', 0, 0), widget('b', 30, 0)])).toEqual([])
  })

  it('laesst eine Kachel ohne Box aus dem Rahmen heraus, statt ihn auf NaN zu ziehen', () => {
    const list = [
      { id: 'x', config: { editor: { group: 'g1' } } },
      widget('b', 30, 40, { config: { editor: { group: 'g1' } } }),
    ]
    expect(groupFrames(list)).toEqual([{ id: 'g1', x: 30, y: 40, w: 10, h: 10 }])
  })
})

describe('Gruppe und Marken teilen sich einen Kasten', () => {
  it('ueberlebt einen Haken bei „Gesperrt" - die Gruppe geht dabei nicht verloren', () => {
    const start = withGroup(widget('a', 0, 0), 'g1')
    const gesperrt = withWidgetFlags(start, { locked: true })
    expect(groupIdOf(gesperrt)).toBe('g1')
    expect(widgetFlags(gesperrt)).toEqual({ locked: true, hidden: false })
  })

  it('und umgekehrt: eine Gruppierung hebt keine Sperre auf', () => {
    const gesperrt = withWidgetFlags(widget('a', 0, 0), { locked: true })
    expect(widgetFlags(withGroup(gesperrt, 'g1'))).toEqual({ locked: true, hidden: false })
  })
})

describe('copiesOf - Duplizieren und Einfuegen', () => {
  it('gibt jeder Kopie eine frische Id und behaelt den Namen', () => {
    const list = [widget('a', 0, 0)]
    const kopien = copiesOf(list, ['a'], { newId: counter() })
    expect(kopien).toHaveLength(1)
    expect(kopien[0].id).toBe('neu-1')
    expect(kopien[0].name).toBe('Kachel a')
    expect(kopien[0].datapoint_id).toBe('dp-a')
  })

  it('versetzt die Kopie um den gewuenschten Betrag', () => {
    const kopien = copiesOf([widget('a', 10, 20)], ['a'], { offset: 8, newId: counter() })
    expect(kopien[0]).toMatchObject({ x: 18, y: 28 })
  })

  it('kopiert die Auswahl in der Reihenfolge der Seite', () => {
    const list = [widget('a', 0, 0), widget('b', 20, 0), widget('c', 40, 0)]
    const kopien = copiesOf(list, ['c', 'a'], { newId: counter() })
    expect(kopien.map((w) => w.name)).toEqual(['Kachel a', 'Kachel c'])
  })

  it('teilt keine Konfiguration mit dem Original', () => {
    const list = [widget('a', 0, 0, { config: { editor: { locked: true } } })]
    const kopien = copiesOf(list, ['a'], { newId: counter() })
    expect(kopien[0].config).toEqual({ editor: { locked: true } })
    expect(kopien[0].config).not.toBe(list[0].config)
    kopien[0].config.editor.locked = false
    expect(list[0].config.editor.locked).toBe(true)
  })

  it('gibt kopierten Gruppen eine NEUE Gruppe - die Kopie tritt nicht dem Original bei', () => {
    const list = [
      widget('a', 0, 0, { config: { editor: { group: 'g1' } } }),
      widget('b', 20, 0, { config: { editor: { group: 'g1' } } }),
    ]
    const kopien = copiesOf(list, ['a', 'b'], { newId: counter() })
    const gruppen = kopien.map(groupIdOf)
    expect(gruppen[0]).toBe(gruppen[1])
    expect(gruppen[0]).not.toBe('g1')
    expect(gruppen[0]).toBeTruthy()
  })

  it('haelt zwei kopierte Gruppen auseinander', () => {
    const list = [
      widget('a', 0, 0, { config: { editor: { group: 'g1' } } }),
      widget('b', 20, 0, { config: { editor: { group: 'g2' } } }),
    ]
    const gruppen = copiesOf(list, ['a', 'b'], { newId: counter() }).map(groupIdOf)
    expect(gruppen[0]).not.toBe(gruppen[1])
  })

  it('kopiert nichts, wenn nichts ausgewaehlt ist', () => {
    expect(copiesOf([widget('a', 0, 0)], [], { newId: counter() })).toEqual([])
  })

  it('haelt die Kopie am Ursprung fest, statt sie mit negativem Versatz zu verlieren', () => {
    const kopien = copiesOf([widget('a', 0, 0)], ['a'], { offset: -20, newId: counter() })
    expect(kopien[0]).toMatchObject({ x: 0, y: 0 })
  })
})

describe('newEditorId - Ids fuer Kopien und Gruppen', () => {
  it('liefert nicht leere, voneinander verschiedene Zeichenketten', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newEditorId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(typeof id === 'string' && id.length > 0).toBe(true)
  })
})
