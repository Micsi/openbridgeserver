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
  /**
   * Etagenkürzel für {@link DeviceBase.floor} (v1.8): der volle Geschossname
   * ("Erdgeschoss") wird auf sein Kürzel ("EG") verdichtet, damit ein Skin den
   * Eyebrow als „<Kürzel> <Raum>" zeigen kann. Reine Host-/Core-Datenableitung
   * (Verhalten=Code, Goldene Regel 7): der Skin besitzt kein Mapping. Ein bereits
   * kurzer oder unbekannter Geschossname wird unverändert zurückgegeben; fehlt
   * `floor`, ist das Ergebnis leer (der Skin zeigt dann nur den Raum).
   */
  floorShort(d: Device): string;
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
  /**
   * Additive Fähigkeiten, die dieser Skin honoriert. Das anerkannte Vokabular
   * steht in `contract.schema.json → layoutHonors`. Diese Liste ist die
   * DURCHGESETZTE Quelle, nicht nur Doku: der Konformitätslauf der Skins
   * (`@obs-visu-skins/conformance`) validiert jedes `honors` dagegen und lehnt
   * einen unbekannten String ab. Der Doc-Block hier ist die Erläuterung dazu:
   *
   * - `'order'`    - Reihenfolge als Boden (Golden Rule 5)
   * - `'grouping'` - Gruppierung als Boden (Golden Rule 5)
   * - `'role'`    - Rollen-Footprint
   * - `'position'` (v1.9) - Pixel-{@link WidgetPosition}
   * - `'nav'`     (v1.10) - eigene Navigation aus {@link PageHost.navTree}
   * - `'layers'`  (v1.9)  - Layer-Stack ({@link PageLayer})
   * - `'popup'`   (v1.9)  - Popup-Deskriptoren ({@link PopupDescriptor})
   * - `'link'`    (v1.12) - Sprungziele auf platzierten Elementen
   *   ({@link LayerItem.link}), gerendert über {@link PageHost.resolveLink} /
   *   {@link PageHost.followLink} / {@link PageHost.isLinkActive}
   *
   * `'link'` ist bewusst NICHT in `'layers'` enthalten: ein Skin kann den
   * Layer-Stack rendern und `link` trotzdem fallenlassen. Ohne den String ist
   * das genau das - ein erklärter Verzicht statt eines stillen Schluckens
   * (Golden Rule 3). Fehlt ein String, ignoriert der Skin den Hint - der Boden
   * (Reihenfolge+Gruppierung) trägt weiter (Golden Rule 5).
   */
  readonly honors?: readonly string[];
  readonly roleMap?: Record<string, unknown>;
}

/* ---------------------------------------- Layering & Komposition (v1.9) ----
 * Seiten-Layering ist eine SKIN-Fähigkeit (CONTRIBUTING-visu-layering.md): der
 * Host liefert Komposition + Spatial-Daten, der Skin entscheidet das „wie".
 * Alles additiv/optional - ein Skin ohne passende `honors` verhält sich wie bisher.
 */

/**
 * Pixel-/Rasterposition eines Widgets auf seiner Seite (Autoren-Layout à la Edomi).
 * Additiv und ignorierbar: responsive Skins nutzen Role/span, Pixel-Skins honorieren
 * dies (`honors: ['position']`). Zahlen sind opak (der Pixel-Skin interpretiert die
 * Einheit; Edomi = px).
 */
