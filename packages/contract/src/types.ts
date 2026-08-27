// @obs/visu-contract — shared types (CONTRACT-v1.md §5/§7/§8).
// Golden rule 7: data + types only — this module declares no runtime behaviour.
// Golden rules 1/4: a Device is read-only for skins; renderers are pure functions
// over read-only data, the host owns state and maps gestures to canonical actions.

/* ------------------------------------------------------------------ Globals */

/** Layout roles (prominence, not pixels) — CONTRACT-v1.md §2. */
export type Role = 'compact' | 'default' | 'wide' | 'tall' | 'feature' | 'banner';

/** Semantic icon slots — CONTRACT-v1.md §2 (default set: store.js → ICONS). */
export type IconSlot =
  | 'bulb' | 'blind' | 'thermo' | 'wind' | 'sun' | 'cloud' | 'cam' | 'shield'
  | 'bolt' | 'scene' | 'sparkle' | 'lock' | 'play' | 'pause' | 'skip';

/** Accent palette keys — never raw hex in the contract (store.js → ACCENTS). */
export type AccentToken =
  | 'orange' | 'teal' | 'violet' | 'green' | 'blue' | 'rose' | 'amber' | 'slate';

/** The stable core widget types of the contract (v1.2: + media, camera; v1.4: + climate). */
export type CoreWidgetType =
  | 'light' | 'switch' | 'blind' | 'jalousie' | 'sensor' | 'scene' | 'media' | 'camera' | 'climate';

/** Reserved widget types — declared so skins can opt out deliberately. */
export type ReservedWidgetType =
  | 'weather' | 'energy' | 'chart' | 'alarm';

export type WidgetType = CoreWidgetType | ReservedWidgetType;

/* --------------------------------------------------------- Device unions §3 */

/** Fields shared by every device. Read-only — skins never mutate state. */
interface DeviceBase {
  readonly type: CoreWidgetType;
  readonly id?: string;
  readonly room: string;
  readonly label: string;
  readonly accent: AccentToken;
  /** Optionales Etagen-/Geschoss-Label für den Crumb-Pfad im Detail (v1.4). */
  readonly floor?: string;
  /**
   * Geräte-genaue Bedienbarkeit (v1.5): `undefined`/`true` = bedienbar (Default,
   * rückwärtskompatibel), `false` = vom Host als nicht-schreibbar markiert
   * (readonly-Seite ODER fehlendes Write-Recht) — die Skin rendert die Controls
   * dann gesperrt. Gilt für **alle** Device-Typen; die Auswertung liefert der Host.
   */
  readonly writable?: boolean;
}

/** `light` — on/off plus optional brightness (`dim`, null = nicht dimmbar). */
export interface LightDevice extends DeviceBase {
  readonly type: 'light';
  readonly on: boolean;
  readonly dim: number | null;
}

/** `switch` — a plain on/off toggle. */
export interface SwitchDevice extends DeviceBase {
  readonly type: 'switch';
  readonly on: boolean;
}

/**
 * Eine konfigurierte feste Position („Preset") für positionsbasierte Geräte (v1.6):
 * ein benanntes Ziel, das per `applyPreset` in einem Schritt angefahren wird. `slat`
 * ist optional und wird nur von Lamellen-Jalousien genutzt (Rolladen lassen es weg).
 * `label` kommt aus der Gerätekonfiguration und wird roh gerendert (kein i18n-Key).
 */
export interface PositionPreset {
  readonly label: string;
  readonly position: number;
  readonly slat?: number;
}

/** `blind` (Rollladen) — position 0 = auf, 100 = zu. */
export interface BlindDevice extends DeviceBase {
  readonly type: 'blind';
  readonly position: number;
  readonly locked: boolean;
  /** Konfigurierte Vorgabepositionen für den Schnellzugriff (Long-Press) (v1.6). */
  readonly presets?: readonly PositionPreset[];
}

/** One entry of a jalousie status traffic light: true | false | null. */
export interface JalousieStatus {
  readonly label: string;
  readonly val: boolean | null;
}

/** `jalousie` — position (0 = auf, 100 = zu) plus slat angle (0–100 ⇒ 0–90°). */
export interface JalousieDevice extends DeviceBase {
  readonly type: 'jalousie';
  readonly mode: 'jalousie';
  readonly position: number;
  readonly slat: number;
  readonly locked: boolean;
  readonly invert?: boolean;
  readonly moving?: 'up' | 'down' | null;
  readonly statuses: readonly JalousieStatus[];
  /** Konfigurierte Vorgabepositionen (Position + optional Lamelle) für den Schnellzugriff (v1.6). */
  readonly presets?: readonly PositionPreset[];
}

