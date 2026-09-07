import { describe, it, expect, afterEach } from 'vitest'
import { reactive } from 'vue'
import {
  createVisuPreviewBridge,
  VISU_PREVIEW_CHANNEL,
  VISU_PREVIEW_MESSAGE,
  VISU_PREVIEW_PROTOCOL,
} from '@/composables/useVisuPreviewBridge'

/**
 * Issue #183, Punkt 2: ein Szenario ueber eine ECHTE `<iframe>`-Grenze - kein
 * Ereignis-Bus (`makeBus()` in `useVisuPreviewBridge.spec.js`), kein direkt
 * aufgerufener Handler. Der Entwurf muss WIRKLICH per
 * `HTMLIFrameElement.contentWindow.postMessage` unterwegs sein und WIRKLICH
 * `structuredClone` durchlaufen, bevor er ankommt - genau die Eigenschaft, die
 * elf Abnahmerunden mit Mutationsproben nicht sehen konnten (#183): die
 * Senderspec ersetzte `postMessage` durch einen Array-Push, der nie klont.
 *
 * ZWEI GRENZEN von happy-dom (v20, Vitest-Environment dieses Projekts),
 * EMPIRISCH belegt (mit `node -e`/Wegwerf-Proben geprueft, nicht behauptet)
 * und deshalb ausdruecklich benannt statt stillschweigend umschifft:
 *
 *  1. happy-dom klont bei `postMessage` NICHT wirklich - ein Objekt reist mit
 *     GLEICHER Referenz durch die Grenze (belegt: nach dem Versand eine
 *     Eigenschaft am Original mutiert, und die Mutation war auf der
 *     Empfangsseite sichtbar). Ein Vue-Proxy wuerde also nie mit
 *     `DataCloneError` scheitern, obwohl er es im Browser wuerde - die Probe
 *     waere sonst wertlos, genau wie der Array-Push, den sie ersetzen soll.
 *     Diese Datei erzwingt den fehlenden Schritt deshalb selbst, mit Nodes
 *     ECHTEM `structuredClone` (verfuegbar seit Node 17, hier per
 *     `node -e "structuredClone(new Proxy({...}, {}))"` gegen einen
 *     Vue-`reactive()`-Proxy geprueft: wirft `DataCloneError`, wortgleich zur
 *     Browser-Meldung) - demselben Algorithmus, den ein Browser bei
 *     `postMessage` intern anwendet.
 *  2. happy-dom haengt bei einer Nachricht aus einem ECHTEN, separaten
 *     Skript-Kontext im iframe (eigener `vm.Context` mit
 *     `enableJavaScriptEvaluation`) an `MessageEvent.source` NICHT die
 *     Fensterreferenz des iframes, sondern die des Hauptfensters - fuer die
 *     Richtung iframe -> Hauptfenster empirisch geprueft und falsch. Fuer die
 *     Richtung Editor -> Vorschau spielt das keine Rolle: dort erzeugt DIESE
 *     Datei die Nachricht per echtem `postMessage` auf der echten
 *     `iframe.contentWindow`-Referenz, und die Vorschau-Seite hoert direkt auf
 *     GENAU dieser Referenz - keine Quellenpruefung noetig, weil niemand sonst
 *     in diesem Test an dieses Fenster schreiben kann. Fuer die Ruecklaeufe
 *     Vorschau -> Editor (`ready`/`accepted`/`draft-applied`), wo die ECHTE
 *     Bruecke (`useVisuPreviewBridge.js`) die Quelle PRUEFT, laesst sich das
 *     in happy-dom nicht ueber ein echtes zweites Skript treiben. Diese drei
 *     Nachrichten bildet dieser Test deshalb ueber
 *     `window.dispatchEvent(new MessageEvent(...))` nach, mit der ECHTEN
 *     `iframe.contentWindow`-Referenz als `source` - Kanal, Protokoll UND
 *     Herkunft bleiben dabei echte Werte, gegen die die Bruecke ungeaendert
 *     prueft; nur der zweite Skript-Kontext, der sie im Browser tatsaechlich
 *     schickt, fehlt. Das volle zweite Bundle bleibt Playwright vorbehalten
 *     (`apps/visu/e2e/m5-editor-matrix.spec.ts`).
 *
 * Die eine Nachricht, um die es in #183 tatsaechlich ging - der ENTWURF,
 * Editor -> Vorschau - braucht KEINEN dieser Kompromisse: sie geht als echtes
 * `postMessage` ueber eine echte `<iframe>`-Grenze, mit einem echten
 * Vue-`reactive()`-Proxy als Quelle (nicht mit reinen Daten injiziert, wie in
 * jeder Empfaengerspec vor #183), und die Vorschau-Seite hoert mit einem
 * echten `addEventListener('message')` auf dem echten `iframe.contentWindow`.
 */

const TOKEN = 'gui-iframe-e2e-token'

/**
 * Erzwingt an EINEM Fenster den Klon-Schritt, den happy-dom bei `postMessage`
 * auslaesst (Grenze 1 oben): jede ausgehende Nachricht muss `structuredClone`
 * ueberstehen, bevor sie (als bereits geklonte Kopie) an die echte
 * happy-dom-Implementierung weitergereicht wird. Ein Proxy, der das nicht
 * uebersteht, wirft hier - wie im Browser - `DataCloneError`.
 */
