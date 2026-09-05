import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import { createWidget, widgetFormFields } from '@/utils/visuWidgetTypes'
import de from '@/locales/de.json'

/**
 * Das Bindungsformular (Messlatten **E11** und **E16**, M5 C3, Issue #170).
 *
 * Ein Formular je Kern-Typ, abgeleitet aus der Beschreibung in
 * `visuWidgetTypes.js` (die ihrerseits an `mapping.ts` haengt, s.
 * `visuWidgetTypesDerivation.spec.js`) - deshalb steht hier keine einzige
 * handgeschriebene Feldliste, sondern der Vergleich gegen die Ableitung.
 */

const TREFFER = [
  { id: 'dp-1', name: 'dp-m5-solo', data_type: 'FLOAT', unit: '°C', value: 21.5, quality: 'good' },
]

let searchMock

beforeEach(() => {
  vi.resetModules()
  searchMock = vi.fn(async ({ q }) => {
    const items = TREFFER.filter((dp) => !q || dp.name.includes(q))
    return { data: { items, total: items.length, pages: 1 } }
  })
  vi.doMock('@/api/client', () => ({
    default: {},
    searchApi: { search: searchMock },
    systemApi: { datatypes: vi.fn(async () => ({ data: [{ name: 'FLOAT' }] })) },
  }))
})

afterEach(() => {
  vi.doUnmock('@/api/client')
})

async function mountForm(widget) {
  const { default: VisuWidgetBindingForm } = await import(
    '@/components/visu/VisuWidgetBindingForm.vue'
  )
  const w = mount(VisuWidgetBindingForm, { props: { widget } })
  await flushPromises()
  return w
}

/** Die zuletzt nach oben gemeldete Fassung des Widgets. */
function letzteFassung(w) {
  const events = w.emitted('update:widget')
  return events ? events[events.length - 1][0] : null
}

describe('Bindungsformular — je Typ ein Formular', () => {
  it('zeigt fuer jeden Kern-Typ genau die abgeleiteten Felder', async () => {
    for (const type of ['light', 'switch', 'blind', 'jalousie', 'sensor', 'scene', 'media', 'camera', 'climate']) {
      const w = await mountForm(createWidget(type, { id: `w-${type}`, name: 'Element' }))
      const gezeigt = w.findAll('.binding-field').map((f) => f.attributes('data-field'))
      expect([type, gezeigt]).toEqual([type, widgetFormFields(type).map((f) => f.key)])
      w.unmount()
    }
  })

  it('rendert je Feldart die passende Eingabe', async () => {
    const w = await mountForm(createWidget('blind', { id: 'w', name: 'Rollladen' }))
    // Datenpunkt-Feld: der Waehler mit Suche; Flag: eine Checkbox; Auswahl: ein select.
    expect(w.find('.binding-field[data-field="dp_position"] .dp-picker-open').exists()).toBe(true)
    expect(w.find('.binding-field[data-field="invert"] input[type="checkbox"]').exists()).toBe(true)
    expect(w.find('.binding-field[data-field="mode"] select').exists()).toBe(true)
  })

  it('verbindet jedes Feld mit seiner Beschriftung', async () => {
    const w = await mountForm(createWidget('climate', { id: 'w', name: 'RTR' }))
    for (const feld of w.findAll('.binding-field')) {
      const label = feld.find('label')
      expect(label.exists()).toBe(true)
      expect(label.text()).toMatch(/\S/)
    }
  })
})

describe('Bindungsformular — der Name (E10)', () => {
  it('beschriftet das Namensfeld mit „Name" und verbindet es', async () => {
    const w = await mountForm(createWidget('switch', { id: 'w', name: 'M5 Gamma Item' }))
    const input = w.find('.binding-name')
    const label = w.find(`label[for="${input.attributes('id')}"]`)
    expect(label.text()).toBe(de.visuEditor.binding.name)
    expect(input.element.value).toBe('M5 Gamma Item')
  })

  it('meldet den neuen Namen nach oben, ohne das Original zu aendern', async () => {
    const widget = createWidget('switch', { id: 'w', name: 'M5 Gamma Item' })
    const w = await mountForm(widget)
    await w.find('.binding-name').setValue('M5 Gamma Umbenannt')
    expect(letzteFassung(w).name).toBe('M5 Gamma Umbenannt')
    expect(widget.name).toBe('M5 Gamma Item')
  })
})

