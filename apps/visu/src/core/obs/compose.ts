/**
 * core/obs/compose — page-layer composition + navigation tree (Visu-Layering W3b).
 *
 * Layering is a SKIN capability (CONTRIBUTING-visu-layering.md): the host turns
 * the backend visu tree into skin-consumable DATA — an ordered layer stack per
 * page and a navigation tree — and the skin decides HOW to render it (a pixel
 * skin overlays layers absolutely; the responsive ionic skin ignores this data
 * and keeps its burger-nav + room-grouped floor).
 *
 * Pure functions over the (already server-filtered) tree. No I/O, no state.
 *
 * Golden rules honoured: no data fork (layers reference the same devices by id);
 * order is deterministic (root layer first, widget order preserved); additive
 * (a skin that ignores layers/nav is unaffected).
 *
 * NOTE (W3b approximation): the backend does not yet carry explicit `include` /
 * `globalInclude` / `popup` page types (that model + its authoring land with the
 * V2 editor, M5). Until then the layer stack is derived from the `parent_id`
 * ancestor chain: the target page is the `own` layer, its ancestor PAGEs are
 * `include` layers beneath it. When the backend gains the explicit flags, only
 * the origin/order derivation here changes — the skin-facing shape is stable.
 */

import type { LayerItem, PageLayer } from '@obs/visu-contract';
import type { DataSource } from '../datasource';
import { mapWidget, type ObsPageConfig, type ObsVisuNode, type PageAccess } from './mapping';

/**
 * A source that exposes the composed layering DATA (layering W3c): the navigation
 * tree and the per-page layer stack. Only a tree-backed source (the ObsDataSource)
 * has these; the mock has none, so a skin that renders nav/layers simply gets an
 * empty tree there and falls back to its responsive floor.
 */
export interface LayeringCapableDataSource extends DataSource {
  /** The visible PAGE/LOCATION navigation hierarchy. */
  navTree(): NavNode[];
  /** The ordered layer stack for a page (ancestors + own), root-first. */
  layersFor(pageId: string): PageLayer[];
}

/** Does the source expose the layering DATA (nav tree + per-page layer stack)? */
export function supportsLayering(ds: DataSource): ds is LayeringCapableDataSource {
  const cand = ds as Partial<LayeringCapableDataSource>;
  return typeof cand.navTree === 'function' && typeof cand.layersFor === 'function';
}

/** One node of the navigation tree the host hands a skin (W3c seed). */
export interface NavNode {
  readonly id: string;
  readonly name: string;
  readonly type: 'LOCATION' | 'PAGE';
  /** The node's own access mode (null = inherit); the skin may badge gated pages. */
  readonly access: PageAccess | null;
  readonly children: readonly NavNode[];
}

/** Map a page's widgets to layer items (id + optional author position). Pure. */
function itemsOf(
  config: ObsPageConfig | null,
  room: string,
  values: ReadonlyMap<string, unknown>,
): LayerItem[] {
  const items: LayerItem[] = [];
  for (const w of config?.widgets ?? []) {
    const mapped = mapWidget(w, room, values);
    if (!mapped) continue; // an undeclared type contributes nothing to the layer
    const id = mapped.device.id;
    if (!id) continue;
    items.push(mapped.position ? { id, position: mapped.position } : { id });
  }
  return items;
}

/**
 * Compose the ordered layer stack for a page from the tree's `parent_id` chain.
 *
 * The result is root-first: the outermost ancestor PAGE is `order: 0` (an
 * `include` layer), the target page itself is the last, `own` layer. Nodes with
 * no mappable widgets (a bare LOCATION, an empty page) drop out. An unknown page
 * id, or a cyclic parent chain, yields an empty stack (never throws).
 */
export function composeLayers(
  nodes: readonly ObsVisuNode[],
  pageId: string,
  values: ReadonlyMap<string, unknown> = new Map(),
): PageLayer[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Walk up to the root, guarding against a missing node or a cycle.
  const chain: ObsVisuNode[] = [];
  const seen = new Set<string>();
  let cur: string | null = pageId;
  while (cur !== null && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    chain.unshift(byId.get(cur)!); // prepend → root ends up first
    cur = byId.get(cur)!.parent_id;
  }

  const layers: PageLayer[] = [];
  let order = 0;
  for (const node of chain) {
    if (node.type !== 'PAGE') continue;
    const items = itemsOf(node.page_config, node.name, values);
    if (items.length === 0) continue;
    layers.push({
      id: node.id,
      origin: node.id === pageId ? 'own' : 'include',
      order: order++,
      items,
    });
  }
  return layers;
}

/**
 * Build the navigation tree (the visible PAGE/LOCATION hierarchy) from the flat
 * `/visu/tree`. Root nodes (`parent_id === null`) first; children in tree order.
 * The tree is already principal-filtered by the server, so concealed nodes are
 * simply absent. A parent that is not present (filtered out) is treated as a root.
 */
export function buildNavTree(nodes: readonly ObsVisuNode[]): NavNode[] {
  const present = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | null, ObsVisuNode[]>();
  for (const n of nodes) {
    // A parent filtered out of the tree makes this node an effective root.
    const key = n.parent_id !== null && present.has(n.parent_id) ? n.parent_id : null;
    const arr = byParent.get(key);
    if (arr) arr.push(n);
    else byParent.set(key, [n]);
  }
  const build = (parentId: string | null): NavNode[] =>
    (byParent.get(parentId) ?? []).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      access: n.access ?? null,
      children: build(n.id),
    }));
  return build(null);
}