export interface WidgetPosition {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Seitentyp (Edomi-Modell): gewöhnliche Seite, modales Popup, oder globale Inkludeseite. */
export type PageKind = 'normal' | 'popup' | 'globalInclude';

/** Ein Element innerhalb eines Layers - referenziert ein Gerät per id (kein Datenfork). */
export interface LayerItem {
  readonly id: string;
  readonly role?: Role;
  /** Autoren-Position; nur von Skins mit `honors: ['position']` genutzt. */
  readonly position?: WidgetPosition;
  /**
   * Sprungziel dieses platzierten Elements (v1.11, Upstream #1194). Additiv und
   * ignorierbar: ohne `link` verhält sich das Element exakt wie bisher. Der HOST
   * löst den Link auf (Access-Kette, PIN-Gate, aktuelle Seite) und führt die
   * kanonische Aktion `navigate` aus - der Skin besitzt weder Zustand noch
   * Navigationslogik (Goldene Regel 4).
   */
  readonly link?: PageLink;
}

/**
 * Wie der Host markiert, dass das Linkziel die aktuelle Seite (oder ein Vorfahr
 * davon) ist. Autorenwahl als reine Daten; `'none'` (Default) heisst: keine
 * Markierung. Spiegelt `active_indicator` des V1-Link-Widgets.
 */
export type LinkIndicator = 'none' | 'dot' | 'bar' | 'border';

/**
 * Das Sprungziel eines platzierten Elements (v1.11, Upstream #1194): ein Element
 * OHNE eigene Klick-Funktion (z. B. eine Kamera-Kachel) springt beim Tap auf eine
 * andere Visuseite - „wie im Link-Widget".
 *
 * Reine Daten (Goldene Regel 7): der Vertrag beschreibt nur WOHIN gesprungen wird,
 * nie WIE. Das Auflösen (LOCATION -> erste sichtbare Seite), das PIN-Gate eines
 * `protected` Knotens und der Aktiv-Zustand entlang der Vorfahrenkette sind
 * Host-Verhalten. Ein Skin, der `link` ignoriert, verhält sich unverändert.
 */
export interface PageLink {
  /**
   * Ziel-Knoten im Navigationsbaum (PAGE oder LOCATION) - die Entsprechung von
   * `target_node_id` im V1-Link-Widget. Ein unbekanntes Ziel ist ein No-op, nie
   * ein blinder Sprung.
   */
  readonly targetNodeId: string;
  /** Markierung, wenn das Ziel aktiv ist (Default `'none'`). */
  readonly activeIndicator?: LinkIndicator;
}

/* ------------------------------------------- Link-Auflösung als Host-Dienst (v1.12) --
 * v1.11 beschrieb das Sprungziel, bot dem Skin aber nur `navigate(pageId)` an.
 * Ein `targetNodeId`, das eine LOCATION nennt, ein `protected` Knoten und die
 * Aktiv-Markierung entlang der Vorfahrenkette waren damit für einen
 * seitenbesitzenden Skin nur über einen eigenen Abstieg durch den `navTree`
 * erreichbar - genau das, was Goldene Regel 4 verbietet. v1.12 typisiert
 * deshalb das Ergebnis der Auflösung und hängt sie an {@link PageHost}.
 *
 * Der Vertrag typisiert die Naht, er füllt sie nicht (Goldene Regel 7): die
 * Auflösung selbst ist Host-Code.
 */

/** Das Ziel ist erreichbar - der Host wechselt auf diese Seite. */
export interface LinkNavigate {
  readonly kind: 'navigate';
  readonly pageId: string;
}

/**
 * Das Ziel ist `protected` und es liegt keine gültige PIN-Sitzung vor: der Host
 * führt auf den PIN-Pfad statt auf die Seite. Nie ein blinder Sprung.
 */
export interface LinkGate {
  readonly kind: 'gate';
  /** Die gesperrte SEITE (der Eintrag, den das PIN-Gate anbietet). */
  readonly pageId: string;
  /** Der Knoten, auf den die PIN-Sitzung zählt (der access-definierende Vorfahr). */
  readonly accessNodeId: string;
}

/** Ein Ziel, das der (nicht leere) Navigationsbaum nicht kennt: erklärter No-op. */
export interface LinkUnknown {
  readonly kind: 'unknown';
  readonly targetNodeId: string;
}

/** Was der Host mit einem Link tut - das Ergebnis von {@link PageHost.resolveLink}. */
export type LinkOutcome = LinkNavigate | LinkGate | LinkUnknown;

/**
 * Ein Layer der komponierten Seite. Der Host stapelt globale Inkludeseiten, individuelle
 * Includes und den eigenen Inhalt zu einem geordneten Stack; der Skin rendert ihn frei
 * (übereinander/absolut oder flach/semantisch). `order` ist deterministisch (aufsteigend).
 */
export interface PageLayer {
  readonly id: string;
  readonly origin: 'global' | 'include' | 'own';
  readonly order: number;
  readonly items: readonly LayerItem[];
}

/**
 * Popup-Overlay-Deskriptor (Edomi-Popup). Der HOST besitzt den Offen-Zustand und den
 * Auto-Close-Timer (Skin bleibt zustandslos); der Skin rendert das Popup modal/pixelgenau
 * nur, wenn er `honors: ['popup']` deklariert. Leere `position` => zentriert (Edomi-Semantik).
 * Auto-Close verlängert sich beim erneuten Öffnen nicht.
 */
export interface PopupDescriptor {
  readonly id: string;
  readonly position?: WidgetPosition;
  readonly autoCloseMs?: number;
  readonly modal?: boolean;
  readonly animate?: boolean;
  readonly shadow?: boolean;
  readonly dimBackdrop?: boolean;
}

/* ---------------------------------- Page renderer & host seam (v1.10) -------
 * A skin may OWN a whole page (nav + composed layers + popups), not just tiles,
 * by exporting a {@link PageRenderer}. The host still owns STATE (current page,
 * which popups are open, auto-close timers) and RENDERS the content tiles; the
 * skin owns the APPEARANCE. This keeps the skin stateless while letting it define
 * the "how" of navigation/layering/popups (CONTRIBUTING-visu-layering.md, W3c/W4).
 * A skin without a page renderer is unaffected — the host lays out its floor.
 */

/** One node of the navigation hierarchy handed to a skin's page renderer. */
export interface NavNode {
  readonly id: string;
  readonly name: string;
  readonly type: 'LOCATION' | 'PAGE';
  /** The node's own access mode (`public`/`readonly`/`protected`/`user`/null). */
  readonly access: string | null;
  readonly children: readonly NavNode[];
}

/**
 * The host services a skin's {@link PageRenderer} receives. The host owns all
 * state and the content-tile rendering; the skin reads + calls these to draw its
 * own navigation, layer overlays and popups. Returns are `string | unknown`
 * (framework node, e.g. a Vue VNode) exactly like {@link Renderer} — the contract
 * types the seam, it executes nothing (golden rule 7).
 */
export interface PageHost {
  /** The visible navigation hierarchy (host-composed). */
  readonly navTree: readonly NavNode[];
  /** The page the skin is currently showing (its nav choice), or null at start. */
  readonly currentPageId: string | null;
  /** Switch the shown page (host updates state; the renderer re-runs). */
  navigate(pageId: string): void;
  /** The ordered layer stack for a page (ancestors + own), host-composed. */
  layersFor(pageId: string): readonly PageLayer[];
  /** Render the host's content tile for a device id (the skin never re-implements tiles). */
  renderTile(deviceId: string): string | unknown;
  /** The popups currently open (host-owned state + auto-close). */
  readonly openPopups: readonly PopupDescriptor[];
  /** Open / close a popup by id (host owns the open-state + auto-close timer). */
  openPopup(descriptor: PopupDescriptor): void;
  closePopup(id: string): void;

