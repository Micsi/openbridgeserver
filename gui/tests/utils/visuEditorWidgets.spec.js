import { describe, it, expect } from 'vitest'

import {
  mergeAuthoredWidgets,
  normalizeWidget,
  widgetSignature,
} from '@/utils/visuEditorWidgets'
import {
  CORE_WIDGET_TYPES,
  createWidget,
  widgetFormFields,
  writeField,
} from '@/utils/visuWidgetTypes'
import { writeVisibilityRule } from '@/utils/visuVisibility'

/**
 * Die Elemente einer Seite aus ZWEI Haenden (Nachzug M5 C3, Issue #170).
 *
 * Hier steht die reine Regel: welche Felder der Autorenteil besitzt, welche der
 * Canvas, und woran man erkennt, ob der Server nach einem Speichern wirklich
 * traegt, was er tragen sollte. Die Ansicht darueber hat ihre eigenen Proben.
 */

const canvasWidget = (id, extra = {}) => ({
  id,
  name: `Kachel ${id}`,
  type: 'Toggle',
  datapoint_id: null,
  status_datapoint_id: null,
  x: 10,
  y: 20,
  w: 3,
  h: 2,
  config: {},
  ...extra,
})

describe('normalizeWidget - die Vorgaben des Backend-Modells', () => {
  it('fuellt genau die Felder, die `WidgetInstance` selbst vorgibt', () => {
    expect(normalizeWidget({ id: 'a', type: 'Toggle' })).toEqual({
      id: 'a',
      type: 'Toggle',
      name: '',
      datapoint_id: null,
      status_datapoint_id: null,
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      config: {},
    })
  })

  it('heilt eine fehlende Koordinate auf die V1-Vorgabe, so wie das Backend (R17)', () => {
    const geheilt = normalizeWidget({ id: 'a', type: 'Toggle', x: null, y: 5, w: undefined, h: 9 })
    expect([geheilt.x, geheilt.y, geheilt.w, geheilt.h]).toEqual([0, 5, 2, 9])
  })

  it('laesst die Konfig unangetastet - sie ist freies JSON und gehoert dem Element', () => {
    const config = { visible_when: { datapoint_id: 'dp-1', op: 'gt', value: 30 }, editor: { locked: true } }
    expect(normalizeWidget({ id: 'a', type: 'Toggle', config }).config).toEqual(config)
  })
})

describe('widgetSignature - die Schranke hinter der Quittung', () => {
  it('ist gleich, wenn die Schluessel nur anders sortiert sind', () => {
    const links = [{ id: 'a', type: 'Toggle', name: 'X', config: { b: 1, a: 2 } }]
    const rechts = [{ config: { a: 2, b: 1 }, name: 'X', type: 'Toggle', id: 'a' }]
    expect(widgetSignature(links)).toBe(widgetSignature(rechts))
  })

  it('faellt auseinander, wenn der NAME nicht angekommen ist', () => {
    const gewollt = [canvasWidget('a', { name: 'Neu' })]
    const server = [canvasWidget('a', { name: 'Alt' })]
    expect(widgetSignature(server)).not.toBe(widgetSignature(gewollt))
  })

  it('faellt auseinander, wenn die BINDUNG nicht angekommen ist', () => {
    const gewollt = [canvasWidget('a', { datapoint_id: 'dp-1' })]
    const server = [canvasWidget('a', { datapoint_id: null })]
    expect(widgetSignature(server)).not.toBe(widgetSignature(gewollt))
  })

  it('faellt auseinander, wenn ein KONFIG-Feld des Bindungsformulars fehlt', () => {
    const gewollt = [canvasWidget('a', { config: { dp_dim: 'dp-7', mode: 'dimm' } })]
    const server = [canvasWidget('a', { config: { mode: 'dimm' } })]
    expect(widgetSignature(server)).not.toBe(widgetSignature(gewollt))
  })

  it('faellt auseinander, wenn eine ENTFERNTE Sichtbarkeitsregel stehen geblieben ist', () => {
    const gewollt = [canvasWidget('a', { config: {} })]
    const server = [canvasWidget('a', { config: { visible_when: { datapoint_id: 'dp-1', op: 'truthy' } } })]
    expect(widgetSignature(server)).not.toBe(widgetSignature(gewollt))
  })

  it('faellt auseinander, wenn ein NEUES Element aus der Palette fehlt', () => {
    const gewollt = [canvasWidget('a'), canvasWidget('neu')]
    expect(widgetSignature([canvasWidget('a')])).not.toBe(widgetSignature(gewollt))
  })

  it('faellt auseinander, wenn eine Koordinate verloren ging (die Schranke aus C2 bleibt)', () => {
    const gewollt = [canvasWidget('a', { x: 40 })]
    expect(widgetSignature([canvasWidget('a', { x: 41 })])).not.toBe(widgetSignature(gewollt))
  })

  it('nimmt die Vorgaben des Modells nicht als Unterschied - der Server ergaenzt sie selbst', () => {
    const gewollt = [{ id: 'a', type: 'Toggle', x: 1, y: 2, w: 3, h: 4 }]
    const server = [
      { id: 'a', type: 'Toggle', name: '', datapoint_id: null, status_datapoint_id: null, x: 1, y: 2, w: 3, h: 4, config: {} },
    ]
    expect(widgetSignature(server)).toBe(widgetSignature(gewollt))
  })
})

