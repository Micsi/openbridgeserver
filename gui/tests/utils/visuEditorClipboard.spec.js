import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CLIPBOARD_KEY,
  clearClipboard,
  readClipboard,
  writeClipboard,
} from '@/utils/visuEditorClipboard'

/**
 * Die Zwischenablage des V2-Editors (M5 C5, Issue #172 - Messlatte E6).
 *
 * SIE MUSS EINEN SEITENWECHSEL UEBERLEBEN. Das Szenario kopiert auf der einen
 * Seite, laedt dann per `page.goto` eine ANDERE Seite - also ein neues Dokument -
 * und fuegt dort ein. Ein Modulzustand waere damit weg; der Traeger ist deshalb
 * der `localStorage`.
 *
 * UND SIE MUSS OHNE IHN AUSKOMMEN. Ein Browser ohne Speicherzugriff (privater
 * Modus, gesperrte Herkunft) wirft beim Schreiben. Kopieren und Einfuegen auf
 * DERSELBEN Seite duerfen daran nicht scheitern - der Seitenwechsel dann schon,
 * und genau das meldet {@link writeClipboard} als `false`.
 */

beforeEach(() => {
  clearClipboard()
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const widget = (id, x) => ({ id, name: `Kachel ${id}`, x, y: 0, w: 10, h: 10, config: {} })

describe('writeClipboard / readClipboard', () => {
  it('liest zurueck, was geschrieben wurde', () => {
    expect(writeClipboard([widget('a', 1), widget('b', 2)])).toBe(true)
    expect(readClipboard().map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('legt den Inhalt im localStorage ab, damit er einen Seitenwechsel uebersteht', () => {
    writeClipboard([widget('a', 1)])
    expect(window.localStorage.getItem(CLIPBOARD_KEY)).toContain('"a"')
  })

  it('gibt bei jedem Lesen eine eigene Kopie heraus', () => {
    writeClipboard([widget('a', 1)])
    const erste = readClipboard()
    erste[0].x = 999
    expect(readClipboard()[0].x).toBe(1)
  })

  it('ist ohne vorheriges Kopieren leer', () => {
    expect(readClipboard()).toEqual([])
  })

  it('schreibt nichts, wenn nichts kopiert wird, und leert dabei nicht die Ablage', () => {
    writeClipboard([widget('a', 1)])
    expect(writeClipboard([])).toBe(false)
    expect(readClipboard().map((w) => w.id)).toEqual(['a'])
  })

  it('haelt kaputten Inhalt fuer leer, statt daran zu scheitern', () => {
    window.localStorage.setItem(CLIPBOARD_KEY, '{kein json')
    expect(readClipboard()).toEqual([])
  })

  it('haelt fremden, aber gueltigen JSON-Inhalt fuer leer', () => {
    window.localStorage.setItem(CLIPBOARD_KEY, '{"version":1,"widgets":"nichts"}')
    expect(readClipboard()).toEqual([])
  })

  it('nimmt nur Eintraege mit einer Id - eine Kachel ohne Id ist keine', () => {
    window.localStorage.setItem(
      CLIPBOARD_KEY,
      JSON.stringify({ version: 1, widgets: [{ name: 'ohne Id' }, widget('a', 1)] }),
    )
    expect(readClipboard().map((w) => w.id)).toEqual(['a'])
  })

  it('leert die Ablage auf Wunsch - im Speicher UND im localStorage', () => {
    writeClipboard([widget('a', 1)])
    clearClipboard()
    expect(readClipboard()).toEqual([])
    expect(window.localStorage.getItem(CLIPBOARD_KEY)).toBeNull()
  })
})

describe('ohne Speicherzugriff', () => {
  /**
   * Eine Attrappe, die sich wie ein GESPERRTER Speicher verhaelt: sie wirft,
   * und zwar bei jedem Zugriff. Ein Doppel, das still `undefined` liefert,
   * haette genau den Fehler verdeckt, um den es hier geht.
   */
  const gesperrterSpeicher = {
    getItem() {
      throw new Error('storage gesperrt')
    },
    setItem() {
      throw new Error('storage gesperrt')
    },
    removeItem() {
      throw new Error('storage gesperrt')
    },
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('meldet den Fehlschlag und haelt den Inhalt trotzdem fuer DIESE Sitzung', () => {
    vi.stubGlobal('localStorage', gesperrterSpeicher)
    expect(writeClipboard([widget('a', 1)])).toBe(false)
    expect(readClipboard().map((w) => w.id)).toEqual(['a'])
  })

  it('scheitert auch beim Lesen nicht, sondern liefert die leere Ablage', () => {
    vi.stubGlobal('localStorage', gesperrterSpeicher)
    expect(readClipboard()).toEqual([])
  })
})
