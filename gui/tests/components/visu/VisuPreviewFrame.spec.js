import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'
import {
  VISU_PREVIEW_CHANNEL,
  VISU_PREVIEW_MESSAGE,
  VISU_PREVIEW_PROTOCOL,
} from '@/composables/useVisuPreviewBridge'

/**
 * Die eingebettete Vorschau des Visu-Editors (M5 C4, Issue #171).
 *
 * Der Composable-Test pinnt die Regeln der Bruecke; hier laeuft die Verdrahtung
 * an der echten Komponente: iframe, Session aus dem Admin-Login, Entwurf, und
 * die beiden Rueckmeldungen. Wichtigster Punkt: die Session geht per
 * postMessage an den geprueften Origin und steht nie in der iframe-URL.
 */

const PREVIEW_ORIGIN = window.location.origin
const EVIL_ORIGIN = 'https://evil.example'
const TOKEN = 'gui-admin-token-4c2f'

const DRAFT = {
  skin: 'edomi',
  pageId: 'p1',
  nodes: [{ id: 'p1', parent_id: null, name: 'W', type: 'PAGE', kind: 'normal', page_config: { widgets: [] } }],
}

/**
 * Das Fenster-Doppel des iframes dieser Montage. Es ist die einzige Quelle, von
 * der die Bruecke etwas annimmt - genau wie im Browser `iframe.contentWindow`.
 */
let frameWindow = null

/** Ein `message`-Ereignis von Hand einspeisen (happy-dom laesst kein fremdes source zu). */
function emit(data, origin = PREVIEW_ORIGIN, source = frameWindow) {
  window.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }))
}

const message = (type, extra = {}) => ({
  channel: VISU_PREVIEW_CHANNEL,
  type,
  protocol: VISU_PREVIEW_PROTOCOL,
  ...extra,
})

