import { describe, it, expect } from 'vitest';
import type { NavNode } from '@obs/visu-contract';

import { resolveLink, isLinkActive, resolveAccessNode } from './links';

/**
 * core/links — page links as a HOST action (Contract v1.11, Upstream #1194).
 *
 * The measuring stick is the V1 link widget (`frontend/src/widgets/Link/Widget.vue`):
 * `target_node_id` as the target, the PIN gate along the `parent_id` chain with the
 * token on the DEFINING node, the LOCATION descent to the first visible page, and
 * the active state along the ancestor chain. These pin exactly that semantics.
 */

/**
 * A small tree mirroring a real visu:
 *
 *   haus (LOCATION, access null)
 *     ├── flur          (PAGE, null)            → effectively public
 *     └── keller        (LOCATION, protected)   ← the PIN is defined HERE
 *           ├── technik (PAGE, null)            → inherits protected
 *           └── archiv  (PAGE, user)            → login-only
 *   garage (LOCATION, null)
 *     ├── garage-user   (PAGE, user)
 *     └── garage-pub    (PAGE, null)
 */
const TREE: readonly NavNode[] = [
  {
    id: 'haus',
    name: 'Haus',
    type: 'LOCATION',
    access: null,
    children: [
      { id: 'flur', name: 'Flur', type: 'PAGE', access: null, children: [] },
      {
        id: 'keller',
        name: 'Keller',
        type: 'LOCATION',
        access: 'protected',
        children: [
          { id: 'technik', name: 'Technik', type: 'PAGE', access: null, children: [] },
          { id: 'archiv', name: 'Archiv', type: 'PAGE', access: 'user', children: [] },
        ],
      },
    ],
  },
  {
    id: 'garage',
    name: 'Garage',
    type: 'LOCATION',
    access: null,
    children: [
      { id: 'garage-user', name: 'Nur intern', type: 'PAGE', access: 'user', children: [] },
      { id: 'garage-pub', name: 'Offen', type: 'PAGE', access: null, children: [] },
    ],
  },
];

/** A context with no PIN sessions and a guest user (the default visitor). */
const guest = (overrides: Partial<Parameters<typeof resolveLink>[1]> = {}) => ({
  navTree: TREE,
  isLoggedIn: false,
  hasSessionToken: () => false,
  ...overrides,
});

describe('resolveAccessNode — access along the parent chain, PIN on the defining node', () => {
  const byId = new Map<string, NavNode>();
  const parentOf = new Map<string, string>();
  const walk = (list: readonly NavNode[], parent: string | null): void => {
    for (const n of list) {
      byId.set(n.id, n);
      if (parent) parentOf.set(n.id, parent);
      walk(n.children, n.id);
    }
  };
  walk(TREE, null);

  it('inherits `protected` downward and names the DEFINING ancestor', () => {
    // technik sets no access of its own — it inherits the keller's, and the PIN
    // session hangs on the keller (V1: `definingId`).
    expect(resolveAccessNode('technik', byId, parentOf)).toEqual({
      access: 'protected',
      definingId: 'keller',
    });
  });

  it('a node with its OWN access defines it itself', () => {
    expect(resolveAccessNode('archiv', byId, parentOf)).toEqual({
      access: 'user',
      definingId: 'archiv',
    });
    expect(resolveAccessNode('keller', byId, parentOf)).toEqual({
      access: 'protected',
      definingId: 'keller',
    });
  });

  it('nothing set on the whole chain ⇒ public (V1 default)', () => {
    expect(resolveAccessNode('flur', byId, parentOf)).toEqual({
      access: 'public',
      definingId: 'flur',
    });
  });
});

