/**
 * Die Editor-Seite der Vorschau-Bruecke (M5 C4, Issue #171).
 *
 * Spiegelbild von `apps/visu/src/preview/receiver.ts`. Der Editor schickt den
 * Entwurf und die Admin-Session per `postMessage` in die eingebettete Vorschau;
 * die Vorschau rendert ihn ueber denselben SkinHost wie die echte Visu
 * (Messlatte **E3**: kein zweiter Renderer).
 *
 * Die Regeln, die diese Naht sicher machen:
 *  - **Origin-Pruefung in beide Richtungen.** Angenommen wird nur, was aus dem
 *    Origin der Vorschau kommt; gesendet wird nur dorthin, nie an `'*'`. Ohne
 *    bekannten Origin wird gar keine Bruecke aufgebaut.
 *  - **Quellenpruefung.** Auch aus der richtigen Herkunft darf nur DAS Fenster
 *    reden, in dem die Vorschau laeuft (`iframe.contentWindow`). Der Normalfall
 *    ist same-origin, dort koennte sonst jedes gleich-origin Fenster
 *    `accepted`/`rejected`/`draft-applied` faelschen. Spiegelbild von
 *    `receiver.ts` Schritt 2.
 *  - **Erst die Version, dann die Session.** Die Protokollversion der Gegenseite
 *    wird geprueft, BEVOR das Admin-Token hinausgeht - eine Vorschau, die eine
 *    andere Version spricht, bekommt es gar nicht erst zu sehen. Eine
 *    Abweichung schliesst die Bruecke dauerhaft.
 *  - **Die Session geht nur per postMessage.** Sie steht in keiner iframe-URL,
 *    keiner Query und keinem Log; ohne Session wird nichts gesendet.
 *  - **Eine Frist, und ihre Ruecknahme.** Meldet sich in `handshakeTimeoutMs`
 *    keine Vorschau, sagt die Bruecke das nach oben. Ohne sie bliebe ein iframe,
 *    der etwas ganz anderes geladen hat, still stehen - der Autor saehe ein
 *    fremdes Bild ohne Hinweis. Kommt der Handshake danach doch noch zustande
 *    (ein langsam ladendes Bundle), meldet die Bruecke auch DAS nach oben: ein
 *    Hinweis, der eine laengst vorbeigegangene Lage behauptet, ist so irrefuehrend
 *    wie gar keiner.
 *
 * ACHTUNG bei Aenderungen: Kanal, Version und Typen muessen mit
 * `apps/visu/src/preview/protocol.ts` uebereinstimmen. Die GUI liegt nicht im
 * pnpm-Workspace der Visu, kann den Vertrag also nicht importieren — die
 * Konstanten hier sind die bewusst gespiegelte Kopie, und die Version macht ein
 * Auseinanderlaufen sichtbar statt still.
 */

export const VISU_PREVIEW_CHANNEL = 'obs-visu-preview'
export const VISU_PREVIEW_PROTOCOL = '1.1'

/**
 * Wie lange auf ein `preview/ready` gewartet wird, bevor die Lage als „keine
 * Vorschau" gilt. Grosszuegig genug fuer ein langsam ladendes Visu-Bundle, kurz
 * genug, dass niemand minutenlang auf ein falsches Bild schaut.
 */
export const VISU_PREVIEW_HANDSHAKE_TIMEOUT_MS = 8000

export const VISU_PREVIEW_MESSAGE = {
  ready: 'preview/ready',
  init: 'preview/init',
  accepted: 'preview/accepted',
  rejected: 'preview/rejected',
  draft: 'preview/draft',
  draftApplied: 'preview/draft-applied',
}

