/**
 * pages/pages — the page definitions of the obs Visu mobile app (A5, Issue #101).
 *
 * A *page* is the author's unit of "a screen": a title, the rooms/devices it
 * shows, and the skin that renders it. The app ships at least two pages over the
 * SAME core devices — an `ionic` page (Glass tiles) and a `terminal` page (list
 * rows) — to prove the pluggable skin promise: identical data, different skin.
 *
 * Goldene Regeln honoured:
 *  - Daten=JSON, Verhalten=Code: a {@link PageDef} is plain data (a title key, a
 *    skin key, an optional room filter). The only *behaviour* is the pure
 *    {@link resolvePage} resolver — it owns no state and reads only the core
 *    model (`core/model` → ordered, grouped rooms) + the registry skin keys.
 *  - No data fork: a page never copies or rewrites devices. It NAMES a core model
 *    block (`groups`) by reference (order + grouping stay the floor), filtered
 *    only by room name when `rooms` is given. The ionic and the terminal page
 *    name the SAME object, so the same device renders through both skins.
 *  - Skin addressed by name: a page carries a `skin` *key*; the host resolves it
 *    via the registry (`skin-host/skins` → resolveSkin), and an unknown key is a
 *    hard, visible failure — never a silent default.
 */

import { rooms as mobileGroups, demoRooms, cameraFullRooms, type RoomGroup, type LayoutEntry } from '../core/model';
import type { SkinKey } from '../skin-host/skins';
import type { Device, PageLink, WidgetPosition } from '@obs/visu-contract';

/**
 * One page definition — pure data (the JSON half of "Daten=JSON, Verhalten=Code").
 *
 * The room set is described *declaratively*: name a core model block in `groups`
 * and, optionally, scope it with a `rooms` allowlist (still in source order — the
 * floor is preserved).
 */
export interface PageDef {
  /** Stable id — the route param and the nav key (`shell.nav.*` is separate). */
  readonly id: string;
  /** i18n key for the page title (`pages.<id>.title`). */
  readonly titleKey: string;
  /** The skin that renders this page (author's choice; resolved by the host). */
  readonly skin: SkinKey;
  /**
   * The ordered, room-grouped floor this page renders — a core model block
   * **by reference** ({@link mobileGroups} = the ported store.js `mobileGroups`,
   * or {@link demoRooms}). Its items carry `role`, not `span` (Issue #101 AC1).
   *
   * Two pages that name the SAME object therefore render the same devices from
   * the same floor: `PAGES.overview.groups === PAGES.terminal.groups` is the
   * no-data-fork guarantee in one `===` (Goldene Regel 1). A page never copies,
   * rewrites or re-orders the block it names.
   */
  readonly groups: readonly RoomGroup[];
  /**
   * Optional room allowlist (by `RoomGroup.room`). When omitted, the page shows
   * every room of its `groups` in source order. When given, only those rooms
   * render — still in source order, so order + grouping stay the floor.
   */
  readonly rooms?: readonly string[];
}

/**
 * The app's pages, in nav/source order. Both pages cover the SAME devices (no
 * `rooms` filter → the full core overview); only the `skin` differs. This is the
 * A5 deliverable: one ionic page (Glass tiles) and one terminal page (list rows)
 * over one shared core model.
 */
export const PAGES: readonly PageDef[] = Object.freeze([
  // The A5 pair: ONE floor object (`mobileGroups`), two skins. Same rooms, same
  // order, same devices — only `skin` differs.
  { id: 'overview', titleKey: 'pages.overview.title', skin: 'ionic', groups: mobileGroups },
  { id: 'terminal', titleKey: 'pages.terminal.title', skin: 'terminal', groups: mobileGroups },
  // The v1.2 media/camera demo (Issue #122): the Medien block, rendered by the
  // ionic skin. Until the ionic skin ships media/camera renderers (parallel skins
  // work), the host shows a declared gap at runtime — resolution + data are tested.
  { id: 'demo-media', titleKey: 'pages.demoMedia.title', skin: 'ionic', groups: demoRooms },
  // Edomi POC (layering W4): a page-owning skin. It draws its own nav + pixel layer
  // canvas + popups from the live backend tree (OBS mode); the room-grouped floor is
  // unused here (the page renderer ignores `groups`).
  { id: 'edomi', titleKey: 'pages.edomi.title', skin: 'edomi', groups: mobileGroups },
  // #1194: the full-screen camera page a small camera tile links to. Same core
  // devices as the media block (no data fork) — only the placement differs.
  { id: 'camera-full', titleKey: 'pages.cameraFull.title', skin: 'ionic', groups: cameraFullRooms },
] satisfies PageDef[]);

