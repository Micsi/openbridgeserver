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

import type { NavNode, PageLink } from '@obs/visu-contract';

/** The host state a link resolution reads (wired in by the host, never by a skin). */
export interface LinkContext {
  /** The host's navigation tree; empty for a source without one (the mock). */
  readonly navTree: readonly NavNode[];
  /** Whether a user session (JWT login) is active — gates `user`-level pages. */
  readonly isLoggedIn: boolean;
  /** Whether a valid PIN session is held for the node that DEFINES the access. */
  hasSessionToken(nodeId: string): boolean;
}

/** Navigate: the target resolved to a reachable page. */
export interface LinkNavigate {
  readonly kind: 'navigate';
  readonly pageId: string;
}

/** Gated: the target needs a PIN first — the host surfaces the gate, not the page. */
export interface LinkGate {
  readonly kind: 'gate';
  /** The gated page (the `authenticatePage` target / the AccessGate entry). */
  readonly pageId: string;
  /** The node the PIN session is scoped to (the access-defining ancestor). */
  readonly accessNodeId: string;
}

/** No such node in a non-empty tree — an authoring gap, resolved to a no-op. */
export interface LinkUnknown {
  readonly kind: 'unknown';
  readonly targetNodeId: string;
}

/** What the host should do with a followed link. */
export type LinkOutcome = LinkNavigate | LinkGate | LinkUnknown;

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
    return { kind: 'gate', pageId: target, accessNodeId: access.definingId };
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
