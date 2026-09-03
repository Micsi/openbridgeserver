import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { h, type VNode } from 'vue';
import type { Device, NavNode, PageHost } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — page links as HOST services on the PageHost seam
 * (contract v1.12, Micsi/openbridgeserver#146).
 *
 * v1.11 handed a page-owning skin `navigate(pageId)` and nothing else, while
 * declaring that a `PageLink.targetNodeId` may be a LOCATION and that the
 * LOCATION descent, the PIN gate and the active state are HOST behaviour. The
 * only way to honour a link was therefore to descend the navTree in the skin —
 * what golden rule 4 forbids. These specs pin the seam that removes the
 * contradiction: everything the skin needs is a call, and every call the host
 * answers moves (or deliberately does not move) host state.
 *
 * The stub skin honours `link`, so it also pins the second half: the host stops
 * stamping its OWN stretched link on the cell, because the skin draws the jump.
 */
let captured: PageHost | null = null;
let honors: string[] = ['position', 'layers', 'link'];

vi.mock('./skins', () => ({
  resolveSkin: () => ({
    tiles: { switch: () => h('div', { class: 'stub-tile' }) },
    details: {},
    manifest: {
      name: 'link-stub',
      unsupported: [],
      layout: { model: 'grid', honors },
    },
    page: (host: PageHost) => {
      captured = host;
      return h('div', { class: 'skin-page-owned' }, [host.renderTile('sw1') as VNode]);
    },
  }),
}));

import SkinHost from './SkinHost';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';

const SW: Device = { id: 'sw1', type: 'switch', room: 'R', label: 'S', accent: 'slate', on: false } as Device;

/**
 * Haus (LOCATION, public)
 *  ├─ wohnen  (PAGE, public)
 *  └─ keller  (LOCATION, protected)
 *       └─ technik (PAGE, inherits protected from keller)
 */
const TREE: NavNode[] = [
  {
    id: 'haus',
    name: 'Haus',
    type: 'LOCATION',
    access: 'public',
    children: [
      { id: 'wohnen', name: 'Wohnen', type: 'PAGE', access: null, children: [] },
      {
        id: 'keller',
        name: 'Keller',
        type: 'LOCATION',
        access: 'protected',
        children: [{ id: 'technik', name: 'Technik', type: 'PAGE', access: null, children: [] }],
      },
    ],
  },
];

async function mountWithTree(): Promise<ReturnType<typeof mount>> {
  const store = useDeviceStore();
  await store.init(new MockDataSource([SW]));
  store.navTree = TREE;
  return mount(SkinHost, { props: { skin: 'link-stub', groups: [], theme: 'light' } });
}

describe('SkinHost — PageHost resolves page links FOR the skin (v1.12, #146)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    captured = null;
    honors = ['position', 'layers', 'link'];
  });

  it('offers the resolver on the seam — the skin needs no navTree descent', async () => {
    await mountWithTree();
    expect(typeof captured!.resolveLink).toBe('function');
    expect(typeof captured!.followLink).toBe('function');
    expect(typeof captured!.isLinkActive).toBe('function');
    expect(typeof captured!.linkLabel).toBe('function');
  });

  it('resolveLink descends a LOCATION target to its first visible page, without acting', async () => {
    await mountWithTree();
    const store = useDeviceStore();

    expect(captured!.resolveLink({ targetNodeId: 'haus' })).toEqual({
      kind: 'navigate',
      pageId: 'wohnen',
    });
    // Read-only: asking what a click WOULD do moves nothing.
    expect(store.currentPageId).toBeNull();
  });

  it('followLink performs the canonical action — the host moves the page', async () => {
    await mountWithTree();
    const store = useDeviceStore();

    expect(captured!.followLink({ targetNodeId: 'wohnen' })).toEqual({
      kind: 'navigate',
      pageId: 'wohnen',
    });
    expect(store.currentPageId).toBe('wohnen');
  });

  it('a protected target GATES: the PIN path, never the page', async () => {
    await mountWithTree();
    const store = useDeviceStore();

    // The gate names the page, and the node the one PIN session is scoped to.
    expect(captured!.resolveLink({ targetNodeId: 'keller' })).toEqual({
      kind: 'gate',
      pageId: 'technik',
      accessNodeId: 'keller',
    });
    expect(captured!.followLink({ targetNodeId: 'technik' })).toEqual({
      kind: 'gate',
      pageId: 'technik',
      accessNodeId: 'keller',
    });
    expect(store.currentPageId).toBeNull();
    expect(store.pendingGate).toBe('technik');
  });

  it('an unknown target is a declared no-op, never a jump to the wrong page', async () => {
    await mountWithTree();
    const store = useDeviceStore();

    expect(captured!.followLink({ targetNodeId: 'gibtsnicht' })).toEqual({
      kind: 'unknown',
      targetNodeId: 'gibtsnicht',
    });
    expect(store.currentPageId).toBeNull();
  });

  it('is active on the page the host SHOWS, before anything has navigated', async () => {
    await mountWithTree();
    // Nothing navigated yet: the host hands the skin the tree's first page as
    // `currentPageId`, so a link onto that page must read as active — otherwise
    // the indicator only appears after the first jump (found in the browser).
    expect(captured!.currentPageId).toBe('wohnen');
    expect(captured!.isLinkActive({ targetNodeId: 'wohnen' })).toBe(true);
  });

  it('isLinkActive answers along the ancestor chain (the skin never walks it)', async () => {
    await mountWithTree();
    captured!.followLink({ targetNodeId: 'wohnen' });

    expect(captured!.isLinkActive({ targetNodeId: 'wohnen' })).toBe(true);
    // `haus` is an ancestor of the current page → active, exactly like V1.
    expect(captured!.isLinkActive({ targetNodeId: 'haus' })).toBe(true);
    expect(captured!.isLinkActive({ targetNodeId: 'keller' })).toBe(false);
  });

  it('linkLabel names the target from the host locale + the nav tree', async () => {
    await mountWithTree();
    const label = captured!.linkLabel({ targetNodeId: 'wohnen' });

    // A real, non-empty accessible name that names the PAGE, not the raw id.
    expect(label).toContain('Wohnen');
    expect(label).not.toBe('wohnen');
  });

  it('linkLabel carries the GATE state — the only channel touch and AT have', async () => {
    await mountWithTree();
    const gated = { targetNodeId: 'keller' }; // protected → PIN path
    const open = { targetNodeId: 'wohnen' }; // reachable

    const gatedName = captured!.linkLabel(gated, captured!.resolveLink(gated));
    const openName = captured!.linkLabel(open, captured!.resolveLink(open));

    // A reachable target reads as before …
    expect(openName).toContain('Wohnen');
    expect(openName).not.toMatch(/PIN/i);
    // … a PIN-gated one says so. A cursor or a colour cannot.
    expect(gatedName).toMatch(/PIN/i);
    // And it names the gated PAGE — the page the one PIN opens — not the
    // LOCATION the author linked.
    expect(gatedName).toContain('Technik');
  });

  it('names the gate even when the skin omits the outcome (unconditional, #146 review)', async () => {
    await mountWithTree();
    const link = { targetNodeId: 'keller' };

    // The skin may pass the outcome it already holds — but if it does not, the
    // host resolves it rather than quietly dropping back to the stateless name.
    expect(captured!.linkLabel(link)).toBe(captured!.linkLabel(link, captured!.resolveLink(link)));
    expect(captured!.linkLabel(link)).toMatch(/PIN/i);
  });

  it('a skin that honours `link` takes the affordance over: the host stops stamping it', async () => {
    const store = useDeviceStore();
    await store.init(new MockDataSource([SW]));
    store.links = new Map([['sw1', { targetNodeId: 'wohnen' }]]);
    const wrapper = mount(SkinHost, { props: { skin: 'link-stub', groups: [], theme: 'light' } });

    // One jump must not produce two overlapping affordances / two tab stops.
    expect(wrapper.find('.skin-host-cell[data-id="sw1"]').attributes('data-link')).toBeUndefined();
    expect(wrapper.find('[data-testid="link-anchor"]').exists()).toBe(false);
  });

  it('a page-owning skin that does NOT declare `link` keeps the host affordance', async () => {
    honors = ['position', 'layers'];
    const store = useDeviceStore();
    await store.init(new MockDataSource([SW]));
    store.links = new Map([['sw1', { targetNodeId: 'wohnen' }]]);
    const wrapper = mount(SkinHost, { props: { skin: 'link-stub', groups: [], theme: 'light' } });

    // Golden rule 3 the other way round: no declaration ⇒ nothing changes.
    expect(wrapper.find('.skin-host-cell[data-id="sw1"]').attributes('data-link')).toBe('wohnen');
    expect(wrapper.find('[data-testid="link-anchor"]').exists()).toBe(true);
  });
});