/**
 * Der Klon-Waechter der Bruecke (Issue #183).
 *
 * NACHGEMESSEN in Runde 2: der `DataCloneError` aus #183 war zu diesem
 * Zeitpunkt bereits behoben - seit #169 (Commit `e047328b`) macht `post()`
 * schon eine reine JSON-Kopie, BEVOR `postMessage` sie sieht, und ein
 * `JSON.parse(JSON.stringify(…))`-Ergebnis besteht jeden echten
 * `structuredClone` selbst hinter einer eingebetteten `<iframe>`-Grenze
 * (belegt: `useVisuPreviewBridge.iframeBoundary.spec.js` lief gegen die
 * UNVERAENDERTE Datei von `e047328b`/`c2b30910` bereits gruen). Diese Funktion
 * fixt also keinen offenen Fehler mehr - sie buendelt die JSON-Kopie an EINEM
 * benannten Ort mit einer Fehlermeldung, die sagt WELCHE Bruecke betroffen
 * ist, statt eines rohen `SyntaxError`/`TypeError` aus `JSON.stringify`.
 *
 * Ein einziger Schritt, nicht zwei: eine zweite Klonprobe mit `structuredClone`
 * auf dem JSON-Ergebnis stand hier bis Runde 2 zusaetzlich - eine
 * Mutationsprobe zeigte, dass sie NIE ausloesen kann und deshalb toten Code
 * darstellte. Der Grund ist strukturell: alles, was `JSON.parse(JSON.stringify(…))`
 * uebersteht, ist per Konstruktion bereits auf reine Objekte, Arrays, Strings,
 * Zahlen, Booleans und `null` reduziert - genau die Werte, die der
 * Struktur-Klon-Algorithmus als Erstes und ohne jede Einschraenkung klont. Ein
 * zweiter Aufruf konnte also nur entweder klaglos durchlaufen oder - nie -
 * werfen; ihn zu entfernen aendert kein Verhalten, schliesst aber einen Zweig,
 * den keine Probe je rot faerben konnte.
 *
 * WAS DIESER WAECHTER NICHT LEISTET (die vorige Fassung behauptete das
 * faelschlich): er verhindert KEINE still verstuemmelte Nutzlast. Der
 * JSON-Umweg selbst engt die Typen ein - `Date` wird zu einem String, `Map`/
 * `Set` werden zu `{}`, `undefined` verschwindet lautlos - und all das wirft
 * NICHT, laeuft also unbemerkt durch. Verhindert wird nur, was am JSON-Umweg
 * selbst scheitert (ein zirkulaerer Verweis, ein `BigInt`) - dafuer bricht er
 * mit einer eindeutigen Meldung ab. Dass die Nutzlast der Bruecke (`PreviewDraft`,
 * `apps/visu/src/preview/protocol.ts`) ohnehin nur Strings, Zahlen, Booleans
 * und Structs davon fuehrt, ist eine Eigenschaft des VERTRAGS, keine dieser
 * Funktion.
 */
export function cloneSafeEnvelope(message) {
  try {
    return JSON.parse(JSON.stringify(message))
  } catch (err) {
    throw new Error(`Vorschau-Bruecke: Nutzlast ist nicht JSON-faehig (${err.message})`)
  }
}

/**
 * Baut die Bruecke zu einer eingebetteten Vorschau.
 *
 * @param {object}   options
 * @param {string|null} options.previewOrigin  Der einzige erlaubte Gegen-Origin.
 * @param {object}   options.listener          Wo gelauscht wird (in der App: `window`).
 * @param {Function} options.getFrameWindow    Liefert das `contentWindow` des iframes.
 * @param {Function} options.getSession        Liefert `{ accessToken }` oder null.
 * @param {Function} options.getDraft          Liefert den aktuellen Entwurf oder null.
 * @param {Function} [options.onApplied]       Die Vorschau hat gerendert.
 * @param {Function} [options.onAccepted]      Der Handshake steht (auch spaet).
 * @param {Function} [options.onRejected]      Die Vorschau hat abgelehnt (mit Grund).
 * @param {Function} [options.onTimeout]       Innerhalb der Frist kam kein Handshake.
 * @param {number}   [options.handshakeTimeoutMs] Die Frist in ms.
 */
