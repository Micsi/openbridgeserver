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
 *  - **Handshake mit Versionsangabe**, damit ein getrennt ausgeliefertes
 *    `gui_dist` und Visu-Bundle nicht still halb zusammenpassen.
 *  - **Die Session geht nur per postMessage.** Sie steht in keiner iframe-URL,
 *    keiner Query und keinem Log; ohne Session wird nichts gesendet.
 *
 * ACHTUNG bei Aenderungen: Kanal, Version und Typen muessen mit
 * `apps/visu/src/preview/protocol.ts` uebereinstimmen. Die GUI liegt nicht im
 * pnpm-Workspace der Visu, kann den Vertrag also nicht importieren — die
 * Konstanten hier sind die bewusst gespiegelte Kopie, und die Version macht ein
 * Auseinanderlaufen sichtbar statt still.
 */

export const VISU_PREVIEW_CHANNEL = 'obs-visu-preview'
export const VISU_PREVIEW_PROTOCOL = '1.0'

export const VISU_PREVIEW_MESSAGE = {
  ready: 'preview/ready',
  init: 'preview/init',
  accepted: 'preview/accepted',
  rejected: 'preview/rejected',
  draft: 'preview/draft',
  draftApplied: 'preview/draft-applied',
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
 * @param {Function} [options.onRejected]      Die Vorschau hat abgelehnt (mit Grund).
 */
export function createVisuPreviewBridge({
  previewOrigin,
  listener,
  getFrameWindow,
  getSession,
  getDraft,
  onApplied,
  onRejected,
}) {
  /** Steht der Handshake? Vorher wird kein Entwurf gesendet. */
  let ready = false

  function post(message) {
    if (!previewOrigin) return
    const target = getFrameWindow ? getFrameWindow() : null
    if (!target) return
    target.postMessage(
      { channel: VISU_PREVIEW_CHANNEL, protocol: VISU_PREVIEW_PROTOCOL, ...message },
      previewOrigin,
    )
  }

  function sendDraft() {
    if (!ready) return
    const draft = getDraft ? getDraft() : null
    if (!draft) return
    post({ type: VISU_PREVIEW_MESSAGE.draft, draft })
  }

  function handle(ev) {
    if (!previewOrigin || !ev || ev.origin !== previewOrigin) return
    const data = ev.data
    if (!data || typeof data !== 'object') return
    if (data.channel !== VISU_PREVIEW_CHANNEL) return

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
      sendDraft()
      return
    }
    if (data.type === VISU_PREVIEW_MESSAGE.rejected) {
      ready = false
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
    },
    stop() {
      listener.removeEventListener('message', handle)
      ready = false
    },
    sendDraft,
    isReady: () => ready,
    /**
     * Die iframe-Adresse — unveraendert. Existiert als ausdrueckliche Stelle,
     * an der man sieht, dass hier NICHTS angehaengt wird: keine Session, kein
     * Token, kein Origin. Alles Vertrauliche geht ueber `postMessage`.
     */
    frameSrc: (url) => url,
  }
}
