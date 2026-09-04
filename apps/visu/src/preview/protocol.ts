/**
 * preview/protocol - die Nachrichtenform der Vorschau-Bruecke (C4, Issue #171).
 *
 * Der V2-Editor lebt in der Admin-GUI (`gui/`, CONTRIBUTING-visu-m5.md §2.4),
 * die Visu bleibt der nutzer-facing Endpunkt. Damit der Editor eine echte
 * WYSIWYG-Vorschau bekommt (Messlatte **E3**: die Vorschau IST der Live-Renderer,
 * kein zweiter), schickt er den *Entwurf* per `postMessage` in eine eingebettete
 * Visu, die ihn ueber denselben SkinHost rendert.
 *
 * Dieses Modul ist reine DATEN + TYPEN: die Nachrichtentypen, die Versionsangabe
 * und die Pruefungen, die aus einer fremden `unknown`-Nutzlast einen Entwurf
 * machen. Kein Verhalten, kein I/O, kein Zustand (Goldene Regel: Daten = JSON,
 * Verhalten = Code).
 *
 * Der Entwurf traegt die BACKEND-Form (`ObsVisuNode` mit `page_config`), nicht
 * eine editor-eigene: die Vorschau mappt ihn mit exakt denselben Funktionen wie
 * die echte Visu (`mapTree`/`composeLayers`/`buildNavTree`). Damit weicht die
 * Vorschau nie vom Vertrag ab - und was der Editor spaeter speichert, ist genau
 * das, was die Vorschau gezeigt hat.
 */

import type { PageKind } from '@obs/visu-contract';
import type { ObsVisuNode } from '../core/obs/mapping';

/** Kanal-Marker: jede Nachricht dieser Bruecke traegt ihn, fremde nicht. */
export const PREVIEW_CHANNEL = 'obs-visu-preview';

/**
 * Version der Bruecke. Editor und Vorschau werden getrennt ausgeliefert
 * (`gui_dist` vs. Visu-Bundle), koennen also auseinanderlaufen; eine
 * abweichende Version wird sichtbar abgelehnt statt still halb zu funktionieren.
 */
export const PREVIEW_PROTOCOL_VERSION = '1.0';

/** Die Nachrichtentypen, klar benannt und in beide Richtungen eindeutig. */
export const PREVIEW_MESSAGE = {
  /** Vorschau -> Editor: „ich bin da, ich spreche Version X". */
  ready: 'preview/ready',
  /** Editor -> Vorschau: Version + Admin-Session (nie ueber URL/Query). */
  init: 'preview/init',
  /** Vorschau -> Editor: Handshake angenommen. */
  accepted: 'preview/accepted',
  /** Vorschau -> Editor: Handshake oder Nutzlast abgelehnt (mit Grund). */
  rejected: 'preview/rejected',
  /** Editor -> Vorschau: der Entwurf, der gerendert werden soll. */
  draft: 'preview/draft',
  /** Vorschau -> Editor: der Entwurf ist gerendert (ohne ihn zu speichern). */
  draftApplied: 'preview/draft-applied',
} as const;

export type PreviewMessageType = (typeof PREVIEW_MESSAGE)[keyof typeof PREVIEW_MESSAGE];

/**
 * Warum die Vorschau abgelehnt hat. `protocol` = Versionen passen nicht,
 * `handshake` = Entwurf vor der Anmeldung, `payload` = unbrauchbare Nutzlast.
 */
export type PreviewRejectReason = 'protocol' | 'handshake' | 'payload';

/**
 * Die Admin-Session, mit der die Vorschau Live-Werte vom Backend liest. Sie
 * kommt AUSSCHLIESSLICH ueber `postMessage` an den geprueften Origin - nie in
 * einer URL, einer Query oder einem Log (Sicherheitszusage C4).
 */
export interface PreviewSession {
  readonly accessToken: string;
}

/**
 * Ein Knoten des Entwurfs: die Backend-Form plus der Seitentyp, den der Editor
 * gerade waehlt. `kind` ist additiv - solange Teil A/B ihn nicht auswerten,
 * komponiert der Host wie bisher; danach wirkt er ohne Aenderung hier.
 */
