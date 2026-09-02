/**
 * core/model — the device/room model of the obs Visu mobile app.
 *
 * Ported 1:1 in shape from reference/vue-ionic/store.js (the `list` device
 * dataset and the `mobileGroups` room grouping). Data shapes follow
 * CONTRACT-v1 §3 — every device here is a contract *core* `Device`
 * (light | switch | blind | jalousie, the v1.2 additions media | camera, and the
 * v1.4 additions sensor | scene | climate). The still-reserved tablet/desktop
 * types (weather, energy, chart, alarm) stay out of the mobile model.
 *
 * The v1.4 additions render in the overview wall too: the enriched `sensor`
 * (Zeitreihe/Icon), `scene` and the media/camera in the "Technik" showcase block,
 * and the `climate` (Heizung/RTR) tile grouped in the Wohnzimmer — one wall for
 * the skin-to-reference comparison.
 *
 * The v1.2 `media`/`camera` devices live in a dedicated "Medien" demo block
 * ({@link demoRooms}) kept OUT of the mobile overview ({@link rooms}): they are
 * one model (golden rule 1 — no data fork, the data source serves them too), but
 * the overview floor stays the ported store.js set so the ionic overview page is
 * unaffected. A dedicated demo page renders the Medien block (Issue #122).
 *
 * Goldene Regeln honoured here:
 *  - One model/state lives in core; this module is that single source of
 *    truth for the mobile device list (Regel 1).
 *  - "Renderer rein": this file imports NO skin and NO renderer — only the
 *    data/type contract `@obs/visu-contract`.
 *  - The model is read-only to the outside: `devices`, `byId`, `rooms` are
 *    frozen and typed `readonly`. Canonical mutations live in the host
 *    action layer (CONTRACT-v1 §6), not here.
 *
 * Data and behaviour are kept apart (Regel "Daten=JSON, Verhalten=Code"):
 * the device shapes mirror the contract data, the only code here is the pure
 * `layoutRole` mapping.
 */

import type {
  Device,
  LightDevice,
  SwitchDevice,
  BlindDevice,
  JalousieDevice,
  SensorDevice,
  SceneDevice,
  MediaDevice,
  CameraDevice,
  ClimateDevice,
  Role,
  WidgetPosition,
  PageLink,
} from '@obs/visu-contract';

/* ------------------------------------------------------------------ helpers */
// Small constructors mirroring store.js (L/SW/B/J) so the dataset below reads
// the same way the prototype did. They only assemble plain data — no logic.

function light(
  id: string,
  room: string,
  label: LightDevice['label'],
  accent: LightDevice['accent'],
  extra: Partial<Pick<LightDevice, 'on' | 'dim' | 'floor'>> = {},
): LightDevice {
  return { id, type: 'light', room, label, accent, on: false, dim: null, ...extra };
}

function swtch(
  id: string,
  room: string,
  label: SwitchDevice['label'],
  accent: SwitchDevice['accent'],
  extra: Partial<Pick<SwitchDevice, 'on' | 'floor'>> = {},
): SwitchDevice {
  return { id, type: 'switch', room, label, accent, on: false, ...extra };
}

function blind(
  id: string,
  room: string,
  label: BlindDevice['label'],
  accent: BlindDevice['accent'],
  extra: Partial<Pick<BlindDevice, 'position' | 'locked' | 'presets' | 'floor'>> = {},
): BlindDevice {
  return { id, type: 'blind', room, label, accent, position: 0, locked: false, ...extra };
}

function jalousie(
  id: string,
  room: string,
  label: JalousieDevice['label'],
  accent: JalousieDevice['accent'],
  extra: Partial<
    Pick<
      JalousieDevice,
      'position' | 'slat' | 'locked' | 'invert' | 'moving' | 'statuses' | 'presets' | 'floor'
    >
  > = {},
): JalousieDevice {
  return {
    id,
    type: 'jalousie',
    mode: 'jalousie',
    room,
    label,
    accent,
    position: 0,
    slat: 0,
    locked: false,
    invert: false,
    moving: null,
    statuses: [],
    ...extra,
  };
}

function media(
  id: string,
  room: string,
  label: MediaDevice['label'],
  accent: MediaDevice['accent'],
  extra: Partial<
    Pick<MediaDevice, 'playState' | 'title' | 'subtitle' | 'volume' | 'artUrl' | 'floor'>
  > = {},
): MediaDevice {
  return {
    id,
    type: 'media',
    room,
    label,
    accent,
    playState: 'stopped',
    title: null,
    subtitle: null,
    volume: 0,
    ...extra,
  };
}

