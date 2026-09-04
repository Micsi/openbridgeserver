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
 *
 * 1.0 -> 1.1: der Entwurf traegt jetzt `theme` und `tweaks`. Ohne sie kann die
 * Vorschau die Wurzel-Bindungen der echten Seite gar nicht setzen (E3), ein
 * 1.0-Editor wuerde also stumm eine andere Seite zeigen. Genau deshalb ist das
 * eine Versionsanhebung und keine stille Erweiterung: die Abweichung wird an
 * jeder Nachricht geprueft (siehe `receiver.ts`) und sichtbar abgelehnt.
 */
export const PREVIEW_PROTOCOL_VERSION = '1.1';

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
 * Das Theme, das der Host jedem Renderer als Token-Boden reicht (Goldene Regel 6).
 * Dieselben drei Werte wie im Tweak-Schema des ionic-Skins.
 */
export type PreviewTheme = 'light' | 'dark' | 'image';

/** Ein einzelner Tweak-Wert - genau das, was der Tweak-Editor der Seite haelt. */
export type PreviewTweakValue = string | number | boolean;

/**
 * Die Tweak-Werte, die der Autor gewaehlt hat. Absichtlich ein offener Record und
 * keine skin-spezifische Form: der Host reicht sie unveraendert an `applyTweaks`
 * des Skins weiter, der unbekannte Schluessel ignoriert und jeden Wert gegen sein
 * Manifest klemmt. Ein neuer Tweak eines Skins braucht damit keine neue Version.
 */
export type PreviewTweaks = Readonly<Record<string, PreviewTweakValue>>;

/** Sind das brauchbare Tweak-Werte? (Nur Primitive - nichts, was der Skin nicht
 *  in ein Attribut oder eine CSS-Variable schreiben koennte.) */
function isTweaks(value: unknown): value is PreviewTweaks {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
  );
}

/** Ist das eines der drei Themes? */
function isTheme(value: unknown): value is PreviewTheme {
  return value === 'light' || value === 'dark' || value === 'image';
}

/**
 * Das Token-Theme aus den Tweak-Werten - **die Regel der echten Seite**
 * (`SkinPage.vue`: alles ausser `dark`/`image` ist `light`). Sie steht hier, weil
 * die Vorschau exakt dieselbe Ableitung braucht; `PreviewParity.spec.ts` haelt
 * beide Seiten gegeneinander, damit die Regel nicht auseinanderlaeuft.
 */
export function themeOfTweaks(tweaks: PreviewTweaks | undefined): PreviewTheme {
  const v = tweaks?.['theme'];
  return v === 'dark' || v === 'image' ? v : 'light';
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
  /**
   * Die Tweak-Werte der Seite (v1.1). Sie bestimmen die Wurzel-Attribute und die
   * `--vz-*`-Variablen, an denen die Flaechen- und Kachel-Regeln des Skins
   * haengen - ohne sie rendert dieselbe Komponentenkette eine ANDERE Seite, und
   * E3 ("0 abweichende Pixel") ist strukturell unerreichbar.
   */
  readonly tweaks?: PreviewTweaks;
  /**
   * Das Token-Theme (v1.1). Fehlt es, gilt dieselbe Ableitung aus den Tweaks wie
   * auf der echten Seite ({@link themeOfTweaks}) - der Editor muss es also nur
   * schicken, wenn er das Theme ausserhalb der Tweaks fuehrt.
   */
  readonly theme?: PreviewTheme;
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
  // Theme und Tweaks sind optional (ein Editor darf sie weglassen), aber wenn sie
  // da sind, muessen sie brauchbar sein: ein halb gerenderter Entwurf mit
  // stillschweigend verworfenem Theme waere genau die Abweichung, die E3 verbietet.
  const { theme, tweaks } = value;
  if (theme !== undefined && !isTheme(theme)) return null;
  if (tweaks !== undefined && !isTweaks(tweaks)) return null;
  return {
    skin,
    pageId,
    nodes: nodes as readonly PreviewDraftNode[],
    ...(tweaks !== undefined ? { tweaks } : {}),
    ...(theme !== undefined ? { theme } : {}),
  };
}
