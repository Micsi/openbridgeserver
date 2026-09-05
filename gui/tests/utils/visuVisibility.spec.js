import { describe, it, expect } from 'vitest'

import {
  VISIBILITY_OPS,
  applyVisibility,
  evaluateVisibility,
  isWidgetVisible,
  normalizeRule,
  readVisibilityRule,
  writeVisibilityRule,
} from '@/utils/visuVisibility'

/**
 * Bedingte Sichtbarkeit (Messlatte **E16**, M5 C3, Issue #170).
 *
 * Die Regel ist DATEN (`config.visible_when` am Widget), die Auswertung ist
 * CODE (diese reine Funktion). Beide Zweige werden gemessen: erfuellt und nicht
 * erfuellt - eine Regel, die immer dasselbe sagt, nimmt nichts ab.
 */

const REGEL = { datapoint_id: 'dp-m5-solo', op: 'gt', value: 30 }

describe('Sichtbarkeitsregel — die Form', () => {
  it('kennt die Vergleiche, die das Formular anbietet', () => {
    expect(VISIBILITY_OPS).toEqual(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'truthy', 'falsy'])
  })

  it('liest eine Regel aus der Widget-Konfig und schreibt sie dorthin zurueck', () => {
    const widget = { id: 'w1', type: 'Toggle', config: {} }
    expect(readVisibilityRule(widget)).toBeNull()

    const mit = writeVisibilityRule(widget, REGEL)
    expect(mit.config.visible_when).toEqual(REGEL)
    expect(readVisibilityRule(mit)).toEqual(REGEL)
    // Das Original bleibt unberuehrt (der Entwurf wird ersetzt, nicht mutiert).
    expect(widget.config.visible_when).toBeUndefined()

    const ohne = writeVisibilityRule(mit, null)
    expect(ohne.config.visible_when).toBeUndefined()
    expect(readVisibilityRule(ohne)).toBeNull()
  })

  it('verwirft eine unvollstaendige Regel, statt sie halb zu speichern', () => {
    expect(normalizeRule({ datapoint_id: '', op: 'gt', value: 30 })).toBeNull()
    expect(normalizeRule({ datapoint_id: 'dp', op: 'kleiner', value: 1 })).toBeNull()
    expect(normalizeRule(null)).toBeNull()
    // Ein Vergleich ohne Schwelle ist nur bei truthy/falsy vollstaendig.
    expect(normalizeRule({ datapoint_id: 'dp', op: 'gt', value: '' })).toBeNull()
    expect(normalizeRule({ datapoint_id: 'dp', op: 'truthy' })).toEqual({
      datapoint_id: 'dp',
      op: 'truthy',
    })
  })

  it('nimmt die Schwelle als Zahl an, auch wenn das Formular Text liefert', () => {
    expect(normalizeRule({ datapoint_id: 'dp', op: 'gt', value: '30' })).toEqual({
      datapoint_id: 'dp',
      op: 'gt',
      value: 30,
    })
    // Was keine Zahl ist, bleibt Text - `eq` vergleicht auch Zeichenketten.
    expect(normalizeRule({ datapoint_id: 'dp', op: 'eq', value: 'auf' })).toEqual({
      datapoint_id: 'dp',
      op: 'eq',
      value: 'auf',
    })
  })
})

