import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import de from '@/locales/de.json'

/**
 * Der Datenpunkt-Waehler mit Suche und Filter (Messlatte **E11**, Issue #170).
 *
 * Die Bedien-Affordanzen sind die des Harness (`m5-editor-matrix.spec.ts`,
 * Zeile E11): eine Schaltflaeche „Datenpunkt waehlen", ein Feld
 * „Datenpunkt suchen", Treffer als `.dp-picker-item`. Sie stehen hier nicht
 * zufaellig so - der Test haelt sie gegen die deutschen Beschriftungen, mit
 * denen das Szenario sie sucht.
 */

const TREFFER = [
  { id: 'dp-1', name: 'dp-m5-solo', data_type: 'FLOAT', unit: '°C', value: 21.5, quality: 'good' },
  { id: 'dp-2', name: 'dp-m5-home', data_type: 'BOOLEAN', unit: null, value: true, quality: 'good' },
]

let searchMock
let datatypesMock

beforeEach(() => {
  vi.resetModules()
  searchMock = vi.fn(async ({ q, type }) => {
    const items = TREFFER.filter(
      (dp) => (!q || dp.name.includes(q)) && (!type || dp.data_type === type),
    )
    return { data: { items, total: items.length, pages: 1 } }
  })
  datatypesMock = vi.fn(async () => ({ data: [{ name: 'FLOAT' }, { name: 'BOOLEAN' }] }))
  vi.doMock('@/api/client', () => ({
    default: {},
    searchApi: { search: searchMock },
    systemApi: { datatypes: datatypesMock },
  }))
})

afterEach(() => {
  vi.doUnmock('@/api/client')
})

async function mountPicker(props = {}) {
  const { default: VisuDatapointPicker } = await import('@/components/visu/VisuDatapointPicker.vue')
  const w = mount(VisuDatapointPicker, { props })
  await flushPromises()
  return w
}

/** Die Schaltflaeche, die das Szenario per Beschriftung sucht. */
function oeffner(w) {
  return w
    .findAll('button')
    .find((b) => b.text().includes(de.visuEditor.binding.choose))
}

describe('VisuDatapointPicker — oeffnen', () => {
  it('zeigt zuerst nur die Schaltflaeche „Datenpunkt waehlen"', async () => {
    const w = await mountPicker()
    expect(oeffner(w)).toBeTruthy()
    expect(w.find('.dp-picker').exists()).toBe(false)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('oeffnet die Suche und laedt erst dann', async () => {
    const w = await mountPicker()
    await oeffner(w).trigger('click')
    await flushPromises()
    expect(w.find('.dp-picker').exists()).toBe(true)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(w.findAll('.dp-picker-item')).toHaveLength(2)
  })
})

describe('VisuDatapointPicker — Suche und Filter', () => {
  it('beschriftet das Suchfeld so, wie das Szenario es sucht — und verbindet Label und Feld', async () => {
    const w = await mountPicker()
    await oeffner(w).trigger('click')
    await flushPromises()

    const input = w.find('.dp-picker-search')
    const label = w.find(`label[for="${input.attributes('id')}"]`)
    expect(input.attributes('id')).toBeTruthy()
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe(de.visuEditor.binding.searchLabel)
  })

  it('findet mit der Suche genau einen Datenpunkt (E11)', async () => {
    const w = await mountPicker()
    await oeffner(w).trigger('click')
    await flushPromises()

    await w.find('.dp-picker-search').setValue('dp-m5-solo')
    await flushPromises()

    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'dp-m5-solo' }))
    const hits = w.findAll('.dp-picker-item')
    expect(hits).toHaveLength(1)
    expect(hits[0].text()).toContain('dp-m5-solo')
  })

  it('filtert zusaetzlich nach Datentyp', async () => {
    const w = await mountPicker()
    await oeffner(w).trigger('click')
    await flushPromises()

    await w.find('.dp-picker-filter').setValue('BOOLEAN')
    await flushPromises()

    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'BOOLEAN' }))
    const hits = w.findAll('.dp-picker-item')
    expect(hits).toHaveLength(1)
    expect(hits[0].text()).toContain('dp-m5-home')
  })

  it('sagt es, wenn nichts passt, statt eine leere Flaeche zu zeigen', async () => {
    const w = await mountPicker()
    await oeffner(w).trigger('click')
    await flushPromises()

    await w.find('.dp-picker-search').setValue('gibt-es-nicht')
    await flushPromises()

    expect(w.findAll('.dp-picker-item')).toHaveLength(0)
    expect(w.find('.dp-picker-empty').text()).toBe(de.visuEditor.binding.noHits)
  })
})

describe('VisuDatapointPicker — waehlen', () => {
  it('meldet die gewaehlte Datenpunkt-Id nach oben und schliesst', async () => {
    const w = await mountPicker()
    await oeffner(w).trigger('click')
    await flushPromises()

    await w.findAll('.dp-picker-item')[0].trigger('click')
    await flushPromises()

    expect(w.emitted('update:modelValue')).toEqual([['dp-1']])
    expect(w.find('.dp-picker').exists()).toBe(false)
  })

  it('zeigt eine bestehende Bindung mit Namen, nicht nur mit Id', async () => {
    const w = await mountPicker({ modelValue: 'dp-1', datapointName: 'dp-m5-solo' })
    expect(w.text()).toContain('dp-m5-solo')
  })

  it('loest eine bestehende Bindung wieder', async () => {
    const w = await mountPicker({ modelValue: 'dp-1', datapointName: 'dp-m5-solo' })
    const loesen = w
      .findAll('button')
      .find((b) => b.text().includes(de.visuEditor.binding.clear))
    await loesen.trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[null]])
  })

  it('schickt kein Token und keine Id in eine URL — die Suche laeuft ueber den Client', async () => {
    const w = await mountPicker()
    await oeffner(w).trigger('click')
    await flushPromises()
    for (const call of searchMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('token')
    }
    expect(w.html()).not.toContain('access_token')
  })
})