  /* ------------------------------------------------ page links (v1.12, #1194) */
  /*
   * Vier Lesarten EINER Auflösung, die der Skin ohne Host-Zustand nicht
   * beantworten kann. Sie existieren, damit ein seitenbesitzender Skin
   * {@link LayerItem.link} rendern kann, OHNE selbst zu navigieren: der Skin
   * fragt, der Host weiss (Goldene Regel 4).
   */

  /**
   * Auflösen OHNE zu handeln: was ein Klick auf diesen Link täte. Der Skin
   * entscheidet daraus die Affordanz - erreichbar (`navigate`), PIN-gesperrt
   * (`gate`) oder unbekannt (`unknown`, dann keine tote Klickfläche anbieten).
   * Rein lesend; ändert keinen Zustand.
   */
  resolveLink(link: PageLink): LinkOutcome;

  /**
   * Dem Link FOLGEN: der Host löst auf und führt die kanonische Aktion aus
   * (`navigate` wechselt die Seite, `gate` führt auf den PIN-Pfad, `unknown`
   * ist ein No-op). Gibt dasselbe Ergebnis zurück wie {@link resolveLink}, damit
   * der Skin die Rückmeldung zeichnen kann, ohne den Zustand zu kennen.
   */
  followLink(link: PageLink): LinkOutcome;