describe('resolveLink — the V1 navigate() semantics as a host action', () => {
  it('navigates to a plain PAGE target', () => {
    expect(resolveLink({ targetNodeId: 'flur' }, guest())).toEqual({
      kind: 'navigate',
      pageId: 'flur',
    });
  });

  it('GATES a protected target instead of jumping onto the page', () => {
    // The measuring stick: a jump onto a `protected` node without a valid session
    // token must land on the PIN path, never blindly on the target page.
    expect(resolveLink({ targetNodeId: 'technik' }, guest())).toEqual({
      kind: 'gate',
      pageId: 'technik',
      accessNodeId: 'keller',
    });
  });

  it('gates a protected LOCATION too — before descending into it', () => {
    expect(resolveLink({ targetNodeId: 'keller' }, guest())).toEqual({
      kind: 'gate',
      pageId: 'keller',
      accessNodeId: 'keller',
    });
  });

  it('passes the gate once a session token is held for the DEFINING node', () => {
    const withPin = guest({ hasSessionToken: (id: string) => id === 'keller' });
    // The page inherits the access, so the keller's one PIN unlocks it …
    expect(resolveLink({ targetNodeId: 'technik' }, withPin)).toEqual({
      kind: 'navigate',
      pageId: 'technik',
    });
    // … and the LOCATION then descends to its first visible child page.
    expect(resolveLink({ targetNodeId: 'keller' }, withPin)).toEqual({
      kind: 'navigate',
      pageId: 'technik',
    });
  });

  it('a token on the WRONG node does not open the gate', () => {
    const wrongPin = guest({ hasSessionToken: (id: string) => id === 'technik' });
    expect(resolveLink({ targetNodeId: 'technik' }, wrongPin).kind).toBe('gate');
  });

  it('descends a LOCATION to its first child page visible in the overview', () => {
    // garage-user is `user`-level: invisible to a guest, so the guest lands on
    // the next visible page (V1 `isVisibleInLocationOverview`).
    expect(resolveLink({ targetNodeId: 'garage' }, guest())).toEqual({
      kind: 'navigate',
      pageId: 'garage-pub',
    });
    // Logged in, the first child is visible and wins (source order is the floor).
    expect(resolveLink({ targetNodeId: 'garage' }, guest({ isLoggedIn: true }))).toEqual({
      kind: 'navigate',
      pageId: 'garage-user',
    });
  });

  it('falls back to the LOCATION itself when it has no visible child page', () => {
    const tree: NavNode[] = [
      { id: 'leer', name: 'Leer', type: 'LOCATION', access: null, children: [] },
    ];
    expect(resolveLink({ targetNodeId: 'leer' }, guest({ navTree: tree }))).toEqual({
      kind: 'navigate',
      pageId: 'leer',
    });
  });

  it('an unknown target in a real tree is a no-op, never a jump to the wrong page', () => {
    expect(resolveLink({ targetNodeId: 'gibtsnicht' }, guest())).toEqual({
      kind: 'unknown',
      targetNodeId: 'gibtsnicht',
    });
    expect(resolveLink({ targetNodeId: '' }, guest())).toEqual({
      kind: 'unknown',
      targetNodeId: '',
    });
  });

  it('with NO tree (the static/mock floor) a link addresses a page id directly', () => {
    expect(resolveLink({ targetNodeId: 'camera-full' }, guest({ navTree: [] }))).toEqual({
      kind: 'navigate',
      pageId: 'camera-full',
    });
  });
});

describe('isLinkActive — active along the ancestor chain (V1 isActive)', () => {
  it('is active when the target IS the current page', () => {
    expect(isLinkActive({ targetNodeId: 'technik' }, 'technik', TREE)).toBe(true);
  });

  it('is active when the target is an ANCESTOR of the current page', () => {
    expect(isLinkActive({ targetNodeId: 'keller' }, 'technik', TREE)).toBe(true);
    expect(isLinkActive({ targetNodeId: 'haus' }, 'technik', TREE)).toBe(true);
  });

  it('is not active for a sibling or an unrelated branch', () => {
    expect(isLinkActive({ targetNodeId: 'archiv' }, 'technik', TREE)).toBe(false);
    expect(isLinkActive({ targetNodeId: 'garage' }, 'technik', TREE)).toBe(false);
  });

  it('is not active without a current page', () => {
    expect(isLinkActive({ targetNodeId: 'technik' }, null, TREE)).toBe(false);
  });

  it('with no tree the chain is just the page itself (static floor)', () => {
    expect(isLinkActive({ targetNodeId: 'camera-full' }, 'camera-full', [])).toBe(true);
    expect(isLinkActive({ targetNodeId: 'camera-full' }, 'demo-media', [])).toBe(false);
  });
});
