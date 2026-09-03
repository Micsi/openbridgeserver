/**
 * core/links — page links as a HOST action (Contract v1.11, Upstream #1194).
 *
 * Upstream #1194: „Visuelemente sollten Verlinkung zu anderen Visuseiten
 * ermöglichen" — an element with no click function of its own (the author's
 * example: a small camera tile) should jump to another visu page, „wie im
 * Link-Widget".
 *
 * The reference is the V1 link widget (`frontend/src/widgets/Link/Widget.vue`).
 * Its navigation semantics are reproduced here 1:1, but as HOST behaviour over
 * the host's own navigation tree instead of widget code:
 *
 *   1. **`target_node_id` → {@link PageLink.targetNodeId}** — the link names a
 *      node of the visu tree (PAGE or LOCATION), never a route or a URL.
 *   2. **PIN gate.** The effective access is resolved along the `parent_id`
 *      chain ({@link resolveAccessNode}, the mirror of the V1 helper of the same
 *      name) and the PIN session hangs on the **defining** node — the first node
 *      on that chain that sets `access` itself. A jump onto a `protected` node
 *      without a valid session token yields {@link LinkGate}, never a blind jump
 *      onto the target page (V1: `router.push({ name: 'viewer' })` → PIN path).
 *   3. **LOCATION descent.** A LOCATION target resolves to its first direct
 *      child PAGE that would also be visible in the location overview (`user`
 *      pages only while logged in), exactly like the V1 widget.
 *   4. **Active along the ancestor chain** — the target counts as active when it
 *      IS the current page or an ancestor of it ({@link isLinkActive}).
 *
 * Pure: no Vue, no store, no I/O. The host wires its live state in through
 * {@link LinkContext}; the skin never sees any of this (golden rule 4 — the skin
 * owns no state, the host maps the gesture onto a canonical action).
 *
 * Empty tree = flat page space: the mock/static floor has no visu tree, so a
 * link there addresses a page id directly and simply navigates. A NON-empty tree
 * that does not contain the target is an authoring gap and yields
 * {@link LinkUnknown} — a no-op, never a jump to the wrong page.
 */

import type {
  LinkGate,
  LinkNavigate,
  LinkOutcome,
  LinkUnknown,
  NavNode,
  PageLink,
  SkinGestures,
} from '@obs/visu-contract';

/**
 * The three-way outcome is CONTRACT surface since v1.12 (#146): a page-owning
 * skin reads it off `PageHost.resolveLink`/`followLink`, so its shape may not be
 * an app-private type. It is re-exported here so every existing import site
 * (`./links`) keeps working and there stays exactly ONE declaration of the shape.
 */
export type { LinkNavigate, LinkGate, LinkUnknown, LinkOutcome };

/** The host state a link resolution reads (wired in by the host, never by a skin). */
export interface LinkContext {
  /** The host's navigation tree; empty for a source without one (the mock). */
  readonly navTree: readonly NavNode[];
  /** Whether a user session (JWT login) is active — gates `user`-level pages. */
  readonly isLoggedIn: boolean;
  /** Whether a valid PIN session is held for the node that DEFINES the access. */
  hasSessionToken(nodeId: string): boolean;
}

/** Flatten a nav tree into `id → node` plus `id → parent id`. */
function index(nodes: readonly NavNode[]): {
  byId: Map<string, NavNode>;
  parentOf: Map<string, string>;
} {
  const byId = new Map<string, NavNode>();
  const parentOf = new Map<string, string>();
  const walk = (list: readonly NavNode[], parent: string | null): void => {
    for (const n of list) {
      byId.set(n.id, n);
      if (parent !== null) parentOf.set(n.id, parent);
      walk(n.children, n.id);
    }
  };
  walk(nodes, null);
  return { byId, parentOf };
}

/**
 * The node's effective access plus the node that DEFINES it — the mirror of the
 * V1 `resolveAccessNode`: walk up the parent chain to the first node whose own
 * `access` is set; that node holds the PIN. Nothing set anywhere ⇒ `public`,
 * defined by the node itself (V1 returns `definingId: node.id` there too).
 * Cycle-safe.
 */
export function resolveAccessNode(
  nodeId: string,
  byId: ReadonlyMap<string, NavNode>,
  parentOf: ReadonlyMap<string, string>,
): { access: string; definingId: string } {
  const seen = new Set<string>();
  let cur: string | undefined = nodeId;
  while (cur !== undefined && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const node = byId.get(cur)!;
    if (node.access !== null && node.access !== undefined) {
      return { access: node.access, definingId: node.id };
    }
    cur = parentOf.get(cur);
  }
  return { access: 'public', definingId: nodeId };
}

/**
 * The first PAGE at or under `node` whose access is defined by `definingId` —
 * i.e. the first page this one PIN session unlocks. Depth-first in source order,
 * so it is the page a reader would reach first. Cycle-safe; null when the branch
 * holds no such page (an area with nothing under it that this PIN covers).
 */