export function createVisuPreviewBridge({
  previewOrigin,
  listener,
  getFrameWindow,
  getSession,
  getDraft,
  onApplied,
  onAccepted,
  onRejected,
  onTimeout,
  handshakeTimeoutMs = VISU_PREVIEW_HANDSHAKE_TIMEOUT_MS,
}) {
  /** Steht der Handshake? Vorher wird kein Entwurf gesendet. */
  let ready = false
  /** Endgueltig zu (Versionsabweichung) - danach wird nichts mehr angenommen. */
  let closed = false
  /** Laufende Frist auf den Handshake. */
  let timer = null

  function clearHandshakeTimer() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  /**
   * Gesendet wird REINE DATEN.
   *
   * `postMessage` klont strukturiert, und der Algorithmus lehnt einen Proxy ab
   * (`DataCloneError: #<Object> could not be cloned`). Der Entwurf kommt aus dem
   * Canvas und liegt oben in einem `ref()` - jede Ebene davon ist also ein
   * reaktiver Proxy, auch wenn der Erzeuger reine Daten geliefert hat.
   *
   * Belegt in Runde 2 von Teil C2, als die Vorschau zum ersten Mal auf die ECHTE
   * Visu zeigte (`VITE_VISU_PREVIEW_URL=http://…/preview` statt der Adresse, die
   * heute niemand ausliefert): der Handshake stand, im Rahmen blieb trotzdem
   * „Warte auf einen Entwurf aus dem Editor" stehen, und in der Konsole des
   * Editors stand genau dieser Fehler. Solange im Rahmen keine Vorschau
   * antwortete, kam es nie so weit - ohne Handshake wird nichts gesendet, und
   * der Fehler konnte gar nicht auftreten.
   *
   * Der Vertrag nennt beide Nachrichtenformen ohnehin als Daten (Protokoll 1.1);
   * der JSON-Umweg ist ihre Form und keine Notloesung.
   *
   * Der Waechter WIRFT bei einer Nutzlast, die den JSON-Umweg selbst nicht
   * uebersteht - gefangen wird das HIER, am einzigen Aufrufer, nicht beim
   * Aufrufer von `post()`. Ohne diesen Fang liefe die Ausnahme ungefangen bis
   * zu dem Vue-`watch`, der `sendDraft()` bei jeder Entwurfsaenderung ruft
   * (`VisuPreviewFrame.vue`) - ein Waechter, dessen Fehler niemanden erreicht,
   * ersetzt einen unsichtbaren Fehler nur durch einen anderen. Der Fehlerfall
   * geht deshalb ueber denselben Weg wie eine Ablehnung durch die Vorschau
   * selbst: `onRejected('clone')`, dieselbe Anzeige, die auch fuer `payload`
   * und `protocol` steht.
   */
  function post(message) {
    if (!previewOrigin) return
    const target = getFrameWindow ? getFrameWindow() : null
    if (!target) return
    let envelope
    try {
      envelope = cloneSafeEnvelope({
        channel: VISU_PREVIEW_CHANNEL,
        protocol: VISU_PREVIEW_PROTOCOL,
        ...message,
      })
    } catch {
      if (onRejected) onRejected('clone')
      return
    }
    target.postMessage(envelope, previewOrigin)
  }

  function sendDraft() {
    if (!ready) return
    const draft = getDraft ? getDraft() : null
    if (!draft) return
    post({ type: VISU_PREVIEW_MESSAGE.draft, draft })
  }

  function handle(ev) {
    if (closed) return
    // 1. Herkunft.
    if (!previewOrigin || !ev || ev.origin !== previewOrigin) return
    // 2. Quelle: nur das Fenster, in dem die Vorschau laeuft.
    const target = getFrameWindow ? getFrameWindow() : null
    if (!target || ev.source !== target) return
    // 3. Kanal.
    const data = ev.data
    if (!data || typeof data !== 'object') return
    if (data.channel !== VISU_PREVIEW_CHANNEL) return
    // 4. Version - VOR jeder Antwort, also insbesondere vor der Session.
    if (data.protocol !== VISU_PREVIEW_PROTOCOL) {
      closed = true
      ready = false
      clearHandshakeTimer()
      if (onRejected) onRejected('protocol')
      return
    }

    if (data.type === VISU_PREVIEW_MESSAGE.ready) {
      const session = getSession ? getSession() : null
      // Ohne Session gar nichts senden: eine leere Session wuerde die Vorschau
      // in einen Gast-Zustand bringen, der wie ein Rechteproblem aussieht.
      if (!session || !session.accessToken) return
      post({ type: VISU_PREVIEW_MESSAGE.init, session })
      return
    }
    if (data.type === VISU_PREVIEW_MESSAGE.accepted) {
      ready = true
      clearHandshakeTimer()
      // Auch wenn die Frist schon gelaufen ist: der Handshake steht jetzt, und
      // wer die Frist gemeldet bekam, muss erfahren, dass sie ueberholt ist.
      if (onAccepted) onAccepted()
      sendDraft()
      return
    }
    if (data.type === VISU_PREVIEW_MESSAGE.rejected) {
      ready = false
      clearHandshakeTimer()
      if (onRejected) onRejected(data.reason || 'payload')
      return
    }
    if (data.type === VISU_PREVIEW_MESSAGE.draftApplied) {
      if (onApplied) onApplied({ pageId: data.pageId, widgetCount: data.widgetCount })
    }
  }

  return {
    start() {
      listener.addEventListener('message', handle)
      // Die Vorschau meldet sich von selbst (`preview/ready`). Bleibt das aus,
      // hat der Rahmen etwas anderes geladen — heute im Standardfall die
      // Admin-GUI selbst ueber den SPA-404-Fallback, weil die Ausliefer-Route
      // der Vorschau noch fehlt (Teil D, s. `visuEditorAccess.js`).
      clearHandshakeTimer()
      if (handshakeTimeoutMs > 0) {
        timer = setTimeout(() => {
          timer = null
          if (ready || closed) return
          if (onTimeout) onTimeout()
        }, handshakeTimeoutMs)
      }
    },
    stop() {
      listener.removeEventListener('message', handle)
      clearHandshakeTimer()
      ready = false
    },
    sendDraft,
    isReady: () => ready,
  }
}
