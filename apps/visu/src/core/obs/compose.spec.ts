import { describe, it, expect } from 'vitest';

import { composeLayers, buildNavTree } from './compose';
import type { ObsVisuNode } from './mapping';

/**
 * core/obs/compose — page-layer composition + nav tree (Visu-Layering W3b).
 *
 * Layering is a skin capability: the host turns the `parent_id` tree into a
 * skin-consumable layer stack (root/ancestor layers + the page's own) and a nav
 * tree. These tests pin the deterministic order, the origin derivation, the
 * additive position passthrough, and the no-throw guards.
 */

const toggle = (id: string, dp: string, box?: { x: number; y: number; w: number; h: number }) => ({
  id,
  name: id,
  type: 'Toggle',
  datapoint_id: dp,
  status_datapoint_id: null,
  config: {},
  ...(box ?? {}),
});

/** Hausnav (root, widget) → Etage (mid, widget) → Raum (leaf, widget with box). */
const TREE: ObsVisuNode[] = [
  {
    id: 'nav',
    parent_id: null,
    name: 'Hauptnav',
    type: 'PAGE',
    access: 'public',
    page_config: { widgets: [toggle('w-nav', 'dp-nav')] },
  },
  {
    id: 'eg',
    parent_id: 'nav',
    name: 'Erdgeschoss',
    type: 'PAGE',
    access: 'public',
    page_config: { widgets: [toggle('w-eg', 'dp-eg')] },
  },
  {
    id: 'bad',
    parent_id: 'eg',
    name: 'Bad',
    type: 'PAGE',
    access: 'public',
    page_config: { widgets: [toggle('w-bad', 'dp-bad', { x: 1, y: 2, w: 3, h: 4 })] },
  },
];

describe('composeLayers — ordered layer stack from the parent_id chain', () => {
  it('stacks ancestor pages root-first with the target page as the own layer', () => {
    const layers = composeLayers(TREE, 'bad');
    expect(layers.map((l) => l.id)).toEqual(['nav', 'eg', 'bad']);
    expect(layers.map((l) => l.order)).toEqual([0, 1, 2]);
    expect(layers.map((l) => l.origin)).toEqual(['include', 'include', 'own']);
  });

  it('references devices by id (no data fork) and carries the author position', () => {
    const layers = composeLayers(TREE, 'bad');
    expect(layers[0].items.map((i) => i.id)).toEqual(['w-nav']);
    const own = layers[2];
    expect(own.items[0].id).toBe('w-bad');
    expect(own.items[0].position).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    // an item without an author box stays position-less
    expect(layers[0].items[0].position).toBeUndefined();
  });

  it('drops nodes with no mappable widgets (bare LOCATION / empty page)', () => {
    const withLoc: ObsVisuNode[] = [
      { id: 'loc', parent_id: null, name: 'EG', type: 'LOCATION', access: null, page_config: null },
      { id: 'p', parent_id: 'loc', name: 'Raum', type: 'PAGE', access: 'public', page_config: { widgets: [toggle('w', 'dp')] } },
    ];
    const layers = composeLayers(withLoc, 'p');
    expect(layers.map((l) => l.id)).toEqual(['p']);
    expect(layers[0].origin).toBe('own');
  });

  it('returns an empty stack for an unknown page id (never throws)', () => {
    expect(composeLayers(TREE, 'nope')).toEqual([]);
  });

  it('does not loop on a cyclic parent chain', () => {
    const cyclic: ObsVisuNode[] = [
      { id: 'a', parent_id: 'b', name: 'A', type: 'PAGE', access: 'public', page_config: { widgets: [toggle('wa', 'da')] } },
      { id: 'b', parent_id: 'a', name: 'B', type: 'PAGE', access: 'public', page_config: { widgets: [toggle('wb', 'db')] } },
    ];
    const layers = composeLayers(cyclic, 'a');
    // both visited once, no infinite loop
    expect(layers.map((l) => l.id).sort()).toEqual(['a', 'b']);
  });
});

describe('buildNavTree — the visible PAGE/LOCATION hierarchy', () => {
  it('nests children under their parent in tree order', () => {
    const nav = buildNavTree(TREE);
    expect(nav.map((n) => n.id)).toEqual(['nav']);
    expect(nav[0].children.map((n) => n.id)).toEqual(['eg']);
    expect(nav[0].children[0].children.map((n) => n.id)).toEqual(['bad']);
    expect(nav[0].children[0].children[0].access).toBe('public');
  });

  it('treats a node whose parent was filtered out as a root', () => {
    // "eg" and "bad" present but their ancestor "nav" concealed by the server.
    const filtered = TREE.filter((n) => n.id !== 'nav');
    const nav = buildNavTree(filtered);
    expect(nav.map((n) => n.id)).toEqual(['eg']); // eg is now an effective root
    expect(nav[0].children.map((n) => n.id)).toEqual(['bad']);
  });
});