  /**
   * Ist das Ziel die aktuelle Seite oder ein Vorfahr davon? Der Aktiv-Indikator
   * des Autors ({@link PageLink.activeIndicator}) hängt daran; die Vorfahrenkette
   * gehört dem Host, nicht dem Skin.
   */
  isLinkActive(link: PageLink): boolean;

  /**
   * Der zugängliche Name der Sprung-Affordanz (WCAG 4.1.2). Die Navigation ist
   * Host-Sache (Goldene Regel 4), also auch ihre Beschriftung: sie kommt aus den
   * Sprachdateien des Hosts plus dem Klarnamen des Zielknotens. Ohne diesen
   * Dienst müsste der Skin entweder den Baum nach dem Namen absuchen oder einen
   * unbenannten Link ausliefern.
   *
   * `outcome` optional durchreichen (in aller Regel das Ergebnis, das der Skin
   * ohnehin schon von {@link resolveLink} hält): der Name nennt dann auch den
   * ZUSTAND. Ein `protected` Ziel ohne PIN-Sitzung führt auf den PIN-Pfad statt
   * auf die Seite - ohne das im Namen ist dieser Unterschied nur über Cursor
   * oder Farbe sichtbar und für Touch und Screenreader gar nicht. Der Zustand
   * gehört dem Host, also gehört auch seine Ansage hierher und nicht in den
   * Skin. Ohne `outcome` bleibt der Name der bisherige.
   */
  linkLabel(link: PageLink, outcome?: LinkOutcome): string;
}

/**
 * A skin's optional whole-page renderer (v1.10). When a skin exports one and the
 * host runs an external (backend) floor, the host delegates the page body to it,
 * passing the {@link PageHost}. Declared via the manifest capability `honors`
 * entries `'nav'` / `'layers'` / `'popup'` / `'link'` (what the skin's page
 * renderer uses; see {@link SkinLayout.honors} for the checked vocabulary).
 */
export type PageRenderer = (host: PageHost) => string | unknown;

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

/* ------------------------------------------- A11y-Palette (§7, v1.13) ----- */

/**
 * Rolle eines Farb-Tokens — sie bestimmt die WCAG-Schwelle, gegen die gemessen wird.
 *
 *  - `text`    – färbt Fließtext/Beschriftung: 4.5:1 (WCAG 1.4.3).
 *  - `graphic` – färbt bedeutungstragende Nicht-Text-Grafik: 3:1 (WCAG 1.4.11).
 *  - `ground`  – ist der Bezug, nicht der Vordergrund; wird selbst nicht gemessen.
 *  - `exempt`  – bewusst ausgenommen. Verlangt `reason` (Goldene Regel 3):
 *    „nicht gemessen" muss eine Aussage sein, kein Vergessen — die Begründung
 *    steht im Report, damit die Auslassung les- und kritisierbar bleibt.
 */
export type A11yRoleName = 'text' | 'graphic' | 'ground' | 'exempt';

/**
 * Die Deklaration EINES Farb-Tokens. Der Skin sagt, was der Token tut; die Farbe
 * selbst liest der Generator aus dem Stylesheet — deklariert wird die Semantik,
 * gemessen wird der Wert.
 */
export interface A11yTokenDecl {
  readonly role: A11yRoleName;
  /**
   * Die Gründe (Namen aus `grounds`), auf denen dieser Vordergrund real steht.
   * Fehlt die Angabe, wird gegen ALLE erklärten Gründe gemessen — die strengere
   * Lesart ist bewusst der Default: wer einschränken will, muss es hinschreiben.
   */
  readonly on?: readonly string[];
  /**
   * Die Deckkräfte, die der Skin AUF DIESEN Token legt (gesperrte Kachel, inertes
   * Bedienelement). Fehlt die Angabe, gelten die Deckkräfte des Skins (`alphas`).
   * Sie stehen je Token und nicht nur global, weil ein Skin seine Kachel dimmt und
   * seine Seitenüberschrift nicht — eine globale Liste erzeugte sonst Paarungen,
   * die es auf dem Schirm nie gibt, und ein Wächter mit falschem Alarm wird ignoriert.
   */
  readonly alphas?: readonly number[];
  /** Pflicht bei `exempt`; sonst optional als Kommentar zur Einordnung. */
  readonly reason?: string;
}

/**
 * Ein Grund, auf dem Vordergrund steht. Ist er selbst durchscheinend (`rgba(...)`,
 * `calc()`-Alpha), nennt `over` den Grund darunter — der Generator mischt die Kette
 * zu dem Pixel zusammen, das real auf dem Schirm steht. Ein Grund, der nach dem
 * Mischen noch Alpha trägt, ist ein Befund, keine Messung.
 */
export interface A11yGround {
  readonly token: string;
  readonly over?: string;
}

/**
 * Eine farbwirksame Tweak-Achse (CO5-Garantie, Goldene Regel 6): der benannte Tweak
 * aus `SkinManifest.tweaks` speist die CSS-Custom-Property `cssVar`. Der Generator
 * fährt jede Achse an BEIDE Extreme (`min`/`max` bzw. erste/letzte Option) und misst
 * dort erneut. Ein Kontrast, der nur beim Default hält, ist damit kein Bestehen mehr.
 */
export interface A11yTweakAxis {
  readonly tweak: string;
  readonly cssVar: string;
}

/**
 * Die Palette-Deklaration eines Skins (v1.13). Sie ist die Vertrags-Fläche, über die
 * ein Skin dem Konformitäts-Generator sagt, wo seine Farben stehen und was sie tun —
 * ohne dass der Generator ein Stylesheet-Format erraten oder Rollen vermuten müsste.
 *
 * Der Generator prüft die Deklaration auf VOLLSTÄNDIGKEIT gegen das echte Stylesheet:
 * ein Farb-Token in einem erklärten Block, der hier fehlt, ist ein Befund. Deshalb
 * lässt sich eine unbequeme Farbe nicht durch Weglassen aus der Messung nehmen.
 */
export interface SkinA11y {
  /** Stylesheet(s) mit den Farb-Token — relativ zum Manifest oder als Paket-Export. */
  readonly stylesheet: string | readonly string[];
  /** Selektor des themenunabhängigen Token-Blocks (Palette-Boden), z. B. `:root`. */
  readonly base?: string;
  /** Theme-Name → Selektor des Blocks, der die Theme-Token setzt. */
  readonly themes: Readonly<Record<string, string>>;
  /** Themes, die bewusst NICHT gemessen werden, mit Begründung (Goldene Regel 3). */
  readonly exemptThemes?: Readonly<Record<string, string>>;
  /** Die Gründe, auf denen Vordergrund steht — der erste muss deckend sein. */
  readonly grounds: readonly A11yGround[];
  /** Jede Deckkraft, die der Skin auf Farbe legt. Default `[1]`. */
  readonly alphas?: readonly number[];
  /** Jeder Farb-Token der erklärten Blöcke → seine Rolle. Vollständigkeit wird geprüft. */
  readonly tokens: Readonly<Record<string, A11yTokenDecl>>;
  /** Farbwirksame Tweaks; leer/fehlend heisst „dieser Skin bewegt keine Farbe per Tweak". */
  readonly tweakAxes?: readonly A11yTweakAxis[];
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
  /**
   * Palette-Deklaration für die AA-Messung (v1.13). Optional in der TYPform, damit
   * 1.12-Manifeste gültig bleiben — der Konformitäts-Generator wertet ein Fehlen aber
   * als `undeclared` und damit als Fehler: AA ist Pflicht (Goldene Regel 6), und ein
   * Skin ohne Deklaration ist im Report unterscheidbar von einem, der deklariert und
   * besteht (Goldene Regel 3).
   */
  readonly a11y?: SkinA11y;
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
  /** Die AA-Messung (v1.13) — `undeclared`, wenn das Manifest keine Palette nennt. */
  readonly a11y?: SupportA11y;
}

/* ------------------------------------------- A11y im Report (§8, v1.13) --- */

/** Eine einzelne gemessene Paarung — Vordergrund über Grund, bei einer Deckkraft. */
export interface A11yMeasurement {
  readonly theme: string;
  readonly token: string;
  readonly role: 'text' | 'graphic';
  readonly ground: string;
  readonly alpha: number;
  /** Die Tweak-Stellung, unter der gemessen wurde — `default` oder `<tweak>=<wert>`. */
  readonly tweaks: string;
  /** Gemessenes WCAG-2.1-Verhältnis, auf zwei Stellen gerundet. */
  readonly ratio: number;
  /** Die Schwelle, gegen die geprüft wurde (4.5 oder 3). */
  readonly threshold: number;
}

/** Ein Befund an der Deklaration selbst — sie ist unvollständig oder unrechenbar. */
export interface A11yFinding {
  readonly problem:
    | 'undeclared'
    | 'stylesheet-unreadable'
    | 'selector-missing'
    | 'unclassified'
    | 'unresolvable'
    | 'unaccounted-alpha'
    | 'translucent-ground'
    | 'unknown-ground'
    | 'unknown-tweak'
    | 'exempt-without-reason';
  readonly detail: string;
}

/** Der `a11y`-Block in support.json (§8) — gemessen, nie behauptet. */
export interface SupportA11y {
  /**
   *  - `pass`       – deklariert, vollständig, jede Paarung über der Schwelle.
   *  - `fail`       – deklariert und GEMESSEN unter der Schwelle, oder die
   *    Deklaration selbst ist unvollständig/unrechenbar.
   *  - `undeclared` – keine Palette im Manifest: AA ist ungemessen, nicht bestanden.
   */
  readonly status: 'pass' | 'fail' | 'undeclared';
  /** Kurzform für Registry/Wand: hält der Skin AA über alles Gemessene? */
  readonly aa: boolean;
  /** Wurde an den Extremen JEDER farbwirksamen Tweak-Achse gemessen? */
  readonly checkedTweakExtremes: boolean;
  readonly thresholds: { readonly text: number; readonly graphic: number };
  /** Gemessene Themes, und die bewusst ausgenommenen mit ihrer Begründung. */
  readonly themes: readonly string[];
  readonly exemptThemes?: Readonly<Record<string, string>>;
  /** Die angefahrenen Tweak-Stellungen (`default` plus je Achse beide Extreme). */
  readonly tweakStops: readonly string[];
  /** Zahl der geprüften Paarungen (Theme × Token × Grund × Deckkraft × Tweak-Stopp). */
  readonly combinations: number;
  /** Die knappste bestandene Paarung je Rolle — der Abstand zur Schwelle. */
  readonly worst: Readonly<Record<string, A11yMeasurement>>;
  /** Wie viele Paarungen unter der Schwelle lagen — die VOLLE Zahl. */
  readonly violationCount: number;
  /**
   * Die schlimmsten Verstösse, aufsteigend nach Verhältnis. Gedeckelt, damit ein
   * Skin mit systematisch zu blasser Palette nicht hunderte Zeilen in support.json
   * schreibt; `violationCount` nennt die ungekürzte Zahl.
   */
  readonly violations: readonly A11yMeasurement[];
  /** Bewusst ungemessene Token mit ihrer Begründung (Goldene Regel 3). */
  readonly exempt?: Readonly<Record<string, string>>;
  /** Befunde an der Deklaration selbst. Leer bei `pass`. */
  readonly findings: readonly A11yFinding[];
}