describe('mergeAuthoredWidgets - wer welches Feld besitzt', () => {
  it('nimmt Name, Bindung und Konfig aus dem Autorenteil', () => {
    const canvas = [canvasWidget('a')]
    const autoren = [canvasWidget('a', { name: 'Neu', datapoint_id: 'dp-1', config: { unit: '°C' } })]
    const [gemischt] = mergeAuthoredWidgets(canvas, autoren)
    expect(gemischt.name).toBe('Neu')
    expect(gemischt.datapoint_id).toBe('dp-1')
    expect(gemischt.config.unit).toBe('°C')
  })

  it('laesst dem Canvas die Autoren-Box, auch wenn der Autorenteil eine aeltere haelt', () => {
    const canvas = [canvasWidget('a', { x: 40, y: 8, w: 5, h: 6 })]
    const autoren = [canvasWidget('a', { name: 'Neu', x: 0, y: 0, w: 3, h: 2 })]
    const [gemischt] = mergeAuthoredWidgets(canvas, autoren)
    expect([gemischt.x, gemischt.y, gemischt.w, gemischt.h]).toEqual([40, 8, 5, 6])
  })

  it('laesst dem Canvas seine Marken (gesperrt/ausgeblendet/Gruppe), nicht dem Formular', () => {
    const canvas = [canvasWidget('a', { config: { editor: { locked: true, group: 'g1' } } })]
    const autoren = [canvasWidget('a', { config: { unit: '°C', editor: { locked: false } } })]
    const [gemischt] = mergeAuthoredWidgets(canvas, autoren)
    expect(gemischt.config.editor).toEqual({ locked: true, group: 'g1' })
    expect(gemischt.config.unit).toBe('°C')
  })

  it('haengt ein Element an, das nur der Autorenteil kennt (frisch aus der Palette)', () => {
    const canvas = [canvasWidget('a')]
    const autoren = [canvasWidget('a'), canvasWidget('neu', { type: 'ValueDisplay' })]
    expect(mergeAuthoredWidgets(canvas, autoren).map((w) => w.id)).toEqual(['a', 'neu'])
  })

  it('behaelt ein Element, das nur der Canvas kennt (frisch eingefuegt, C5)', () => {
    const canvas = [canvasWidget('a'), canvasWidget('kopie')]
    const autoren = [canvasWidget('a')]
    expect(mergeAuthoredWidgets(canvas, autoren).map((w) => w.id)).toEqual(['a', 'kopie'])
  })

  it('haelt die Reihenfolge des Canvas - sie ist die Z-Ordnung (E8)', () => {
    const canvas = [canvasWidget('b'), canvasWidget('a')]
    const autoren = [canvasWidget('a'), canvasWidget('b')]
    expect(mergeAuthoredWidgets(canvas, autoren).map((w) => w.id)).toEqual(['b', 'a'])
  })

  it('ist ohne Autorenliste ein Nichtstun - kein Element verschwindet', () => {
    const canvas = [canvasWidget('a'), canvasWidget('b')]
    expect(mergeAuthoredWidgets(canvas, [])).toEqual(canvas)
    expect(mergeAuthoredWidgets(canvas, null)).toEqual(canvas)
  })

  it('mutiert keine der beiden Listen', () => {
    const canvas = [canvasWidget('a')]
    const autoren = [canvasWidget('a', { name: 'Neu' })]
    mergeAuthoredWidgets(canvas, autoren)
    expect(canvas[0].name).toBe('Kachel a')
    expect(autoren[0].x).toBe(10)
  })
})

