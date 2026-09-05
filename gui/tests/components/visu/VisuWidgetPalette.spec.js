import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import VisuWidgetPalette from '@/components/visu/VisuWidgetPalette.vue'
import { CORE_WIDGET_TYPES, WIDGET_FORMS } from '@/utils/visuWidgetTypes'
import de from '@/locales/de.json'

/**
 * Die Widget-Palette (M5 C3, Issue #170).
 *
 * Sie zeigt genau die neun Kern-Typen des Vertrags - nicht mehr (ein Typ, den
 * kein Skin rendert, ist eine Sackgasse) und nicht weniger (ein fehlender Typ
 * ist eine Luecke im Autorenwerkzeug).
 */

describe('VisuWidgetPalette', () => {
  it('zeigt genau die neun Kern-Typen, in der Reihenfolge des Vertrags', () => {
    const w = mount(VisuWidgetPalette)
    const items = w.findAll('.widget-palette-item')
    expect(items).toHaveLength(9)
    expect(items.map((i) => i.attributes('data-type'))).toEqual(CORE_WIDGET_TYPES)
  })

  it('beschriftet jeden Typ uebersetzt, nicht mit seinem Schluessel', () => {
    const w = mount(VisuWidgetPalette)
    for (const item of w.findAll('.widget-palette-item')) {
      const type = item.attributes('data-type')
      expect([type, item.text()]).toEqual([type, expect.stringContaining(de.visuEditor.widgetTypes[type])])
      expect(item.text()).not.toBe(type)
    }
  })

  it('meldet den gewaehlten Typ nach oben, statt selbst etwas zu platzieren', async () => {
    const w = mount(VisuWidgetPalette)
    await w.find('.widget-palette-item[data-type="climate"]').trigger('click')
    expect(w.emitted('place')).toEqual([['climate']])
  })

  it('sagt bei den Typen, die die Vorschau noch nicht rendert, genau das', () => {
    const w = mount(VisuWidgetPalette)
    for (const item of w.findAll('.widget-palette-item')) {
      const type = item.attributes('data-type')
      expect([type, item.attributes('data-preview-mapped')]).toEqual([
        type,
        String(WIDGET_FORMS[type].previewMapped),
      ])
    }
    // Beide Seiten sind besetzt - sonst pruefte der Test nur eine Farbe.
    expect(w.findAll('.widget-palette-item[data-preview-mapped="true"]')).toHaveLength(4)
    const offen = w.findAll('.widget-palette-item[data-preview-mapped="false"]')
    expect(offen).toHaveLength(5)
    expect(offen[0].text()).toContain(de.visuEditor.palette.notRendered)
  })
})
