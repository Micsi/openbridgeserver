import { describe, it, expect } from 'vitest'

import {
  CORE_WIDGET_TYPES,
  WIDGET_FORMS,
  coreTypeOf,
  createWidget,
  readField,
  widgetConfigKeys,
  widgetFormFields,
  writeField,
} from '@/utils/visuWidgetTypes'

/**
 * Die Widget-Palette und ihre Formulare (M5 C3, Issue #170).
 *
 * Diese Datei prueft die REGELN der Palette gegen sich selbst: neun Kern-Typen,
 * je Typ ein Formular, jedes Feld mit einem Pfad in die Backend-Form. Dass die
 * neun Typen und die Feldschluessel nicht erfunden, sondern aus Vertrag und
 * Abbildung ABGELEITET sind, misst die Schwesterdatei
 * `visuWidgetTypesDerivation.spec.js` gegen die echten Quellen.
 */

describe('Widget-Palette — die neun Kern-Typen', () => {
  it('nennt genau die neun Kern-Typen des Vertrags', () => {
    expect(CORE_WIDGET_TYPES).toEqual([
      'light',
      'switch',
      'blind',
      'jalousie',
      'sensor',
      'scene',
      'media',
      'camera',
      'climate',
    ])
  })

  it('haelt fuer jeden Typ ein Formular', () => {
    expect(Object.keys(WIDGET_FORMS).sort()).toEqual([...CORE_WIDGET_TYPES].sort())
    for (const type of CORE_WIDGET_TYPES) {
      const fields = widgetFormFields(type)
      expect(fields.length, type).toBeGreaterThan(0)
      for (const field of fields) {
        expect(field.key, `${type}.${field.key}`).toMatch(/\S/)
        expect(['datapoint', 'text', 'flag', 'choice']).toContain(field.kind)
        expect(field.path, `${type}.${field.key}`).toMatch(
          /^(datapoint_id|status_datapoint_id|config\.[a-z0-9_]+)$/,
        )
      }
    }
  })

  it('kennt kein Formular fuer einen fremden Typ (statt still eines zu erfinden)', () => {
    expect(() => widgetFormFields('weather')).toThrow()
    expect(() => createWidget('weather', { id: 'w1' })).toThrow()
  })

  it('gibt je Typ verschiedene Formulare aus — kein einziges Universal-Formular', () => {
    const signatures = CORE_WIDGET_TYPES.map((t) =>
      widgetFormFields(t)
        .map((f) => f.path)
        .join(','),
    )
    // blind/jalousie teilen den Servertyp, aber nicht das Formular: die Lamelle
    // gibt es nur bei der Jalousie.
    expect(new Set(signatures).size).toBe(CORE_WIDGET_TYPES.length)
    expect(widgetConfigKeys('jalousie')).toContain('dp_slat')
    expect(widgetConfigKeys('blind')).not.toContain('dp_slat')
  })
})

describe('Widget-Palette — ein neu platziertes Widget', () => {
  it('traegt den Servertyp des gewaehlten Kern-Typs und findet zu ihm zurueck', () => {
    for (const type of CORE_WIDGET_TYPES) {
      const widget = createWidget(type, { id: `w-${type}`, name: `Neu ${type}` })
      expect(widget.type, type).toBe(WIDGET_FORMS[type].serverType)
      expect(coreTypeOf(widget), type).toBe(type)
      expect(widget.id).toBe(`w-${type}`)
      expect(widget.name).toBe(`Neu ${type}`)
      expect(widget.datapoint_id).toBeNull()
      expect(widget.status_datapoint_id).toBeNull()
    }
  })

  it('unterscheidet Rolladen und Jalousie am selben Servertyp', () => {
    const blind = createWidget('blind', { id: 'b' })
    const jalousie = createWidget('jalousie', { id: 'j' })
    expect(blind.type).toBe(jalousie.type)
    expect(coreTypeOf(blind)).toBe('blind')
    expect(coreTypeOf(jalousie)).toBe('jalousie')
  })

  it('meldet fuer ein unbekanntes Server-Widget keinen Kern-Typ', () => {
    expect(coreTypeOf({ type: 'IFrame', config: {} })).toBeNull()
    expect(coreTypeOf(null)).toBeNull()
  })
})

describe('Bindung — der Wert landet an genau einem Pfad', () => {
  it('schreibt eine Datenpunkt-Bindung an den Pfad des Feldes, ohne das Original zu aendern', () => {
    const widget = createWidget('switch', { id: 'w1', name: 'Lampe' })
    const field = widgetFormFields('switch').find((f) => f.path === 'datapoint_id')
    const bound = writeField(widget, field, 'dp-1')

    expect(readField(bound, field)).toBe('dp-1')
    expect(bound.datapoint_id).toBe('dp-1')
    expect(widget.datapoint_id).toBeNull()
    expect(bound).not.toBe(widget)
  })

  it('schreibt eine Konfig-Bindung in die Konfig, nicht an die Wurzel', () => {
    const widget = createWidget('light', { id: 'w2' })
    const field = widgetFormFields('light').find((f) => f.path === 'config.dp_switch')
    const bound = writeField(widget, field, 'dp-2')

    expect(bound.config.dp_switch).toBe('dp-2')
    expect(bound.datapoint_id).toBeNull()
    expect(widget.config.dp_switch).toBe('')
  })

  it('loest eine Bindung wieder (leerer Wert), statt den Schluessel zu verlieren', () => {
    const widget = writeField(
      createWidget('light', { id: 'w3' }),
      widgetFormFields('light').find((f) => f.path === 'config.dp_dim'),
      'dp-3',
    )
    const cleared = writeField(
      widget,
      widgetFormFields('light').find((f) => f.path === 'config.dp_dim'),
      null,
    )
    expect(cleared.config).toHaveProperty('dp_dim')
    expect(cleared.config.dp_dim).toBe('')
  })
})
