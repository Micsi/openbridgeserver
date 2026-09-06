import { describe, it, expect } from 'vitest'

import { parseEditorJson, sameConfig, toEditorJson } from '@/utils/visuPageJson'

/**
 * Die Textseite der Dualitaet (M5 C6, Issue #173, Messlatte E13).
 *
 * Hier liegt die REGEL, nicht die Ansicht: was aus der Seite ein Textdokument
 * macht, und was aus einem Textdokument wieder eine Seite - und vor allem, was
 * NICHT durchgelassen wird. Die Ansicht (Reiter, Textfeld) haengt im Canvas und
 * hat davon nichts zu entscheiden.
 *
 * Der wichtigste Satz dieser Datei steht in den Ablehnungen: ungueltiger Text
 * wird ABGEFANGEN, nicht gespeichert. Ein Editor, der eine halb getippte
 * Klammer an den Canvas durchreicht, macht aus einer Bearbeitung einen
 * Datenverlust.
 */
describe('visuPageJson', () => {
  const seite = () => ({
    grid_cols: 12,
    grid_row_height: 80,
    grid_cell_width: 80,
    background: null,
    widgets: [{ id: 'w-1', name: 'Kachel', type: 'Toggle', x: 3, y: 4, w: 2, h: 2, config: {} }],
    includes: [],
    ignore_global_includes: false,
    popup: null,
    layout_mode: 'pixel',
    grid: 8,
    breakpoints: [480],
    skin: null,
  })

  describe('toEditorJson', () => {
    it('schreibt die Seite als lesbares JSON-Dokument', () => {
      const text = toEditorJson(seite())

      expect(JSON.parse(text)).toEqual(seite())
      expect(text).toContain('\n  ') // eingerueckt, nicht eine einzige Zeile
    })

    it('macht aus „keine Seite" ein leeres Dokument statt „null"', () => {
      expect(toEditorJson(null)).toBe('')
      expect(toEditorJson(undefined)).toBe('')
    })
  })

  describe('parseEditorJson', () => {
    it('nimmt ein gueltiges Dokument an und gibt die Seite zurueck', () => {
      const ergebnis = parseEditorJson(toEditorJson(seite()))

      expect(ergebnis.ok).toBe(true)
      expect(ergebnis.config.widgets[0].x).toBe(3)
    })

    it('lehnt kaputtes JSON ab, statt es weiterzureichen', () => {
      const ergebnis = parseEditorJson('{ "widgets": [')

      expect(ergebnis.ok).toBe(false)
      expect(ergebnis.reason).toBe('syntax')
      expect(ergebnis.config).toBeUndefined()
    })

    it('lehnt eine Liste ab: eine Seite ist ein Objekt', () => {
      expect(parseEditorJson('[]')).toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt „null" ab', () => {
      expect(parseEditorJson('null')).toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt eine Zahl ab', () => {
      expect(parseEditorJson('7')).toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt ein Dokument ohne Widget-Liste ab', () => {
      expect(parseEditorJson('{"grid": 8}')).toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt ein Dokument ab, dessen `widgets` keine Liste ist', () => {
      expect(parseEditorJson('{"widgets": {"a": 1}}')).toMatchObject({ ok: false, reason: 'shape' })
    })

    it('lehnt eine Kachel ohne Id ab - der Canvas braucht sie als Schluessel', () => {
      expect(parseEditorJson('{"widgets": [{"type": "Toggle"}]}')).toMatchObject({
        ok: false,
        reason: 'shape',
      })
    })

    it('lehnt eine Kachel ab, die gar kein Objekt ist', () => {
      expect(parseEditorJson('{"widgets": ["w-1"]}')).toMatchObject({ ok: false, reason: 'shape' })
    })

    it('nimmt eine leere Widget-Liste an - eine leere Seite ist eine Seite', () => {
      expect(parseEditorJson('{"widgets": []}')).toMatchObject({ ok: true })
    })

    /**
     * Die vier Zahlen der Autoren-Box sind R17: V1 liest dieselbe Seite und
     * rechnet ungeprueft mit ihnen (`w.x * CELL_W`). Was der Autor im Text
     * weglaesst oder als Text schreibt, wird deshalb hier auf dieselbe Vorgabe
     * geholt, die auch das Backend-Modell setzt - nicht als `undefined` an den
     * Canvas gereicht, wo es zu `NaN` wuerde.
     */
    it('holt eine fehlende Koordinate auf die V1-Vorgabe', () => {
      const { config } = parseEditorJson('{"widgets": [{"id": "w-1"}]}')

      expect(config.widgets[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 })
    })

    it('macht aus einer Zahl in Anfuehrungszeichen eine Zahl', () => {
      const { config } = parseEditorJson('{"widgets": [{"id": "w-1", "x": "12"}]}')

      expect(config.widgets[0].x).toBe(12)
    })

    it('rundet eine gebrochene Koordinate auf eine ganze Zahl', () => {
      const { config } = parseEditorJson('{"widgets": [{"id": "w-1", "y": 4.6}]}')

      expect(config.widgets[0].y).toBe(5)
    })

    it('ersetzt eine unbrauchbare Koordinate durch die Vorgabe statt durch NaN', () => {
      const { config } = parseEditorJson('{"widgets": [{"id": "w-1", "x": "abc"}]}')

      expect(config.widgets[0].x).toBe(0)
    })

    it('laesst jedes andere Feld der Seite unangetastet durch', () => {
      const { config } = parseEditorJson(
        '{"widgets": [], "includes": ["a"], "popup": null, "irgendwas": 1}',
      )

      expect(config.includes).toEqual(['a'])
      expect(config.irgendwas).toBe(1)
    })

    it('lehnt einen leeren Text ab, statt ihn als leere Seite zu lesen', () => {
      expect(parseEditorJson('')).toMatchObject({ ok: false, reason: 'syntax' })
      expect(parseEditorJson('   ')).toMatchObject({ ok: false, reason: 'syntax' })
    })

    it('lehnt alles ab, was gar kein Text ist', () => {
      expect(parseEditorJson(null)).toMatchObject({ ok: false, reason: 'syntax' })
      expect(parseEditorJson(42)).toMatchObject({ ok: false, reason: 'syntax' })
    })
  })

  /**
   * Der Vergleich hinter dem „Wiederherstellen": er entscheidet, ob der Server
   * den alten Stand WIRKLICH traegt. Er muss deshalb an einem Unterschied
   * scheitern und nicht an der Reihenfolge der Schluessel - die schreibt das
   * Backend-Modell, nicht der Editor.
   */
  describe('sameConfig', () => {
    it('erkennt dieselbe Seite trotz anderer Schluessel-Reihenfolge', () => {
      expect(sameConfig({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
    })

    it('erkennt dieselbe Seite auch tief verschachtelt', () => {
      const links = { widgets: [{ id: 'w', config: { x: 1, y: 2 } }] }
      const rechts = { widgets: [{ config: { y: 2, x: 1 }, id: 'w' }] }
      expect(sameConfig(links, rechts)).toBe(true)
    })

    it('sieht einen Unterschied im Wert', () => {
      expect(sameConfig({ a: 1 }, { a: 2 })).toBe(false)
    })

    it('sieht ein fehlendes Feld', () => {
      expect(sameConfig({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    })

    it('unterscheidet die Reihenfolge einer LISTE - sie ist Bedeutung (Z-Ordnung)', () => {
      expect(sameConfig({ widgets: ['a', 'b'] }, { widgets: ['b', 'a'] })).toBe(false)
    })

    it('kommt mit `null` und `undefined` aus, statt daran zu zerbrechen', () => {
      expect(sameConfig(null, undefined)).toBe(true)
      expect(sameConfig(null, { a: 1 })).toBe(false)
    })
  })
})