function camera(
  id: string,
  room: string,
  label: CameraDevice['label'],
  accent: CameraDevice['accent'],
  extra: Partial<Pick<CameraDevice, 'online' | 'snapshotUrl' | 'streamUrl' | 'floor'>> = {},
): CameraDevice {
  return { id, type: 'camera', room, label, accent, online: false, snapshotUrl: null, ...extra };
}

function sensor(
  id: string,
  room: string,
  label: SensorDevice['label'],
  accent: SensorDevice['accent'],
  value: SensorDevice['value'],
  unit: SensorDevice['unit'],
  extra: Partial<Pick<SensorDevice, 'status' | 'icon' | 'series' | 'min' | 'max' | 'floor'>> = {},
): SensorDevice {
  return { id, type: 'sensor', room, label, accent, value, unit, ...extra };
}

function scene(
  id: string,
  room: string,
  label: SceneDevice['label'],
  accent: SceneDevice['accent'],
  icon: SceneDevice['icon'],
  extra: Partial<Pick<SceneDevice, 'sub' | 'floor'>> = {},
): SceneDevice {
  return { id, type: 'scene', room, label, accent, icon, ...extra };
}

function climate(
  id: string,
  room: string,
  label: ClimateDevice['label'],
  accent: ClimateDevice['accent'],
  extra: Partial<Pick<ClimateDevice, 'setpoint' | 'current' | 'mode' | 'unit' | 'floor'>> = {},
): ClimateDevice {
  return {
    id,
    type: 'climate',
    room,
    label,
    accent,
    setpoint: 21,
    current: 21,
    mode: 'heat',
    unit: '°C',
    ...extra,
  };
}

/* ------------------------------------------------------- device dataset §3 */
// The mobile-overview devices, in store.js source order. Each device carries
// its own state; screens reference them by id.