/** Lookup a page definition by id (the route param / nav key). */
export const pageById: Readonly<Record<string, PageDef>> = Object.freeze(
  Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<string, PageDef>,
);

/** A resolved page: the def plus the concrete, ordered room blocks it renders. */
export interface ResolvedPage {
  readonly def: PageDef;
  /** The ordered, grouped room blocks (`def.groups`, filtered by `def.rooms`). */
  readonly groups: readonly RoomGroup[];
}

/**
 * Resolve a page definition into the room blocks it renders (Verhalten=Code).
 *
 * Pure: reads only the definition. Returns the def's own `groups` BY REFERENCE
 * in source order (no data fork), filtered to `def.rooms` when present — only a
 * filtered page allocates a new array, and even then the *entries* stay shared.
 * An unknown page id,
 * or a `rooms` entry naming a room the core model does not have, is an authoring
 * gap surfaced loudly — the same "never a silent default" discipline the skin
 * registry and the layout resolver follow.
 */
export function resolvePage(id: string): ResolvedPage {
  const def = pageById[id];
  if (!def) {
    const known = PAGES.map((p) => p.id).join(', ');
    throw new Error(`pages: unknown page "${id}" — no such page definition (known: ${known}).`);
  }

  const source = def.groups;
  if (!def.rooms) {
    return { def, groups: source };
  }

  const allow = new Set(def.rooms);
  const known = new Set(source.map((g) => g.room));
  for (const room of def.rooms) {
    if (!known.has(room)) {
      throw new Error(`pages: page "${id}" filters on room "${room}" which the core model does not define.`);
    }
  }
  // Filter in CORE source order (the floor), not in the allowlist's order.
  const groups = source.filter((g) => allow.has(g.room));
  return { def, groups };
}

/**
 * Derive the room blocks for a page from a LIVE device set (Verhalten=Code).
 *
 * The static {@link resolvePage} floor is the demo model's `rooms` — its ids are
 * the mock devices. Against a real backend the device set (and its ids/rooms)
 * comes from the server's filtered `GET /visu/tree`, so the floor must be derived
 * from those devices instead: group by the device's `room` in FIRST-APPEARANCE
 * order (the tree's order is the floor), entries in device order. No data fork —
 * the entries reference the same live devices by id; grouping/order stay the
 * floor. Every entry id is one of the given devices, so the layout resolver never
 * throws "references no device" the way the static mock floor does off-model.
 */
export function groupDevicesByRoom(
  devices: readonly Device[],
  positions?: ReadonlyMap<string, WidgetPosition>,
  links?: ReadonlyMap<string, PageLink>,
): RoomGroup[] {
  const byRoom = new Map<string, LayoutEntry[]>();
  for (const d of devices) {
    if (!d.id) continue;
    const room = d.room ?? '';
    let entries = byRoom.get(room);
    if (!entries) {
      entries = [];
      byRoom.set(room, entries);
    }
    // Carry the additive author position (layering W3) when the source has one;
    // a responsive skin ignores it, a pixel skin honours it.
    const position = positions?.get(d.id);
    // Carry the additive page link (#1194) the same way; the host resolves it.
    const link = links?.get(d.id);
    entries.push({ id: d.id, ...(position ? { position } : {}), ...(link ? { link } : {}) });
  }
  return [...byRoom.entries()].map(([room, entries]) => ({ room, entries }));
}
