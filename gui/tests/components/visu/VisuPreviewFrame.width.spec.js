import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { bildaendernd, vorfahrenpfad, zeile } from '../../helpers/previewFrameFence.js'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'

/**
 * Die feste Vorschau-Breite (M5 C2, Issue #169, Messlatte **E17**).
 *
 * Der Autor waehlt einen Breakpoint, und die Vorschau muss GENAU so breit
 * layouten - der Harness misst `clientWidth` am `iframe.editor-preview`.
 * `clientWidth` ist die Innenbreite: mit dem global gesetzten `border-box` und
 * dem Rahmenstrich waere sie um zwei Pixel kleiner als der Breakpoint, deshalb
 * setzt der Rahmen zur Breite auch `box-sizing: content-box`.
 *
 * Der zweite Teil ist die Ruecksicht auf den Zaun aus Teil C4: ohne gewaehlte
 * Breite darf gar KEIN `style`-Attribut am Rahmen stehen (der Pin in
 * `VisuPreviewFrame.spec.js` liest es Zeichen fuer Zeichen), und die Breite
 * selbst gehoert keiner der Familien, die das BILD im Rahmen aendern.
 */

describe('VisuPreviewFrame - feste Vorschau-Breite (E17)', () => {
  it('traegt die Marke, an der der Harness den Rahmen anspricht', () => {
    const w = mount(VisuPreviewFrame)
    expect(w.find('iframe').classes()).toContain('editor-preview')
  })

  it('setzt ohne gewaehlte Breite gar kein style-Attribut', () => {
    const w = mount(VisuPreviewFrame)
    expect(w.find('iframe').element.getAttribute('style')).toBeNull()
    expect(zeile(w.find('iframe').element)).toContain('| ')
  })

  it('setzt die gewaehlte Breite als Innenbreite', () => {
    const w = mount(VisuPreviewFrame, { props: { width: 480 } })
    const style = w.find('iframe').element.getAttribute('style')
    expect(style).toContain('width: 480px')
    expect(style).toContain('content-box')
  })

  it('nimmt die Breite wieder zurueck, wenn der Autor „automatisch" waehlt', async () => {
    const w = mount(VisuPreviewFrame, { props: { width: 480 } })
    await w.setProps({ width: null })
    expect(w.find('iframe').element.getAttribute('style')).toBeNull()
  })

  it('aendert mit der Breite nicht das BILD im Rahmen', () => {
    const w = mount(VisuPreviewFrame, { props: { width: 480 }, attachTo: document.body })
    const frame = w.find('iframe').element
    expect(bildaendernd([frame, ...vorfahrenpfad(frame)])).toEqual([])
    w.unmount()
  })
})