const list: readonly Device[] = [
  // ── Küche (Erdgeschoss) ──
  // `floor` carries the Geschoss for the detail crumb ("<floor> / <room>",
  // CONTRACT v1.4). The room label drops the "EG " prefix so the crumb does not
  // repeat the floor ("Erdgeschoss / Küche", not "Erdgeschoss / EG Küche").
  light('kueche-wand', 'Küche', 'Wandleuchten', 'orange', { floor: 'Erdgeschoss' }),
  light('kueche-pendel', 'Küche', 'Pendelleuchten', 'orange', { dim: 0, floor: 'Erdgeschoss' }),
  light('kueche-arbeit', 'Küche', 'Arbeitslicht', 'orange', { dim: 0, floor: 'Erdgeschoss' }),
  blind('kueche-roll', 'Küche', 'Rollladen', 'orange', {
    floor: 'Erdgeschoss',
    // v1.6 Vorgabepositionen für den Long-Press-Schnellzugriff (Rolladen: nur position).
    presets: [
      { label: 'Guten Morgen', position: 0 },
      { label: 'Spalt offen', position: 85 },
      { label: 'Schlitze', position: 70 },
    ],
  }),

  // ── WC & Bad (Erdgeschoss) ──
  light('wc-spiegel', 'WC', 'Spiegellicht', 'teal', { on: true, floor: 'Erdgeschoss' }),
  swtch('wc-luefter', 'WC', 'Lüfter (10 Min)', 'teal', { on: true, floor: 'Erdgeschoss' }),
  light('bad-spiegel', 'Bad', 'Spiegellicht', 'violet', { floor: 'Erdgeschoss' }),

  // ── Wintergarten (Erdgeschoss) ──
  light('wiga-pendel', 'Wintergarten', 'Pendelleuchten', 'green', { dim: 0, floor: 'Erdgeschoss' }),
  light('wiga-wand', 'Wintergarten', 'Wandleuchten', 'green', { dim: 0, floor: 'Erdgeschoss' }),
  blind('wiga-roll', 'Wintergarten', 'Rollladen', 'green', { locked: true, floor: 'Erdgeschoss' }),
  jalousie('wiga-jalousie', 'Wintergarten', 'Jalousie Süd', 'green', {
    position: 62,
    slat: 35,
    floor: 'Erdgeschoss',
    statuses: [
      { label: 'Sturm', val: false },
      { label: 'Sonne', val: true },
      { label: 'Sperre', val: null },
    ],
    // v1.6 Vorgabepositionen (Position + optional Lamelle) für den Schnellzugriff.
    presets: [
      { label: 'Beschattung', position: 75, slat: 60 },
      { label: 'Lüften', position: 90 },
      { label: 'Offen', position: 0, slat: 0 },
    ],
  }),
  jalousie('wiga-jalousie-2', 'Wintergarten', 'Jalousie Ost', 'green', {
    position: 40,
    slat: 60,
    floor: 'Erdgeschoss',
    statuses: [
      { label: 'Sturm', val: false },
      { label: 'Sonne', val: true },
    ],
  }),

  // ── Schlafzimmer (Erdgeschoss) ──
  blind('schlaf-ost', 'Schlafz.', 'Rollladen Ost', 'orange', { floor: 'Erdgeschoss' }),
  blind('schlaf-sued', 'Schlafz.', 'Rollladen Süd', 'orange', { floor: 'Erdgeschoss' }),

  // ── Wohnzimmer (Erdgeschoss) ──
  blind('wohn-west', 'Wohnz.', 'Rollladen West', 'orange', { floor: 'Erdgeschoss' }),
  blind('wohn-balkon', 'Wohnz.', 'Rolladen Balkon', 'orange', { floor: 'Erdgeschoss' }),
  blind('wohn-sued', 'Wohnz.', 'Rollladen Süd', 'orange', { floor: 'Erdgeschoss' }),
  // v1.4 climate (RTR) now renders in the overview wall (its skin renderer ships):
  // a first-class Wohnzimmer device, wide (2×1) tile per its contract role.
  climate('rtr-wohnen', 'Wohnz.', 'Heizung Wohnen', 'orange', {
    setpoint: 21.5,
    current: 20.8,
    mode: 'heat',
    unit: '°C',
    floor: 'Erdgeschoss',
  }),

  // ── Gäste & Treppe (Erdgeschoss) ──
  blind('gaeste-roll', 'Gästez.', 'Rollladen', 'orange', { floor: 'Erdgeschoss' }),
  light('treppe-eingang', 'Treppe', 'Hauseingang', 'orange', { floor: 'Erdgeschoss' }),
  light('treppe-haus', 'Treppe', 'Treppenhaus', 'orange', { floor: 'Erdgeschoss' }),

  // ── Technik (v1.4 showcase — sensor · scene · media · camera on one wall) ──
  // Rounds out the overview floor so those core types render alongside the rest
  // for the skin-to-reference visual comparison. `floor` carries the Geschoss
  // label for the detail crumb path (CONTRACT v1.4). (climate lives in the
  // Wohnzimmer block above, now that its skin renderer ships.)
  sensor('voc-wc', 'Technik', 'VOC', 'teal', 287, 'ppm', {
    status: 'erhöht',
    series: [46, 120, 288, 250, 210],
    min: 46,
    max: 288,
    floor: 'Erdgeschoss',
  }),
  sensor('wetter-aussen', 'Technik', 'Außentemperatur', 'blue', 8.4, '°C', {
    status: 'komfort',
    icon: 'cloud',
    floor: 'Außen',
  }),
  scene('szene-abend', 'Technik', 'Guten Abend', 'violet', 'sparkle', {
    sub: 'Licht · Rollladen · TV',
    floor: 'Erdgeschoss',
  }),
  media('tech-sonos', 'Technik', 'Sonos Bad', 'blue', {
    playState: 'playing',
    title: 'La Femme d’Argent',
    subtitle: 'Air',
    volume: 22,
    artUrl: 'https://example.invalid/art/moon-safari.jpg',
    floor: 'Erdgeschoss',
  }),
  camera('tech-cam', 'Technik', 'Kamera Terrasse', 'slate', {
    online: true,
    snapshotUrl: 'https://example.invalid/cam/terrasse/snapshot.jpg',
    streamUrl: 'https://example.invalid/cam/terrasse/stream.m3u8',
    floor: 'Erdgeschoss',
  }),

  // ── Medien (v1.2 demo block — not in the mobile overview floor) ──
  media('wohn-sonos', 'Medien', 'Sonos Wohnzimmer', 'blue', {
    playState: 'playing',
    title: 'Strobe',
    subtitle: 'deadmau5',
    volume: 34,
    artUrl: 'https://example.invalid/art/strobe.jpg',
  }),
  media('kueche-radio', 'Medien', 'Küchenradio', 'amber', {
    playState: 'paused',
    title: 'Nachrichten',
    subtitle: 'SWR1',
    volume: 18,
  }),
  camera('hof-cam', 'Medien', 'Kamera Hofeinfahrt', 'slate', {
    online: true,
    snapshotUrl: 'https://example.invalid/cam/hof/snapshot.jpg',
    streamUrl: 'https://example.invalid/cam/hof/stream.m3u8',
  }),
  camera('garage-cam', 'Medien', 'Kamera Garage', 'slate', {
    online: false,
    snapshotUrl: null,
  }),
];