function mitEchtemKlon(win) {
  const original = win.postMessage.bind(win)
  win.postMessage = (message, targetOrigin) => {
    const geklont = structuredClone(message)
    original(geklont, targetOrigin)
  }
  return () => {
    win.postMessage = original
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('useVisuPreviewBridge — echte iframe-Grenze (#183)', () => {
  let iframe
  let restoreClone
  let previousDisableIframeLoading

  afterEach(() => {
    if (restoreClone) restoreClone()
    if (iframe) iframe.remove()
    if (previousDisableIframeLoading !== undefined) {
      window.happyDOM.settings.disableIframePageLoading = previousDisableIframeLoading
    }
    iframe = null
    restoreClone = null
  })

  it('schickt einen reaktiven Entwurf wirklich ueber eine <iframe>-Grenze - inklusive echtem structuredClone', async () => {
    previousDisableIframeLoading = window.happyDOM.settings.disableIframePageLoading
    window.happyDOM.settings.disableIframePageLoading = false

    iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    await flush()
    const previewWindow = iframe.contentWindow
    expect(previewWindow).toBeTruthy()
    // Eine ANDERE Window-Instanz als das Hauptfenster - keine Attrappe.
    expect(previewWindow).not.toBe(window)

    // happy-dom prueft den Ziel-Origin beim ECHTEN `postMessage` GEGEN DEN
    // ECHTEN Origin des Empfaengerfensters (belegt: ein `targetOrigin`, das
    // nicht zum unnavigierten `about:blank`-Fenster passt, wirft eine echte
    // `SecurityError`) - also gilt hier derselbe opake Origin fuer beide
    // Seiten, statt ihn zu erfinden.
    const PREVIEW_ORIGIN = previewWindow.location.origin
    expect(PREVIEW_ORIGIN).toBeTruthy()

    restoreClone = mitEchtemKlon(previewWindow)

    // Ein ECHTER Vue-Proxy, keine reinen Daten - genau das, was #183 als
    // fehlende Eigenschaft benennt ("den Empfaengerspecs werden reine Daten
    // injiziert, nie ein reaktives Objekt").
    const draft = reactive({
      skin: 'edomi',
      pageId: 'p1',
      nodes: [
        {
          id: 'p1',
          parent_id: null,
          name: 'Wurzel',
          type: 'PAGE',
          kind: 'normal',
          order: 0,
          access: null,
          page_config: { widgets: [] },
        },
      ],
    })

    const empfangenAufVorschau = []
    previewWindow.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.channel !== VISU_PREVIEW_CHANNEL) return
      empfangenAufVorschau.push(ev)
    })

    const angewendet = []
    const bridge = createVisuPreviewBridge({
      previewOrigin: PREVIEW_ORIGIN,
      listener: window,
      getFrameWindow: () => previewWindow,
      getSession: () => ({ accessToken: TOKEN }),
      getDraft: () => draft,
      onApplied: (info) => angewendet.push(info),
    })
    bridge.start()

    // 1. Die Vorschau meldet sich - ECHTES postMessage, ECHTE iframe-Grenze
    //    (Grenze 2 oben: die Herkunft der Antwort wird hier nachgebildet, der
    //    ECHTE Versand des Editors darauf ist es nicht).
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.ready, protocol: VISU_PREVIEW_PROTOCOL },
        origin: PREVIEW_ORIGIN,
        source: previewWindow,
      }),
    )
    await flush()

    // Der Editor hat WIRKLICH per postMessage geantwortet - die Vorschau hat
    // es auf ihrem EIGENEN, echten Fenster empfangen.
    expect(empfangenAufVorschau).toHaveLength(1)
    expect(empfangenAufVorschau[0].data).toMatchObject({
      type: VISU_PREVIEW_MESSAGE.init,
      session: { accessToken: TOKEN },
    })

    // 2. Handshake steht.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL },
        origin: PREVIEW_ORIGIN,
        source: previewWindow,
      }),
    )
    await flush()

    // 3. DER ENTWURF - die Nachricht, um die es in #183 ging. Wirklich per
    //    postMessage ueber die iframe-Grenze, wirklich geklont: haette der
    //    Klon-Waechter der Bruecke (`cloneSafeEnvelope`) gefehlt, waere der
    //    rohe Proxy hier angekommen und `mitEchtemKlon()` haette
    //    `DataCloneError` geworfen - dieser Test waere ROT. (Siehe Bericht:
    //    genau das wurde gegen den unreparierten Stand gefahren.)
    const entwurfsNachricht = empfangenAufVorschau.find((ev) => ev.data.type === VISU_PREVIEW_MESSAGE.draft)
    expect(entwurfsNachricht).toBeDefined()
    expect(entwurfsNachricht.data.draft).toEqual({
      skin: 'edomi',
      pageId: 'p1',
      nodes: [
        {
          id: 'p1',
          parent_id: null,
          name: 'Wurzel',
          type: 'PAGE',
          kind: 'normal',
          order: 0,
          access: null,
          page_config: { widgets: [] },
        },
      ],
    })

    // Der endgueltige Beleg fuer einen ECHTEN Klon statt einer geteilten
    // Referenz: eine Mutation am Original NACH dem Versand darf drueben nicht
    // ankommen.
    draft.pageId = 'MUTATED-NACH-DEM-VERSAND'
    expect(entwurfsNachricht.data.draft.pageId).toBe('p1')

    // 4. Die Vorschau meldet den gerenderten Entwurf zurueck - auch dieser
    //    Ruecklauf kommt beim Editor an (Grenze 2: nachgebildete Herkunft,
    //    echte Pruefung dagegen).
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          channel: VISU_PREVIEW_CHANNEL,
          type: VISU_PREVIEW_MESSAGE.draftApplied,
          protocol: VISU_PREVIEW_PROTOCOL,
          pageId: 'p1',
          widgetCount: 0,
        },
        origin: PREVIEW_ORIGIN,
        source: previewWindow,
      }),
    )
    await flush()
    expect(angewendet).toEqual([{ pageId: 'p1', widgetCount: 0 }])
  })
})