/** `sensor` — read-only reading (Aussage, kein Vergessen). */
export interface SensorDevice extends DeviceBase {
  readonly type: 'sensor';
  readonly value: number | string;
  readonly unit: string;
  readonly status?: string;
  /** Optionales Akzent-Icon (analog {@link SceneDevice.icon}) — Wetter/Strom (v1.4). */
  readonly icon?: string;
  /** Optionale Zeitreihe für Verlauf/Chart (2×2) (v1.4). */
  readonly series?: readonly number[];
  /** Reihen-Minimum für den „min … · max …"-Fuß (v1.4). */
  readonly min?: number;
  /** Reihen-Maximum für den „min … · max …"-Fuß (v1.4). */
  readonly max?: number;
}

/** `scene` — activatable scene with its own icon slot + optional subtitle. */
export interface SceneDevice extends DeviceBase {
  readonly type: 'scene';
  readonly icon: string;
  readonly sub?: string;
}

/** `media` — playback transport state (read-only; control via WidgetActions). */
export interface MediaDevice extends DeviceBase {
  readonly type: 'media';
  readonly playState: 'playing' | 'paused' | 'stopped';
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly volume: number;
  readonly artUrl?: string | null;
}

/** `camera` — snapshot/stream feed (read-only; refresh via WidgetAction). */
export interface CameraDevice extends DeviceBase {
  readonly type: 'camera';
  readonly online: boolean;
  readonly snapshotUrl: string | null;
  readonly streamUrl?: string | null;
}

/** `climate` (Klima/Heizung/RTR) — Soll-/Ist-Temperatur plus Betriebsmodus (v1.4). */
export interface ClimateDevice extends DeviceBase {
  readonly type: 'climate';
  readonly setpoint: number;
  readonly current: number;
  readonly mode: 'heat' | 'cool' | 'off' | 'auto';
  readonly unit: string;
}

/** Discriminated union of every core device. Read-only for skins (golden rule 1/4). */
export type Device =
  | LightDevice
  | SwitchDevice
  | BlindDevice
  | JalousieDevice
  | SensorDevice
  | SceneDevice
  | MediaDevice
  | CameraDevice
  | ClimateDevice;

/* ----------------------------------------------------- Tokens / Ctx (§5) -- */

/** Theme tokens handed to renderers — AA-safe colours, font, spacing. */
export interface Tokens {
  /** Palette key → AA-safe CSS colour. */
  accent(token: string): string;
  /** Palette key → AA-safe ink (foreground) colour. */
  accentInk(token: string): string;
  /** Active font family. */
  font: string;
  /** Spacing step → CSS length. */
  space(step: number): string;
}

/**
 * The shared helpers a renderer receives — and the *only* surface it gets.
 * This is the sandbox boundary: no access to core internals (golden rule 4).
 */
export interface Ctx {
  /** "Aus" · "Ein" · "Ein — 45 %" · "62 % · Teil" — centralised footer text. */
  stateText(d: Device): string;
  /**
   * Zerlegt den {@link Ctx.stateText} in Zustandswort (z. B. "Ein"/"Aus"/"An"/"Zu")
   * und Rest (z. B. " — 45 %"), damit Skins das Wort fett und den Rest gemutet rendern
   * (Vorlage: `<b>Ein</b> — 45 %`) (v1.4). {@link Ctx.stateText} bleibt unverändert
   * (rückwärtskompatibel); die Implementierung liefert der Host.
   */
  stateParts(d: Device): { readonly word: string; readonly rest: string };
  /** softHyphenate(): insert weiche Trennstellen into long labels. */
  hyphenate(text: string): string;
  /** Resolve an icon for a device: skin set → default fallback. */
  icon(d: Device, slot: string): string;
  /** de-DE number formatting (decimal comma, thousands point). */
  nf(v: number | string, dec?: number): string;
  /** Is a sensor outside its comfort range? */
  warn(d: Device): boolean;
  /**
   * Optional translator injected by the host (v1.1). When present, text helpers
   * (e.g. {@link Ctx.stateText}) resolve i18n keys through it; when absent they
   * fall back to the German core literals (backward compatible).
   */
  t?(key: string, params?: Record<string, unknown>): string;
}

/**
 * A renderer is a pure function over read-only data + sandbox helpers.
 * Returns markup (string) or a framework node (e.g. a Vue VNode → unknown).
 */
export type Renderer = (d: Device, t: Tokens, ctx: Ctx) => string | unknown;

/* ------------------------------------------------- Skin manifest (§7) ----- */

