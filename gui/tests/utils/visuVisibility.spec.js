import { describe, it, expect } from 'vitest'

import {
  VISIBILITY_OPS,
  normalizeRule,
  readVisibilityRule,
  visibilityDatapointIds,
  writeVisibilityRule,
} from '@/utils/visuVisibility'

/**
 * Bedingte Sichtbarkeit (Messlatte **E16**, M5 C3, Issue #170) - die Seite des
 * EDITORS.
 *
 * Der Editor SCHREIBT die Regel (Formular), LIEST sie wieder an (damit sie im
 * Formular steht) und ABONNIERT ihre Datenpunkte. Er wertet sie NICHT aus: das
 * tut der Host (`apps/visu/src/core/obs/mapping.ts`), damit Vorschau und
 * ausgelieferte Visu dieselbe Seite zeigen (E3). Die Auswertung selbst hat ihre
 * Probe drueben (`apps/visu/src/core/obs/visibility.spec.ts`), die Naht zwischen
 * beiden Haelften der Zaun `visuVisibilityHost.spec.js`.
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

describe('Sichtbarkeitsregel - was der Editor beobachtet', () => {
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

  it('nennt die Datenpunkte, an denen eine Regel haengt (Abo-Liste)', () => {
    // Der Editor abonniert sie nicht, um selbst zu entscheiden, sondern damit
    // ein Wertwechsel Anlass ist, dem Host einen neuen Entwurf zu schicken.
    expect(visibilityDatapointIds(nodes())).toEqual(['dp-m5-solo'])
    expect(visibilityDatapointIds([])).toEqual([])
  })

  it('nennt keinen Datenpunkt, wo gar keine Regel steht', () => {
    const ohne = [
      { id: 'page-1', type: 'PAGE', name: 'M5 Solo', page_config: { widgets: [widget('a', null)] } },
      { id: 'page-2', type: 'LOCATION', name: 'Ordner', page_config: null },
    ]
    expect(visibilityDatapointIds(ohne)).toEqual([])
  })

  it('nennt jeden Datenpunkt nur einmal, auch bei mehreren Regeln darauf', () => {
    const doppelt = [
      {
        id: 'page-1',
        type: 'PAGE',
        name: 'M5 Solo',
        page_config: {
          widgets: [widget('a', REGEL), widget('b', { ...REGEL, op: 'lt' })],
        },
      },
    ]
    expect(visibilityDatapointIds(doppelt)).toEqual(['dp-m5-solo'])
  })
})