describe('Sichtbarkeitsregel — die Auswertung, beide Zweige', () => {
  it('haelt ein Element ohne Regel immer sichtbar', () => {
    expect(evaluateVisibility(null, 21.5)).toBe(true)
  })

  it('entscheidet den Fall aus E16 in beide Richtungen', () => {
    // Seed-Wert 21.5, Schwelle 30 -> nicht erfuellt -> unsichtbar.
    expect(evaluateVisibility(REGEL, 21.5)).toBe(false)
    // Wert ueber die Schwelle -> sichtbar.
    expect(evaluateVisibility(REGEL, 42)).toBe(true)
  })

  it('rechnet jeden angebotenen Vergleich, und zwar in beiden Zweigen', () => {
    const faelle = [
      ['eq', 5, 5, true],
      ['eq', 5, 6, false],
      ['ne', 5, 6, true],
      ['ne', 5, 5, false],
      ['lt', 5, 4, true],
      ['lt', 5, 5, false],
      ['lte', 5, 5, true],
      ['lte', 5, 6, false],
      ['gt', 5, 6, true],
      ['gt', 5, 5, false],
      ['gte', 5, 5, true],
      ['gte', 5, 4, false],
    ]
    for (const [op, schwelle, wert, erwartet] of faelle) {
      expect([op, wert, evaluateVisibility({ datapoint_id: 'dp', op, value: schwelle }, wert)]).toEqual(
        [op, wert, erwartet],
      )
    }
    for (const [op, wert, erwartet] of [
      ['truthy', true, true],
      ['truthy', false, false],
      ['truthy', 1, true],
      ['truthy', 0, false],
      ['falsy', false, true],
      ['falsy', true, false],
    ]) {
      expect([op, wert, evaluateVisibility({ datapoint_id: 'dp', op }, wert)]).toEqual([
        op,
        wert,
        erwartet,
      ])
    }
  })

  it('haelt ein Element verborgen, solange der Wert unbekannt ist', () => {
    // Eine Bedingung, die niemand pruefen konnte, ist nicht erfuellt. Sonst
    // blitzte beim Laden genau das Element auf, das die Regel verstecken soll.
    expect(evaluateVisibility(REGEL, undefined)).toBe(false)
    expect(evaluateVisibility(REGEL, null)).toBe(false)
  })

  it('vergleicht Zahl und Zahlentext gleich (der Bus liefert beides)', () => {
    expect(evaluateVisibility(REGEL, '42')).toBe(true)
    expect(evaluateVisibility(REGEL, '21.5')).toBe(false)
  })
})

describe('Sichtbarkeitsregel — im Entwurf', () => {
  const widget = (id, rule) => ({
    id,
    name: id,
    type: 'Toggle',
    datapoint_id: 'dp-m5-solo',
    status_datapoint_id: null,
    config: rule ? { visible_when: rule } : {},
  })

  const nodes = () => [
    {
      id: 'page-1',
      type: 'PAGE',
      name: 'M5 Solo',
      page_config: { widgets: [widget('mit-regel', REGEL), widget('ohne-regel', null)] },
    },
  ]

  it('sagt je Wert, ob ein Widget sichtbar ist', () => {
    expect(isWidgetVisible(widget('a', REGEL), { 'dp-m5-solo': 21.5 })).toBe(false)
    expect(isWidgetVisible(widget('a', REGEL), { 'dp-m5-solo': 42 })).toBe(true)
    expect(isWidgetVisible(widget('a', null), {})).toBe(true)
  })

  it('nimmt das verborgene Element aus dem Entwurf und laesst die anderen stehen', () => {
    const verborgen = applyVisibility(nodes(), { 'dp-m5-solo': 21.5 })
    expect(verborgen[0].page_config.widgets.map((w) => w.id)).toEqual(['ohne-regel'])

    const sichtbar = applyVisibility(nodes(), { 'dp-m5-solo': 42 })
    expect(sichtbar[0].page_config.widgets.map((w) => w.id)).toEqual(['mit-regel', 'ohne-regel'])
  })

  it('laesst die Knoten des Aufrufers unberuehrt', () => {
    const original = nodes()
    applyVisibility(original, { 'dp-m5-solo': 21.5 })
    expect(original[0].page_config.widgets).toHaveLength(2)
  })

  it('nennt die Datenpunkte, die eine Regel beobachtet (Abo-Liste)', async () => {
    const { visibilityDatapointIds } = await import('@/utils/visuVisibility')
    expect(visibilityDatapointIds(nodes())).toEqual(['dp-m5-solo'])
    expect(visibilityDatapointIds([])).toEqual([])
  })
})