describe('VisuPreviewFrame — die Bruecke an der echten Komponente', () => {
  /** Die ausgehenden Nachrichten DIESER Montage - jede Montage hat ihre eigene
   *  Ablage, sonst wuerde eine noch haengende Vorgaengerin mitzaehlen. */
  let sent
  const mounted = []

  async function mountFrame(props = { draft: DRAFT }) {
    setActivePinia(createPinia())
    const wrapper = mount(VisuPreviewFrame, { props })
    mounted.push(wrapper)
    await flushPromises()
    // Das iframe-Fenster durch ein Doppel ersetzen, damit die ausgehenden
    // Nachrichten pruefbar sind.
    const box = []
    sent = box
    frameWindow = {
      postMessage: (msgObj, targetOrigin) => box.push({ message: msgObj, targetOrigin }),
    }
    Object.defineProperty(wrapper.find('iframe').element, 'contentWindow', {
      configurable: true,
      value: frameWindow,
    })
    return wrapper
  }

  beforeEach(() => {
    globalThis.localStorage.setItem('access_token', TOKEN)
  })
  afterEach(() => {
    // Ohne Ausbauen bleibt der `message`-Zuhoerer jeder Montage am Fenster
    // haengen und der naechste Test misst zwei Bruecken statt einer.
    for (const w of mounted.splice(0)) {
      try {
        w.unmount()
      } catch {
        /* schon ausgebaut (der Ausbau-Test macht es selbst) */
      }
    }
    globalThis.localStorage.removeItem('access_token')
  })

  it('zeigt das iframe, ohne die Session an die URL zu haengen', async () => {
    const wrapper = await mountFrame()
    const src = wrapper.find('[data-testid="visu-preview-frame"]').attributes('src')
    expect(src).toBeTruthy()
    expect(src).not.toContain(TOKEN)
    expect(src).not.toContain('?')
  })

  it('schickt die Admin-Session erst auf preview/ready und nur an den geprueften Origin', async () => {
    await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    await flushPromises()

    expect(sent).toHaveLength(1)
    expect(sent[0].targetOrigin).toBe(PREVIEW_ORIGIN)
    expect(sent[0].message).toMatchObject({
      type: VISU_PREVIEW_MESSAGE.init,
      protocol: VISU_PREVIEW_PROTOCOL,
      session: { accessToken: TOKEN },
    })
  })

  it('schickt ohne Admin-Session gar nichts', async () => {
    globalThis.localStorage.removeItem('access_token')
    await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    await flushPromises()
    expect(sent).toHaveLength(0)
  })

  it('schickt den Entwurf nach der Bestaetigung und bei jeder Aenderung erneut', async () => {
    const wrapper = await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    emit(message(VISU_PREVIEW_MESSAGE.accepted))
    await flushPromises()

    const first = sent.filter((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)
    expect(first).toHaveLength(1)
    expect(first[0].message.draft).toEqual(DRAFT)

    await wrapper.setProps({ draft: { ...DRAFT, pageId: 'p2' } })
    await flushPromises()
    const all = sent.filter((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)
    expect(all).toHaveLength(2)
    expect(all[1].message.draft.pageId).toBe('p2')
  })

  it('meldet den gerenderten Entwurf nach oben', async () => {
    const wrapper = await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.draftApplied, { pageId: 'p1', widgetCount: 4 }))
    await flushPromises()

    expect(wrapper.emitted('applied')).toBeTruthy()
    expect(wrapper.emitted('applied')[0][0]).toEqual({ pageId: 'p1', widgetCount: 4 })
  })

  it('zeigt eine Ablehnung sichtbar an, statt sie zu verschlucken', async () => {
    const wrapper = await mountFrame()
    expect(wrapper.find('[data-testid="visu-preview-rejected"]').exists()).toBe(false)

    emit(message(VISU_PREVIEW_MESSAGE.rejected, { reason: 'protocol' }))
    await flushPromises()

    expect(wrapper.emitted('rejected')[0]).toEqual(['protocol'])
    expect(wrapper.find('[data-testid="visu-preview-rejected"]').exists()).toBe(true)
  })

  it('reagiert auf eine fremde Herkunft gar nicht', async () => {
    const wrapper = await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready), EVIL_ORIGIN)
    emit(message(VISU_PREVIEW_MESSAGE.draftApplied, { pageId: 'p1', widgetCount: 4 }), EVIL_ORIGIN)
    await flushPromises()

    expect(sent).toHaveLength(0)
    expect(wrapper.emitted('applied')).toBeFalsy()
  })

  it('glaubt einem fremden Fenster nichts, auch nicht bei passender Herkunft', async () => {
    const wrapper = await mountFrame()
    const fremdesFenster = { postMessage: () => {} }

    emit(message(VISU_PREVIEW_MESSAGE.ready), PREVIEW_ORIGIN, fremdesFenster)
    emit(message(VISU_PREVIEW_MESSAGE.draftApplied, { pageId: 'p1', widgetCount: 4 }), PREVIEW_ORIGIN, fremdesFenster)
    emit(message(VISU_PREVIEW_MESSAGE.rejected, { reason: 'protocol' }), PREVIEW_ORIGIN, fremdesFenster)
    await flushPromises()

    expect(sent).toHaveLength(0)
    expect(wrapper.emitted('applied')).toBeFalsy()
    expect(wrapper.find('[data-testid="visu-preview-rejected"]').exists()).toBe(false)
  })

  it('sagt es, wenn im Rahmen ueberhaupt keine Vorschau antwortet', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountFrame()
      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(false)

      // Der Rahmen laedt etwas anderes (heute: die Admin-GUI ueber den
      // SPA-404-Fallback) und meldet sich nie. Ohne Frist bliebe das stumm.
      await vi.advanceTimersByTimeAsync(30000)
      await flushPromises()

      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('zeigt den Hinweis nicht, wenn die Vorschau sich meldet', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountFrame()
      emit(message(VISU_PREVIEW_MESSAGE.ready))
      emit(message(VISU_PREVIEW_MESSAGE.accepted))
      await flushPromises()
      await vi.advanceTimersByTimeAsync(30000)
      await flushPromises()

      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hoert nach dem Ausbauen nicht mehr zu', async () => {
    const wrapper = await mountFrame()
    wrapper.unmount()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    await flushPromises()
    expect(sent).toHaveLength(0)
  })
})