/**
 * Recursively freeze a value so the read-only boundary holds for nested fields
 * too — a shallow `Object.freeze` still allows `devices[0].on = true` or
 * `statuses.push(...)`. Freezes objects/arrays in place and returns the value.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** All mobile devices, in source order. Read-only to the outside (Regel 1). */
export const devices: readonly Device[] = deepFreeze(list);

/**
 * Lookup by id — the canonical handle screens use to reference a device.
 *
 * Typed `Device | undefined` because an unknown or stale id (a route param, a
 * persisted layout, an edited room entry) resolves to `undefined` at runtime;
 * the type forces callers to guard before passing the result to code that reads
 * `device.type` (e.g. {@link layoutRole}).
 */
export const byId: Readonly<Record<string, Device | undefined>> = Object.freeze(
  Object.fromEntries(list.map((d) => [d.id, d])) as Record<string, Device | undefined>,
);

/* ---------------------------------------------------------- room grouping */
// store.js → mobileGroups: each block is one room. Screens render them as
// separate grids with a gap between, so the spacing itself reads as
// "you are now in another room". Order + grouping are the floor (the layout
// baseline a skin may refine but not discard).

/**
 * One layout entry: the device id plus optional prominence hints carried over
 * from store.js. `span`/`row` are *hints*, not pixels — the page speaks roles
 * (CONTRACT-v1 §2), and {@link layoutRole} derives the contract role from them.
 */
export interface LayoutEntry {
  readonly id: string;
  /** Column span hint (mobile grid is 3-wide); 2 ⇒ a wider tile. */
  readonly span?: number;
  /** Row-span hint for tall tiles (e.g. the jalousie). */
  readonly row?: number;
  /** Author pixel/grid box (x/y/w/h, CONTRACT-v1.9 → layering W3). Additive: only
   *  a skin honouring `position` uses it; the responsive floor ignores it. */
  readonly position?: WidgetPosition;
  /** Jump target of this placed element (CONTRACT-v1.11 → #1194). Additive: an
   *  entry without it behaves exactly as before; with it a tile that has no click
   *  function of its own navigates. The HOST resolves and executes it. */
  readonly link?: PageLink;
}

/** One room block: an ordered list of layout entries. */
export interface RoomGroup {
  readonly room: string;
  readonly entries: readonly LayoutEntry[];
}

const e = (id: string, span?: number, row?: number): LayoutEntry =>
  span === undefined && row === undefined ? { id } : { id, span, row };

/** Attach a page link to an entry (CONTRACT-v1.11 → #1194). Data only. */
const link = (entry: LayoutEntry, targetNodeId: string, activeIndicator?: PageLink['activeIndicator']): LayoutEntry => ({
  ...entry,
  link: activeIndicator ? { targetNodeId, activeIndicator } : { targetNodeId },
});

/** Ordered room blocks for the mobile overview (store.js → mobileGroups). */
export const rooms: readonly RoomGroup[] = Object.freeze([
  { room: 'Küche', entries: ['kueche-wand', 'kueche-pendel', 'kueche-arbeit', 'kueche-roll'].map((id) => e(id)) },
  { room: 'WC & Bad', entries: ['wc-spiegel', 'wc-luefter', 'bad-spiegel'].map((id) => e(id)) },
  {
    room: 'Wintergarten',
    entries: [
      e('wiga-pendel', 2),
      e('wiga-wand'),
      e('wiga-roll'),
      e('wiga-jalousie', 2, 3),
      e('wiga-jalousie-2', 2, 2),
    ],
  },
  { room: 'Schlafzimmer', entries: ['schlaf-ost', 'schlaf-sued'].map((id) => e(id)) },
  {
    room: 'Wohnzimmer',
    // The climate tile takes a wide (2×1) cell, its contract role in the wall.
    entries: [e('wohn-west'), e('wohn-balkon'), e('wohn-sued'), e('rtr-wohnen', 2)],
  },
  { room: 'Gäste & Treppe', entries: ['gaeste-roll', 'treppe-eingang', 'treppe-haus'].map((id) => e(id)) },
  {
    room: 'Technik',
    entries: [
      e('voc-wc'),
      e('wetter-aussen'),
      e('szene-abend', 2),
      e('tech-sonos', 2),
      e('tech-cam', 2),
    ],
  },
] satisfies RoomGroup[]);

