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
 *  - No data fork: a page never copies or rewrites devices. It selects from the
 *    core `rooms` (order + grouping stay the floor) — by reference, filtered only
 *    by room name when `rooms` is given. The same device object renders through
 *    whichever skin the page names.
 *  - Skin addressed by name: a page carries a `skin` *key*; the host resolves it
 *    via the registry (`skin-host/skins` → resolveSkin), and an unknown key is a
 *    hard, visible failure — never a silent default.
 */

import { rooms as modelRooms, demoRooms, type RoomGroup } from '../core/model';
import type { SkinKey } from '../skin-host/skins';

/**
 * Which model room set a page draws from. `overview` = the ported store.js mobile
 * floor ({@link modelRooms}); `demo` = the v1.2 Medien block ({@link demoRooms},
 * media/camera — Issue #122). A page picks one source, then optionally filters it
 * by room name. Both sets are the core model (no data fork); the split only keeps
 * the media/camera demo out of the overview floor.
 */
export type RoomSource = 'overview' | 'demo';

/** The base room blocks for a page's declared {@link RoomSource}. */
function baseRooms(source: RoomSource | undefined): readonly RoomGroup[] {
  return source === 'demo' ? demoRooms : modelRooms;
}

/**
 * One page definition — pure data (the JSON half of "Daten=JSON, Verhalten=Code").
 *
 * The room set is described *declaratively*: omit `rooms` for "every room in the
 * core model, in source order" (the overview); give a `rooms` allowlist to scope
 * a page to specific rooms (still in core source order — the floor is preserved).
 */
export interface PageDef {
  /** Stable id — the route param and the nav key (`shell.nav.*` is separate). */
  readonly id: string;
  /** i18n key for the page title (`pages.<id>.title`). */
  readonly titleKey: string;
  /** The skin that renders this page (author's choice; resolved by the host). */
  readonly skin: SkinKey;
  /**
   * Which model room set the page draws from (default `overview`). `demo` selects
   * the v1.2 Medien block (media/camera). The source is filtered further by
   * `rooms` when present.
   */
  readonly source?: RoomSource;
  /**
   * Optional room allowlist (by `RoomGroup.room`). When omitted, the page shows
   * every room of its source in source order. When given, only those rooms render
   * — still in core source order, so order + grouping stay the floor.
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
  { id: 'overview', titleKey: 'pages.overview.title', skin: 'ionic' },
  { id: 'terminal', titleKey: 'pages.terminal.title', skin: 'terminal' },
  // The v1.2 media/camera demo (Issue #122): the Medien block, rendered by the
  // ionic skin. Until the ionic skin ships media/camera renderers (parallel skins
  // work), the host shows a declared gap at runtime — resolution + data are tested.
  { id: 'demo-media', titleKey: 'pages.demoMedia.title', skin: 'ionic', source: 'demo' },
] satisfies PageDef[]);

/** Lookup a page definition by id (the route param / nav key). */
export const pageById: Readonly<Record<string, PageDef>> = Object.freeze(
  Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<string, PageDef>,
);

/** A resolved page: the def plus the concrete, ordered room blocks it renders. */
export interface ResolvedPage {
  readonly def: PageDef;
  /** The ordered, grouped room blocks (core `rooms`, filtered by `def.rooms`). */
  readonly groups: readonly RoomGroup[];
}

/**
 * Resolve a page definition into the room blocks it renders (Verhalten=Code).
 *
 * Pure: reads only the core model. Selects core `rooms` BY REFERENCE in source
 * order (no data fork), filtered to `def.rooms` when present. An unknown page id,
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

  const source = baseRooms(def.source);
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
