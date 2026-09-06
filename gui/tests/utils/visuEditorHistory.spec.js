import { describe, it, expect } from 'vitest'
import {
  HISTORY_LIMIT,
  createHistory,
  recordChange,
  redoTo,
  snapshotOf,
  undoTo,
} from '@/utils/visuEditorHistory'

/**
 * Der Undo-/Redo-Stapel des V2-Editors (M5 C5, Issue #172 - Messlatte E7).
 *
 * Die Zeile verlangt, dass Undo den vorigen Zustand EXAKT wiederherstellt und
 * Redo ihn wieder aufhebt. „Exakt" heisst hier: derselbe Wert, und keine
 * gemeinsame Referenz - ein Stapel, der auf dieselben Objekte zeigt wie der
 * Editor, waere nach der naechsten Aenderung stillschweigend mitgewandert und
 * haette beim Zuruecknehmen genau den Stand geliefert, von dem man wegwollte.
 */

const widget = (id, x, y) => ({ id, name: `Kachel ${id}`, x, y, w: 10, h: 10, config: {} })

const stand = (widgets, selectedIds = []) => snapshotOf(widgets, selectedIds)

describe('snapshotOf - der festgehaltene Zustand', () => {
  it('haelt Elemente und Auswahl fest', () => {
    const s = stand([widget('a', 1, 2)], ['a'])
    expect(s.widgets).toEqual([widget('a', 1, 2)])
    expect(s.selectedIds).toEqual(['a'])
  })

  it('kopiert TIEF: eine spaetere Aenderung am Original faerbt nicht ab', () => {
    const list = [widget('a', 1, 2)]
    const s = stand(list, ['a'])
    list[0].x = 999
    list[0].config.editor = { locked: true }
    expect(s.widgets[0].x).toBe(1)
    expect(s.widgets[0].config).toEqual({})
  })

  it('gibt bei jedem Lesen eine eigene Kopie heraus, nicht denselben Speicher', () => {
    const s = stand([widget('a', 1, 2)])
    const history = createHistory()
    recordChange(history, s)
    const erste = undoTo(history, stand([widget('a', 5, 5)]))
    erste.widgets[0].x = 42
    expect(s.widgets[0].x).toBe(1)
  })
})

describe('Undo und Redo - der Stapel', () => {
  it('gibt ohne Aufzeichnung nichts zurueck', () => {
    const history = createHistory()
    expect(undoTo(history, stand([widget('a', 0, 0)]))).toBeNull()
    expect(redoTo(history, stand([widget('a', 0, 0)]))).toBeNull()
  })

  it('stellt den vorigen Zustand EXAKT wieder her', () => {
    const history = createHistory()
    recordChange(history, stand([widget('a', 0, 0)], ['a']))
    const jetzt = stand([widget('a', 1, 0)], ['a'])
    expect(undoTo(history, jetzt).widgets[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('nimmt drei Schritte einzeln zurueck, nicht in einem Rutsch', () => {
    const history = createHistory()
    let jetzt = stand([widget('a', 0, 0)])
    for (const x of [1, 2, 3]) {
      recordChange(history, jetzt)
      jetzt = stand([widget('a', x, 0)])
    }
    expect(undoTo(history, jetzt).widgets[0].x).toBe(2)
    expect(undoTo(history, stand([widget('a', 2, 0)])).widgets[0].x).toBe(1)
    expect(undoTo(history, stand([widget('a', 1, 0)])).widgets[0].x).toBe(0)
    expect(undoTo(history, stand([widget('a', 0, 0)]))).toBeNull()
  })

  it('hebt ein Undo per Redo wieder auf', () => {
    const history = createHistory()
    recordChange(history, stand([widget('a', 0, 0)]))
    const jetzt = stand([widget('a', 1, 0)])
    expect(undoTo(history, jetzt).widgets[0].x).toBe(0)
    expect(redoTo(history, stand([widget('a', 0, 0)])).widgets[0].x).toBe(1)
  })

  it('stellt auch die AUSWAHL wieder her, damit der Anfasser nicht verschwindet', () => {
    const history = createHistory()
    recordChange(history, stand([widget('a', 0, 0)], ['a']))
    expect(undoTo(history, stand([widget('a', 1, 0)], ['a'])).selectedIds).toEqual(['a'])
  })

  it('verwirft die Zukunft, sobald nach einem Undo neu geaendert wird', () => {
    const history = createHistory()
    recordChange(history, stand([widget('a', 0, 0)]))
    undoTo(history, stand([widget('a', 1, 0)]))
    expect(history.future).toHaveLength(1)
    recordChange(history, stand([widget('a', 0, 0)]))
    expect(history.future).toHaveLength(0)
  })

  it('haelt den Stapel bei der Obergrenze und wirft den AELTESTEN weg', () => {
    const history = createHistory()
    for (let i = 0; i <= HISTORY_LIMIT + 4; i += 1) recordChange(history, stand([widget('a', i, 0)]))
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    expect(history.past[0].widgets[0].x).toBe(5)
  })

  it('zaehlt jede Aufzeichnung, auch eine unveraenderte - der Aufrufer entscheidet', () => {
    const history = createHistory()
    recordChange(history, stand([widget('a', 0, 0)]))
    recordChange(history, stand([widget('a', 0, 0)]))
    expect(history.past).toHaveLength(2)
  })
})