/**
 * The v1.2 "Medien" demo block — `media` + `camera` devices grouped as one room
 * (Issue #122). Kept SEPARATE from {@link rooms} so the mobile overview floor is
 * unchanged; a dedicated demo page renders this block. The devices themselves are
 * part of the single model ({@link devices}/{@link byId}), so the data source
 * serves them — no data fork (golden rule 1).
 */
export const demoRooms: readonly RoomGroup[] = Object.freeze([
  {
    room: 'Medien',
    entries: [
      e('wohn-sonos', 2),
      e('kueche-radio', 2),
      // #1194: the camera tiles have no click function of their own (only the
      // small refresh button is interactive), so the tap jumps to the camera's
      // full-screen page — the author's example from the upstream issue.
      link(e('hof-cam', 2), 'camera-full', 'border'),
      link(e('garage-cam', 2), 'camera-full', 'border'),
    ],
  },
] satisfies RoomGroup[]);

/**
 * The #1194 target page: the camera claiming the full 3-column grid — the
 * „Vollbild-Seite" a small camera tile links to. The big tile links BACK to the
 * media block (the return jump uses the same host action); the small one below
 * points at this very page, so it shows the active indicator — the host marks a
 * link whose target is the current page (or an ancestor of it), like V1.
 */
export const cameraFullRooms: readonly RoomGroup[] = Object.freeze([
  {
    room: 'Kamera Hofeinfahrt',
    entries: [link(e('hof-cam', 3, 3), 'demo-media', 'border')],
  },
  {
    room: 'Weitere Kameras',
    entries: [link(e('garage-cam', 2), 'camera-full', 'dot')],
  },
] satisfies RoomGroup[]);

/* ----------------------------------------------------------- span/row → role */
// CONTRACT-v1 §2: the page speaks ROLES (prominence), not pixels. The store.js
// layout hints map onto contract roles as follows:
//
//   • no hint        → the device type's contract default role
//                      (light/switch/blind: "default"; jalousie: "wide")
//   • span ≥ 2       → "wide"  (a tile that claims a wider cell)
//
// The jalousie keeps its contract default role ("wide") regardless of the
// extra row hint — its tallness is a render concern of the jalousie component,
// not a different prominence. A skin may refine these within the type's
// allowed roles; this mapping is only the baseline ("Reihenfolge + Gruppierung
// als Boden").

/** The contract default role per core widget type (CONTRACT-v1 §3 `roles.default`). */
const DEFAULT_ROLE: Record<Device['type'], Role> = {
  light: 'default',
  switch: 'compact',
  blind: 'default',
  jalousie: 'wide',
  sensor: 'compact',
  scene: 'default',
  media: 'wide',
  camera: 'wide',
  // climate: promoted to a prominent wide (2×1) tile so the RTR reads as a
  // feature in the wall (contract `climate.roles.allow` includes wide, not
  // feature — wide is the largest allowed prominence).
  climate: 'wide',
};

/**
 * Types whose contract `roles.allow` includes `wide` (CONTRACT-v1 §3). A span ≥ 2
 * may only promote these to `wide`; switch/sensor (allow compact|default only)
 * keep their default role so the host never hands a skin an invalid role.
 */
const WIDE_ALLOWED: ReadonlySet<Device['type']> = new Set<Device['type']>([
  'light',
  'blind',
  'jalousie',
  'scene',
  'climate',
]);

/**
 * Derive the contract prominence role for a layout entry + its device.
 * Pure function — no state, no side effects.
 */
export function layoutRole(entry: LayoutEntry, device: Device): Role {
  if (device.type === 'jalousie') return DEFAULT_ROLE.jalousie;
  if (entry.span !== undefined && entry.span >= 2 && WIDE_ALLOWED.has(device.type)) return 'wide';
  return DEFAULT_ROLE[device.type];
}