describe('Bindungsformular — die Bindung landet im Entwurf (E11)', () => {
  it('schreibt die gewaehlte Datenpunkt-Id an den Pfad des Feldes', async () => {
    const w = await mountForm(createWidget('switch', { id: 'w', name: 'Lampe' }))
    await w.find('.binding-field[data-field="datapoint_id"] .dp-picker-open').trigger('click')
    await flushPromises()
    await w.find('.binding-field[data-field="datapoint_id"] .dp-picker-search').setValue('dp-m5-solo')
    await flushPromises()
    await w.find('.binding-field[data-field="datapoint_id"] .dp-picker-item').trigger('click')
    await flushPromises()

    expect(letzteFassung(w).datapoint_id).toBe('dp-1')
  })

  it('schreibt eine Konfig-Bindung in die Konfig', async () => {
    const w = await mountForm(createWidget('light', { id: 'w', name: 'Licht' }))
    await w.find('.binding-field[data-field="dp_dim"] .dp-picker-open').trigger('click')
    await flushPromises()
    await w.find('.binding-field[data-field="dp_dim"] .dp-picker-item').trigger('click')
    await flushPromises()

    const fassung = letzteFassung(w)
    expect(fassung.config.dp_dim).toBe('dp-1')
    expect(fassung.datapoint_id).toBeNull()
  })
})

describe('Bindungsformular — die Sichtbarkeitsregel (E16)', () => {
  async function regelOeffnen(w) {
    const button = w
      .findAll('button')
      .find((b) => b.text().includes(de.visuEditor.visibility.button))
    await button.trigger('click')
    await flushPromises()
    return button
  }

  it('zeigt die Regel erst auf Aufforderung', async () => {
    const w = await mountForm(createWidget('switch', { id: 'w', name: 'Lampe' }))
    expect(w.find('.visibility-rule').exists()).toBe(false)
    await regelOeffnen(w)
    expect(w.find('.visibility-rule').exists()).toBe(true)
  })

  it('beschriftet Datenpunkt, Bedingung und Schwelle so, wie das Szenario sie sucht', async () => {
    const w = await mountForm(createWidget('switch', { id: 'w', name: 'Lampe' }))
    await regelOeffnen(w)
    for (const [klasse, schluessel] of [
      ['.visibility-datapoint', 'datapoint'],
      ['.visibility-op', 'condition'],
      ['.visibility-threshold', 'threshold'],
    ]) {
      const feld = w.find(klasse)
      const label = w.find(`label[for="${feld.attributes('id')}"]`)
      expect([klasse, label.text()]).toEqual([klasse, de.visuEditor.visibility[schluessel]])
    }
  })

  it('loest den eingetippten Datenpunktnamen auf und schreibt die Regel ins Widget', async () => {
    const w = await mountForm(createWidget('switch', { id: 'w', name: 'Lampe' }))
    await regelOeffnen(w)

    await w.find('.visibility-datapoint').setValue('dp-m5-solo')
    await flushPromises()
    await w.find('.visibility-op').setValue('gt')
    await w.find('.visibility-threshold').setValue('30')
    await flushPromises()

    expect(letzteFassung(w).config.visible_when).toEqual({
      datapoint_id: 'dp-1',
      op: 'gt',
      value: 30,
    })
  })

  it('sagt es, wenn der eingetippte Datenpunkt nicht existiert, statt still nichts zu tun', async () => {
    const w = await mountForm(createWidget('switch', { id: 'w', name: 'Lampe' }))
    await regelOeffnen(w)
    await w.find('.visibility-datapoint').setValue('gibt-es-nicht')
    await flushPromises()

    expect(w.find('.visibility-unknown').text()).toBe(de.visuEditor.visibility.unknown)
    expect(letzteFassung(w)?.config?.visible_when).toBeUndefined()
  })

  it('nimmt die Regel wieder weg', async () => {
    const widget = createWidget('switch', { id: 'w', name: 'Lampe' })
    widget.config.visible_when = { datapoint_id: 'dp-1', op: 'gt', value: 30 }
    const w = await mountForm(widget)
    await regelOeffnen(w)
    const entfernen = w
      .findAll('button')
      .find((b) => b.text().includes(de.visuEditor.visibility.remove))
    await entfernen.trigger('click')
    await flushPromises()
    expect(letzteFassung(w).config.visible_when).toBeUndefined()
  })
})
