/**
 * skin-host/skins — the skin registry (A1, Issue #97).
 *
 * The host is the only layer allowed to import a skin (Goldene Regeln 1/4):
 * the core owns the model + state, the skin reads it, and this module is the
 * single seam where a concrete skin (`@obs-visu-skins/ionic`) is pulled in and
 * normalised to the uniform {@link Skin} shape the host renders against.
 *
 * Each skin exports its renderer maps (`tiles`/`details`) and a `manifest`
 * (CONTRACT-v1.md §7). The npm package surfaces the manifest as a JSON
 * sub-export (`@obs-visu-skins/ionic/manifest.json`) and the maps from its
 * root; we re-assemble them here so the rest of the host depends only on the
 * contract-typed {@link Skin} record, never on a package layout.
 *
 * A page carries a `skin` key (the author's decision — there is no runtime skin
 * switch). {@link resolveSkin} turns that key into the {@link Skin} or throws a
 * visible error: an unknown skin key is a hard failure, never a silent default
 * (the same "never a silent lamp" discipline the renderer dispatch follows).
 */

import type { SkinManifest, Renderer, CoreWidgetType, PageRenderer } from '@obs/visu-contract';

import { tiles as ionicTiles, details as ionicDetails, presets as ionicPresets } from '@obs-visu-skins/ionic';
import ionicManifest from '@obs-visu-skins/ionic/manifest.json';

import { tiles as terminalTiles, details as terminalDetails } from '@obs-visu-skins/terminal';
import terminalManifest from '@obs-visu-skins/terminal/manifest.json';

import {
  tiles as edomiTiles,
  details as edomiDetails,
  presets as edomiPresets,
  page as edomiPage,
} from '@obs-visu-skins/edomi';
import edomiManifest from '@obs-visu-skins/edomi/manifest.json';

/** A partial renderer map over the core widget types (mirror of the skin export). */
export type RendererMap = Partial<Record<CoreWidgetType, Renderer>>;

/** The uniform shape the host renders against — renderer maps + the manifest. */
export interface Skin {
  /**
   * The class the skin's stylesheet is scoped to — its CSS namespace. Every skin
   * scopes its sheet to one root (`.visu-root` for ionic, `.t-root` for the
   * terminal list skin), so the host must put that class on the element it
   * renders the skin into; without it the page renders as unstyled markup while
   * its jsdom tests stay green (structure is not pixels). The same seam the
   * skins repo's fixture wall uses (`root: (theme) => ({ class, attrs })`).
   */
  readonly rootClass: string;
  /** Tile renderers per core type — addressed by `tiles[device.type]` (golden rule 2). */
  readonly tiles: RendererMap;
  /** Optional detail-surface renderers per core type. */
  readonly details: RendererMap;
  /**
   * Optional position-preset renderers per positionsbasiertem Kern-Typ (v1.6).
   * Addressed by `presets[device.type]` for the long-press quick menu; a skin
   * that ships none leaves this empty (the host simply shows no popover).
   */
  readonly presets: RendererMap;
  /** The skin manifest (layout · widgets · unsupported · tweaks · themes). */
  readonly manifest: SkinManifest;
  /**
   * Optional whole-page renderer (v1.10, layering W4). A skin that owns its own
   * navigation + composed layers + popups exports one; the host delegates the page
   * body to it (external floor only) and passes the {@link PageHost}. A skin without
   * one (ionic/terminal) is unaffected — the host lays out its room/role floor.
   */
  readonly page?: PageRenderer;
}

/**
 * The skin registry. Author-time set of skins the app ships with; a page picks
 * one by key. Adding a skin means importing it here and adding one entry — the
 * host code stays skin-agnostic.
 */
export const skins = {
  ionic: {
    tiles: ionicTiles,
    details: ionicDetails,
    presets: ionicPresets,
    manifest: ionicManifest as SkinManifest,
    // ionic.css scopes the whole Glass look to `.visu-root`.
    rootClass: 'visu-root',
  },
  terminal: {
    tiles: terminalTiles,
    details: terminalDetails,
    // The terminal skin ships no position-preset renderers (no long-press menu).
    presets: {},
    manifest: terminalManifest as SkinManifest,
    // terminal.css scopes the console/list look to `.t-root[data-theme]`.
    rootClass: 't-root',
  },
  edomi: {
    // Edomi POC (v1.10, layering W4): owns the whole page via `page` (nav + pixel
    // layer canvas + popups); re-uses the ionic content tiles. No presets popover.
    tiles: edomiTiles,
    details: edomiDetails,
    // Preserve the ionic preset surface for blind/jalousie long-press (the edomi
    // manifest declares the matching gestures).
    presets: edomiPresets,
    manifest: edomiManifest as SkinManifest,
    page: edomiPage,
    // edomi re-uses the ionic content tiles, so it keeps their CSS namespace.
    rootClass: 'visu-root',
  },
} as const satisfies Record<string, Skin>;

/** The valid skin keys (author's choice on a page). */
export type SkinKey = keyof typeof skins;

/**
 * Resolve a skin key to its {@link Skin}. An unknown key is a hard, visible
 * failure — there is no silent fallback skin (a page that names a skin the app
 * does not ship is an authoring bug we surface, not paper over).
 */
export function resolveSkin(key: string): Skin {
  const skin = (skins as Record<string, Skin>)[key];
  if (!skin) {
    const known = Object.keys(skins).join(', ');
    throw new Error(
      `skin-host: unknown skin "${key}" — no such skin in the registry (known: ${known}).`,
    );
  }
  return skin;
}