/** Canonical action names per widget type — CONTRACT-v1.md §6. */
export type WidgetAction =
  | 'toggle'
  | 'setDim'
  | 'setPosition'
  | 'setSlat'
  | 'applyPreset'
  | 'setSetpoint'
  | 'lock'
  | 'unlock'
  | 'activateScene'
  | 'arm'
  | 'disarm'
  | 'playPause'
  | 'stop'
  | 'next'
  | 'previous'
  | 'setVolume'
  | 'refresh';

/**
 * Host-/UI-level action names — handled by the host shell, never a canonical core
 * write. A skin renderer MAY mark these on `data-action`; they are **universal**
 * (not widget-specific) and therefore need no per-widget declaration in a manifest:
 *
 *  - `openDetail` — open the detail surface (host shell navigation).
 *  - `close`      — close the detail surface (host shell navigation).
 *
 * `stop` is dual-natured: a canonical media transport {@link WidgetAction}, and — for
 * the movement widgets (`blind`/`jalousie`) — a UI-only momentary control with no core
 * write in v1. The host treats it as UI-only there, so it likewise needs no per-widget
 * manifest declaration.
 */
export type HostUiAction = 'openDetail' | 'close';

/** Every action a skin may mark on `data-action`: the canonical set plus host/UI ones. */
export type HostAction = WidgetAction | HostUiAction;

/** Which canonical actions a skin wires up for a given type → full/partial/display. */
export interface SkinWidgetEntry {
  readonly actions: readonly WidgetAction[];
}

export interface SkinLayout {
  readonly model: string;
  readonly grid?: Record<string, unknown>;
  readonly honors?: readonly string[];
  readonly roleMap?: Record<string, unknown>;
}

export interface SkinTweak {
  readonly type: 'select' | 'slider';
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly default: string | number;
}

/**
 * Ziel-Verhalten, das der Host für eine Geste anwendet (v1.7):
 *  - `action`     – die vom getippten Element markierte `data-action` ausführen
 *    (ein Bedienelement bedienen; ein `openDetail`-Träger öffnet so das Detail).
 *  - `openDetail` – die Detailfläche öffnen (Kachel-Ebene, elementunabhängig).
 *  - `presets`    – das Positions-Preset-Popover öffnen (Fallback `openDetail`,
 *    wenn das Gerät keine Presets trägt; die Fallback-Politik liegt im Host).
 */
export type GestureTarget = 'action' | 'openDetail' | 'presets';

/**
 * Das Interaktionsmodell eines Skins (v1.7): welche Geste welches Ziel auslöst.
 * Rein deklarative Daten (Daten=JSON, Verhalten=Code) – der Renderer bleibt
 * zustandslos, die Gesten-Erkennung und -Anwendung besitzt der Host. Fehlt die
 * Deklaration, nutzt der Host einen rückwärtskompatiblen Default.
 */
export interface SkinGestures {
  readonly tap?: GestureTarget;
  readonly longPress?: GestureTarget;
  readonly doubleTap?: GestureTarget;
}

/** skins/<name>/manifest.json — CONTRACT-v1.md §7. */
export interface SkinManifest {
  readonly name: string;
  readonly targetsContract: string;
  readonly font?: { readonly family: string; readonly src?: string };
  readonly renderers?: string;
  readonly icons?: string;
  /** "Nicht unterstützt" ist Pflichtangabe (golden rule 3), kein Vergessen. */
  readonly unsupported: readonly string[];
  readonly widgets: Readonly<Partial<Record<WidgetType, SkinWidgetEntry>>>;
  readonly layout: SkinLayout;
  readonly tweaks?: Readonly<Record<string, SkinTweak>>;
  readonly themes?: readonly string[];
  /** Skin-eigenes Gesten-/Interaktionsmodell (v1.7); optional, Host-Default sonst. */
  readonly gestures?: SkinGestures;
}

/* ---------------------------------------------- Support report (§8) ------- */

/** Conformance level the generator computes (never self-asserted). */
export type SupportLevel = 'full' | 'partial' | 'display' | 'unsupported' | 'gap' | 'broken';

export interface SupportSummary {
  readonly full: number;
  readonly partial: number;
  readonly display: number;
  readonly unsupported: number;
  readonly gap: number;
  readonly broken: number;
}

export interface SupportWidgetEntry {
  readonly level: SupportLevel;
  readonly render?: string;
  readonly actions?: string;
  readonly fixtures?: readonly string[];
  readonly reason?: string;
}

/** support.json — computed by the generator, CONTRACT-v1.md §8. */
export interface SupportReport {
  readonly skin: string;
  readonly targetsContract: string;
  readonly contractLatest: string;
  readonly generatedAt: string;
  readonly summary: SupportSummary;
  readonly widgets: Readonly<Record<string, SupportWidgetEntry>>;
  readonly layout?: Record<string, unknown>;
  readonly a11y?: Record<string, unknown>;
}
