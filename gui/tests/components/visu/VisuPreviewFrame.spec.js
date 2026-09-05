import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'
import { bildaendernd, vorfahrenpfad, zeile } from '../../helpers/previewFrameFence.js'
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
 *
 * Und dazu DER RAHMEN SELBST. Er gehoert zum Paritaetsnachweis der Vorschau
 * (`apps/visu/src/preview/PreviewParity.spec.ts`, Messlatte E3), laesst sich
 * dort aber nicht messen: jene Spec liest `apps/visu`, `packages` und die
 * Skin-Pakete, nicht `gui/` - und der Vorschau-DOM weiss nichts von dem
 * Element, in dem er steckt. `transform`, `filter` oder `zoom` am `<iframe>`
 * (eine Utility-Klasse `scale-90 saturate-50` genuegt) zeigen dem Autor ein
 * verkleinertes, entsaettigtes Bild derselben Seite.
 *
 * WAS DIESE DATEI DAVON MISST, genau: den Rahmen und seinen Vorfahrenpfad
 * INNERHALB DIESER KOMPONENTE - und das in JEDEM Zustand, den sie annehmen kann
 * (verbunden, nicht erreichbar, abgelehnt), nicht nur im Mount-Zustand. Der
 * Vorgaenger las einen einzigen Schnappschuss, und
 * `:class="{ 'scale-90': unreachable }"` am Eltern-`<div>` ging deshalb durch
 * die volle Suite (Kritik R9, N-F).
 *
 * WAS DIESE DATEI NICHT MISST, und wo es steht:
 *
 *   - der Pfad OBERHALB dieser Komponente. Diese Spec mountet den Rahmen
 *     allein; ueber der Komponentenwurzel liegen dann nur der Mount-Container,
 *     `<body>` und `<html>`. Der ECHTE Pfad - inklusive des einbettenden
 *     `<div data-testid="visu-editor">` - steht in `VisuEditorView.spec.js`,
 *     zusammen mit dem Blattscan gegen genau diesen Pfad (Kritik R9, N-A/N-B).
 *   - die BERECHNETE Deklaration aus dem GEBAUTEN Utility-Blatt. Was Tailwind
 *     aus `rounded-lg` oder `bg-white` erzeugt, steht in keinem Quelltext dieses
 *     Repos, und happy-dom rechnet kein CSS aus. Das ist eine echte Grenze des
 *     Verfahrens, keine Testluecke - sie steht als Rest von E3-2 im Kopf von
 *     `apps/visu/src/preview/PreviewParity.spec.ts`.
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

  async function mountFrame(props = { draft: DRAFT }, options = {}) {
    setActivePinia(createPinia())
    const wrapper = mount(VisuPreviewFrame, { props, ...options })
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

  /**
   * DER RAHMEN UND SEIN PFAD, GEPINNT - UND ZWAR IN JEDEM ZUSTAND.
   *
   * Was hier steht, ist der „Bildschirm", auf dem die Vorschau laeuft: eine
   * Klasse mehr - `scale-90`, `saturate-50`, `blur-sm`, `opacity-50` - und der
   * Autor sieht ein anderes Bild als der Nutzer, ohne dass die Paritaets-Spec
   * der Visu etwas davon merken koennte (sie liest `gui/` nicht). `transform`
   * und `filter` ERBEN dabei: dieselbe Klasse am Eltern-`<div>` wirkt Zeichen
   * fuer Zeichen wie am Rahmen selbst (Kritik R8, D1). Gepinnt sind deshalb
   * beide - der `<iframe>` und jedes Element bis zur Komponentenwurzel.
   *
   * Und gepinnt in DREI ZUSTAENDEN, nicht in einem: die Komponente rendert
   * verbunden, nicht erreichbar und abgelehnt. Der Vorgaenger las nur den
   * Mount-Zustand, in dem `rejected` und `unreachable` beide falsch sind -
   * `:class="{ 'scale-90': unreachable, 'saturate-50': rejected }"` am
   * Eltern-`<div>` ging deshalb durch die volle Suite (Kritik R9, N-F). Nach
   * einem abgelehnten Handshake saehe der Autor ein entsaettigtes Bild.
   *
   * Gemessen wird das ATTRIBUT, nicht der gerechnete Stil: welche Deklaration
   * ein Blatt der GUI am Ende auf `rounded-lg` legt, sieht dieser Test nicht -
   * dafuer steht der Blattscan in `VisuEditorView.spec.js`, gegen den ECHTEN
   * Vorfahrenpfad dieser Komponente.
   */
  it('steht in jedem Zustand in einem gepinnten Rahmen und einem gepinnten Vorfahrenpfad', async () => {
    /** Die drei Zustaende, die diese Komponente annehmen kann. */
    const zustaende = [
      [
        'verbunden',
        async (w) => {
          emit(message(VISU_PREVIEW_MESSAGE.ready))
          emit(message(VISU_PREVIEW_MESSAGE.accepted))
          await flushPromises()
          expect(w.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(false)
          expect(w.find('[data-testid="visu-preview-rejected"]').exists()).toBe(false)
        },
      ],
      [
        'nicht erreichbar',
        async (w) => {
          await vi.advanceTimersByTimeAsync(30000)
          await flushPromises()
          // Gegenprobe: der Zustand steht wirklich an - sonst pruefte die
          // Schleife dreimal denselben Mount-Zustand.
          expect(w.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(true)
        },
      ],
      [
        'abgelehnt',
        async (w) => {
          emit(message(VISU_PREVIEW_MESSAGE.rejected, { reason: 'protocol' }))
          await flushPromises()
          expect(w.find('[data-testid="visu-preview-rejected"]').exists()).toBe(true)
        },
      ],
    ]

    vi.useFakeTimers()
    try {
      for (const [name, hinfuehren] of zustaende) {
        const wrapper = await mountFrame({ draft: DRAFT }, { attachTo: document.body })
        await hinfuehren(wrapper)

        const frameEl = wrapper.find('[data-testid="visu-preview-frame"]').element

        // 1 - der Rahmen selbst: Klassenliste Zeichen fuer Zeichen, und kein
        //     Inline-Stil (`transform`, `filter` und `zoom` kaemen sonst auch
        //     auf diesem Weg an, ohne die Klassenliste zu beruehren).
        expect([name, zeile(frameEl)]).toEqual([
          name,
          'iframe | w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white | ',
        ])

        // 2 - der Pfad INNERHALB der Komponente, Zeile fuer Zeile.
        const pfad = []
        for (
          let el = frameEl.parentElement;
          el !== null && wrapper.element.contains(el);
          el = el.parentElement
        ) {
          pfad.push(zeile(el))
        }
        expect([name, pfad]).toEqual([name, ['div | flex flex-col gap-2 | ']])
        expect(frameEl.parentElement).toBe(wrapper.element)

        // 3 - und derselbe Pfad negativ, bis zum `<html>` hinauf: kein Element
        //     ueber dem Rahmen traegt eine Klasse aus der
        //     Transform-/Filter-/Zoom-Familie und keinen Inline-Stil, der
        //     dasselbe von Hand tut. Weil hier an `document.body` gemountet
        //     wird, laeuft diese Schleife ueber ECHTE Elemente - der
        //     Vorgaenger mountete losgeloest, und oberhalb der
        //     Komponentenwurzel lagen nur Container von Vue Test Utils, die nie
        //     eine Klasse tragen (Kritik R9, Punkt 6.2).
        expect([name, bildaendernd([frameEl, ...vorfahrenpfad(frameEl)])]).toEqual([name, []])

        // 4 - GEGENPROBE, und eine, die FALLEN KANN: der Eltern-`<div>` bekommt
        //     genau die Klasse des Angriffs, und die Pruefung muss sie melden.
        const eltern = frameEl.parentElement
        eltern.classList.add('scale-90')
        try {
          expect([name, bildaendernd([frameEl, ...vorfahrenpfad(frameEl)])]).toEqual([
            name,
            ['div | flex flex-col gap-2 scale-90 |  -> Klasse scale-90'],
          ])
        } finally {
          eltern.classList.remove('scale-90')
        }

        wrapper.unmount()
      }
    } finally {
      vi.useRealTimers()
    }
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

  it('nimmt den Hinweis zurueck, wenn sich die Vorschau doch noch meldet', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountFrame()
      await vi.advanceTimersByTimeAsync(30000)
      await flushPromises()
      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(true)

      // Ein langsam ladendes Visu-Bundle meldet sich nach der Frist. Der
      // Handshake steht damit; der Hinweis behauptet ab jetzt etwas Falsches.
      // Auf einen `draft-applied` zu warten hilft nicht: solange der Editor
      // keinen Entwurf hat, kommt keiner.
      emit(message(VISU_PREVIEW_MESSAGE.ready))
      emit(message(VISU_PREVIEW_MESSAGE.accepted))
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