function firstPageUnder(
  node: NavNode,
  byId: ReadonlyMap<string, NavNode>,
  parentOf: ReadonlyMap<string, string>,
  definingId: string,
): string | null {
  const seen = new Set<string>();
  const walk = (n: NavNode): string | null => {
    if (seen.has(n.id)) return null;
    seen.add(n.id);
    if (n.type === 'PAGE' && resolveAccessNode(n.id, byId, parentOf).definingId === definingId) {
      return n.id;
    }
    for (const child of n.children) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  for (const child of node.children) {
    const hit = walk(child);
    if (hit) return hit;
  }
  return null;
}

/**
 * The tap target a page link is bound to (#1194) — a DECLARED restriction, not a
 * forgotten case (golden rule 3).
 *
 * A link fires on the `action` tap target only, and there only when the tapped
 * element marked no action of its own. The reason is golden rule 4: the skin
 * declares the interaction model, the host applies it. A skin that maps `tap` to
 * `openDetail` or `presets` has given EVERY tile a click function of its own —
 * which is exactly the case #1194 excludes ("Elemente ohne eigene
 * Klick-Funktion"). Firing the link there would override the skin's declaration
 * and make the same authored page behave differently per skin, in a way the skin
 * never asked for.
 *
 * So the host does not silently swallow the link: {@link linksDeliverable} lets
 * the host WITHHOLD the navigation affordance (no pointer cursor, not focusable)
 * and mark the cell `data-link-unsupported`, so the gap is inspectable in the DOM
 * and testable — a declared fact, never a dead-looking affordance.
 */
export const LINK_TAP_TARGET = 'action';

/**
 * Can a link on a placed element actually fire under this skin's gesture model?
 * False when the skin binds `tap` to something other than {@link LINK_TAP_TARGET}.
 */
export function linksDeliverable(gestures: SkinGestures | undefined): boolean {
  // An undeclared `tap` keeps the host default (`action`) — links work.
  const tap = gestures?.tap;
  return tap === undefined || tap === LINK_TAP_TARGET;
}

/**
 * Resolve a link into the host action to take (V1 `Link/Widget.vue → navigate`).
 *
 * Order matters and follows V1: the ACCESS of the target is decided before the
 * LOCATION descent, so a protected area sends you to the PIN path rather than
 * quietly opening one of its pages.
 */
export function resolveLink(link: PageLink, ctx: LinkContext): LinkOutcome {
  const target = link.targetNodeId;
  if (!target) return { kind: 'unknown', targetNodeId: target };

  // No tree (mock/static floor): a link addresses a page id directly.
  if (ctx.navTree.length === 0) return { kind: 'navigate', pageId: target };

  const { byId, parentOf } = index(ctx.navTree);
  const node = byId.get(target);
  // A non-empty tree without this node is an authoring gap — never a blind jump.
  if (!node) return { kind: 'unknown', targetNodeId: target };

  // PIN gate FIRST (V1: protected + no session token ⇒ viewer/PIN path).
  const access = resolveAccessNode(target, byId, parentOf);
  if (access.access === 'protected' && !ctx.hasSessionToken(access.definingId)) {
    // The gate must name a PAGE: the host's gate list (`pageGates`) only ever
    // holds PAGE nodes, so reporting a LOCATION here would leave the click with
    // NO visible gate at all. Descend to the first page under this LOCATION that
    // shares the same defining node — the page the one PIN unlocks.
    const gatedPage = node.type === 'PAGE' ? target : firstPageUnder(node, byId, parentOf, access.definingId);
    return { kind: 'gate', pageId: gatedPage ?? target, accessNodeId: access.definingId };
  }

  // A LOCATION is not a page: descend to its first direct child PAGE that would
  // also be visible in the location overview (V1 `isVisibleInLocationOverview`).
  if (node.type === 'LOCATION') {
    const firstPage = node.children.find((child) => {
      if (child.type !== 'PAGE') return false;
      const childAccess = resolveAccessNode(child.id, byId, parentOf);
      return childAccess.access === 'user' ? ctx.isLoggedIn : true;
    });
    if (firstPage) return { kind: 'navigate', pageId: firstPage.id };
  }

  return { kind: 'navigate', pageId: target };
}

/**
 * Is this link's target the current page OR an ancestor of it? (V1 `isActive`.)
 * With no current page nothing is active; with an empty tree the chain is just
 * the page itself.
 */
export function isLinkActive(
  link: PageLink,
  currentPageId: string | null,
  navTree: readonly NavNode[],
): boolean {
  if (!link.targetNodeId || currentPageId === null) return false;
  if (currentPageId === link.targetNodeId) return true;
  const { parentOf } = index(navTree);
  const seen = new Set<string>();
  let cur: string | undefined = parentOf.get(currentPageId);
  while (cur !== undefined && !seen.has(cur)) {
    if (cur === link.targetNodeId) return true;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}