export type PreviewDraftNode = ObsVisuNode & { readonly kind?: PageKind };

/** Ein Entwurf: Seiten + Widgets + Positionen + Seitentyp, plus die Skin-Wahl. */
export interface PreviewDraft {
  /** Der Skin, gegen den der Autor gerade baut (Host-Registry-Schluessel). */
  readonly skin: string;
  /** Die Seite, die die Vorschau zeigen soll. */
  readonly pageId: string;
  /** Der Entwurfsbaum. Nicht gespeichert - er existiert nur in dieser Sitzung. */
  readonly nodes: readonly PreviewDraftNode[];
}

/* ------------------------------------------------------------- Nachrichten */

interface PreviewEnvelope {
  readonly channel: typeof PREVIEW_CHANNEL;
  readonly type: PreviewMessageType;
  readonly protocol: string;
}

export interface PreviewReadyMessage extends PreviewEnvelope {
  readonly type: typeof PREVIEW_MESSAGE.ready;
}
export interface PreviewInitMessage extends PreviewEnvelope {
  readonly type: typeof PREVIEW_MESSAGE.init;
  readonly session: PreviewSession;
}
export interface PreviewAcceptedMessage extends PreviewEnvelope {
  readonly type: typeof PREVIEW_MESSAGE.accepted;
}
export interface PreviewRejectedMessage extends PreviewEnvelope {
  readonly type: typeof PREVIEW_MESSAGE.rejected;
  readonly reason: PreviewRejectReason;
}
export interface PreviewDraftMessage extends PreviewEnvelope {
  readonly type: typeof PREVIEW_MESSAGE.draft;
  readonly draft: PreviewDraft;
}
export interface PreviewDraftAppliedMessage extends PreviewEnvelope {
  readonly type: typeof PREVIEW_MESSAGE.draftApplied;
  readonly pageId: string;
  readonly widgetCount: number;
}

/* --------------------------------------------------------------- Pruefungen */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Traegt die Nutzlast den Kanal-Marker und einen Typ? Alles andere auf dem
 * `message`-Ereignis geht die Bruecke nichts an - sie schweigt dazu.
 */
export function readEnvelope(
  data: unknown,
): { type: string; protocol: string; body: Record<string, unknown> } | null {
  if (!isRecord(data)) return null;
  if (data.channel !== PREVIEW_CHANNEL) return null;
  if (typeof data.type !== 'string') return null;
  return {
    type: data.type,
    protocol: typeof data.protocol === 'string' ? data.protocol : '',
    body: data,
  };
}

/** Eine Session aus einer fremden Nutzlast, oder null. Nie ein leeres Token. */
export function readSession(value: unknown): PreviewSession | null {
  if (!isRecord(value)) return null;
  const token = value.accessToken;
  if (typeof token !== 'string' || token.length === 0) return null;
  return { accessToken: token };
}

/**
 * Ein Entwurf aus einer fremden Nutzlast, oder null. Geprueft wird nur die FORM
 * (Skin-Schluessel, Seiten-id, mindestens ein Knoten mit id/typ) - der Inhalt
 * bleibt dem Mapper ueberlassen, der unbekannte Widget-Typen ohnehin still
 * ueberspringt. Ein unbrauchbarer Entwurf wird abgelehnt, nie halb gerendert.
 */
export function readDraft(value: unknown): PreviewDraft | null {
  if (!isRecord(value)) return null;
  const { skin, pageId, nodes } = value;
  if (typeof skin !== 'string' || skin.length === 0) return null;
  if (typeof pageId !== 'string' || pageId.length === 0) return null;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  for (const node of nodes) {
    if (!isRecord(node)) return null;
    if (typeof node.id !== 'string' || node.id.length === 0) return null;
    if (node.type !== 'PAGE' && node.type !== 'LOCATION') return null;
  }
  return { skin, pageId, nodes: nodes as readonly PreviewDraftNode[] };
}
