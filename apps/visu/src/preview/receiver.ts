/**
 * preview/receiver - der Empfaenger der Vorschau-Bruecke (C4, Issue #171).
 *
 * Die einzige Stelle, an der ein fremdes Fenster in die Visu hineinreden darf.
 * Entsprechend eng ist die Naht:
 *
 *  - **Origin-Pruefung in beide Richtungen.** Angenommen wird nur, was aus einer
 *    zur Bauzeit erlaubten Herkunft UND aus dem eigenen Elternfenster kommt;
 *    gesendet wird nur an eine konkrete erlaubte Herkunft, nie an `'*'`. Eine
 *    fremde Herkunft bekommt gar keine Antwort - auch keine Ablehnung (die waere
 *    schon eine Auskunft).
 *  - **Handshake mit Versionsangabe.** `preview/ready` -> `preview/init` ->
 *    `preview/accepted`. Erst danach wird ein `preview/draft` angenommen; eine
 *    abweichende Protokollversion schliesst die Bruecke dauerhaft - geprueft an
 *    jeder Nachricht, nicht nur am Handshake.
 *  - **Kein I/O.** Der Empfaenger liest, prueft und reicht weiter. Er speichert
 *    nichts, er laedt nichts, er loggt nichts - insbesondere nie die Session.
 *
 * Framework-frei und ueber `listener`/`parent` injizierbar, damit die Regeln
 * ohne echtes Fenster pruefbar sind.
 */

import {
  PREVIEW_CHANNEL,
  PREVIEW_MESSAGE,
  PREVIEW_PROTOCOL_VERSION,
  readDraft,
  readEnvelope,
  readSession,
  type PreviewDraft,
  type PreviewRejectReason,
  type PreviewSession,
} from './protocol';

/** Die Felder eines `message`-Ereignisses, die die Bruecke braucht. */
export interface PreviewMessageEventLike {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

/** Wo die Bruecke zuhoert (in der App: `window`). */
export interface PreviewListener {
  addEventListener(type: 'message', handler: (ev: PreviewMessageEventLike) => void): void;
  removeEventListener(type: 'message', handler: (ev: PreviewMessageEventLike) => void): void;
}

/** Wohin die Bruecke spricht (in der App: `window.parent`). */
export interface PreviewPoster {
  postMessage(message: unknown, targetOrigin: string): void;
}

/**
 * `idle` = nicht gestartet/gestoppt, `awaiting-init` = angemeldet, wartet auf den
 * Editor, `ready` = Handshake steht, `rejected` = endgueltig zu.
 */
export type PreviewReceiverState = 'idle' | 'awaiting-init' | 'ready' | 'rejected';

export interface PreviewReceiverOptions {
  /** Erlaubte Herkuenfte (Bauzeit-Konfiguration, nie aus der URL). */
  readonly allowedOrigins: readonly string[];
  /** Das Elternfenster - Ziel jeder ausgehenden Nachricht und einzige Quelle. */
  readonly parent: PreviewPoster;
  /** Das Fenster, an dem gelauscht wird. */
  readonly listener: PreviewListener;
  /** Die Admin-Session ist da (nur im Speicher halten - nie persistieren). */
  readonly onSession?: (session: PreviewSession) => void;
  /** Ein Entwurf ist da: rendern, nicht speichern. */
  readonly onDraft?: (draft: PreviewDraft) => void;
}

export interface PreviewReceiver {
  start(): void;
  stop(): void;
  status(): PreviewReceiverState;
  /** Rueckmeldung an den Editor, dass der Entwurf gerendert ist. */
  applied(info: { readonly pageId: string; readonly widgetCount: number }): void;
}

export function createPreviewReceiver(options: PreviewReceiverOptions): PreviewReceiver {
  const { allowedOrigins, parent, listener, onSession, onDraft } = options;
  let state: PreviewReceiverState = 'idle';
  /** Die Herkunft, mit der der Handshake laeuft (immer aus `allowedOrigins`). */
  let peerOrigin: string | null = null;

  function post(targetOrigin: string, message: Record<string, unknown>): void {
    // Immer ein konkretes Ziel: `'*'` wuerde die Nachricht jedem Fenster zeigen,
    // das den Rahmen gerade besitzt.
    parent.postMessage({ channel: PREVIEW_CHANNEL, protocol: PREVIEW_PROTOCOL_VERSION, ...message }, targetOrigin);
  }

  function reject(targetOrigin: string, reason: PreviewRejectReason): void {
    post(targetOrigin, { type: PREVIEW_MESSAGE.rejected, reason });
  }

  function handle(ev: PreviewMessageEventLike): void {
    if (state === 'idle') return;
    // 1. Herkunft. Alles Fremde faellt hier heraus - ohne Antwort.
    if (!allowedOrigins.includes(ev.origin)) return;
    // 2. Quelle. Auch aus der richtigen Herkunft darf nur das Fenster reden, in
    //    das die Vorschau eingebettet ist - nicht irgendein Popup daneben.
    if (ev.source !== parent) return;
    // 3. Kanal. Fremder Verkehr auf demselben Fenster geht uns nichts an.
    const envelope = readEnvelope(ev.data);
    if (!envelope) return;

    peerOrigin = ev.origin;

    // 4. Version - an JEDER Nachricht, nicht nur am Handshake. Editor und
    //    Vorschau werden getrennt ausgeliefert; ein Peer, der mitten in der
    //    Sitzung eine andere Version spricht, ist ein anderes Bundle und kein
    //    halb passender Entwurf. Einmal abgelehnt bleibt die Bruecke zu, und
    //    zwar stumm: eine zweite Auskunft waere schon wieder eine.
    if (state === 'rejected') return;
    if (envelope.protocol !== PREVIEW_PROTOCOL_VERSION) {
      state = 'rejected';
      reject(ev.origin, 'protocol');
      return;
    }

    if (envelope.type === PREVIEW_MESSAGE.init) {
      const session = readSession(envelope.body.session);
      if (!session) {
        reject(ev.origin, 'payload');
        return;
      }
      state = 'ready';
      onSession?.(session);
      post(ev.origin, { type: PREVIEW_MESSAGE.accepted });
      return;
    }

    if (envelope.type === PREVIEW_MESSAGE.draft) {
      if (state !== 'ready') {
        reject(ev.origin, 'handshake');
        return;
      }
      const draft = readDraft(envelope.body.draft);
      if (!draft) {
        reject(ev.origin, 'payload');
        return;
      }
      onDraft?.(draft);
      return;
    }
    // Unbekannte Typen werden still ignoriert: die Bruecke ist additiv, ein
    // neuerer Editor darf mehr sagen, ohne diese Vorschau zu stoeren.
  }

  return {
    start(): void {
      if (state !== 'idle') return;
      state = 'awaiting-init';
      listener.addEventListener('message', handle);
      // Anmeldung an jede erlaubte Herkunft einzeln. Die Nachricht traegt kein
      // Geheimnis, nur die Version - und trotzdem nie an `'*'`.
      for (const origin of allowedOrigins) post(origin, { type: PREVIEW_MESSAGE.ready });
    },
    stop(): void {
      listener.removeEventListener('message', handle);
      state = 'idle';
      peerOrigin = null;
    },
    status(): PreviewReceiverState {
      return state;
    },
    applied(info): void {
      if (state !== 'ready' || peerOrigin === null) return;
      post(peerOrigin, {
        type: PREVIEW_MESSAGE.draftApplied,
        pageId: info.pageId,
        widgetCount: info.widgetCount,
      });
    },
  };
}