/**
 * NICHT NUR DER NAME - die ganze Palette und das ganze Bindungsformular.
 *
 * Der Fund nannte drei Beispiele (Name, Bindung, Sichtbarkeitsregel); betroffen
 * war alles, was der Autorenteil ueberhaupt setzen kann. Diese Probe geht die
 * Feldbeschreibung selbst durch - Rolle/Leuchtmittel (`config.mode`), Icon,
 * Beschriftung der Ampel-Status, Einheit, Kamera-URL, Umkehrung und jedes
 * Datenpunkt-Feld - und faellt, sobald EINES davon den Schreibweg nicht mehr
 * findet oder aus der Schranke faellt. Ein neuer Konfig-Schluessel ist damit
 * automatisch mitgeprueft, ohne dass diese Datei ihn kennen muss.
 */
describe('Jedes Feld des Autorenteils findet den Weg - nicht nur der Name', () => {
  /** Ein Wert, der sich von der Vorgabe des Feldes unterscheidet. */
  const anderswert = (field) => {
    if (field.kind === 'flag') return !field.default
    if (field.kind === 'choice') return field.choices.find((c) => c !== field.default)
    return `probe-${field.key}`
  }

  for (const type of CORE_WIDGET_TYPES) {
    for (const field of widgetFormFields(type)) {
      it(`${type}: „${field.key}" reist mit und ist vergleichbar`, () => {
        const original = createWidget(type, { id: 'w1', name: 'Alt' })
        const bearbeitet = writeField(original, field, anderswert(field))

        // 1. Der Schreibweg: der Wert steht nach dem Zusammenlegen im Element,
        //    das der Canvas abschickt.
        const [gemischt] = mergeAuthoredWidgets([original], [bearbeitet])
        const pfad = field.path.startsWith('config.')
          ? gemischt.config[field.path.slice('config.'.length)]
          : gemischt[field.path]
        expect(pfad).toEqual(anderswert(field))

        // 2. Die Schranke: bliebe der alte Wert auf dem Server stehen, faellt es auf.
        expect(widgetSignature([original])).not.toBe(widgetSignature([gemischt]))
      })
    }
  }

  it('der NAME des Elements reist mit und ist vergleichbar', () => {
    const original = createWidget('switch', { id: 'w1', name: 'Alt' })
    const [gemischt] = mergeAuthoredWidgets([original], [{ ...original, name: 'Neu' }])
    expect(gemischt.name).toBe('Neu')
    expect(widgetSignature([original])).not.toBe(widgetSignature([gemischt]))
  })

  it('die SICHTBARKEITSREGEL reist mit und ist vergleichbar (E16)', () => {
    const original = createWidget('switch', { id: 'w1' })
    const mitRegel = writeVisibilityRule(original, { datapoint_id: 'dp-1', op: 'gt', value: 30 })
    const [gemischt] = mergeAuthoredWidgets([original], [mitRegel])
    expect(gemischt.config.visible_when).toEqual({ datapoint_id: 'dp-1', op: 'gt', value: 30 })
    expect(widgetSignature([original])).not.toBe(widgetSignature([gemischt]))
  })

  it('ein aus der Palette angelegtes Element reist vollstaendig mit', () => {
    const neu = createWidget('camera', { id: 'w-neu', name: 'Flur' })
    const gemischt = mergeAuthoredWidgets([], [neu])
    expect(gemischt).toEqual([neu])
    expect(widgetSignature([])).not.toBe(widgetSignature(gemischt))
  })
})
