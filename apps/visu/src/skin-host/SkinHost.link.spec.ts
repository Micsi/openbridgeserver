import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import type { Device, NavNode, SkinGestures } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — page links on placed elements (Contract v1.11, #1194).
 *
 * The host turns a link on a placed element into a navigation affordance on its
 * OWN cell: `data-link` (the target the gesture seam resolves), `role="link"`,
 * focusable, and — when the target is the current page or an ancestor of it —
 * the author's active indicator (V1 `active_indicator`: dot · bar · border).
 *
 * The skin is untouched by all of this: it still only renders the tile body.
 * A placed element WITHOUT a link must render exactly as before (additive).
 */
let mockGestures: SkinGestures | undefined;
vi.mock('./skins', () => ({
  resolveSkin: () => ({
    tiles: {
      switch: () => h('div', { class: 'stub-tile' }),
      camera: () => h('div', { class: 'stub-cam' }),
    },
    details: {},
    presets: {},
    manifest: {
      name: 'stub',
      unsupported: [],
      gestures: mockGestures,
      layout: { model: 'grid', honors: ['role'] },
    },
  }),
}));

import SkinHost from './SkinHost';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import type { RoomGroup } from '../core/model';

const CAM: Device = {
  id: 'cam1',
  type: 'camera',
  room: 'Hof',
  label: 'Hofeinfahrt',
  accent: 'slate',
  online: false,
  snapshotUrl: null,
} as Device;

const SW: Device = {
  id: 'sw1',
  type: 'switch',
  room: 'Hof',
  label: 'Licht',
  accent: 'slate',
  on: false,
} as Device;

const NAV: NavNode[] = [
  {
    id: 'haus',
    name: 'Haus',
    type: 'LOCATION',
    access: null,
    children: [{ id: 'voll', name: 'Vollbild', type: 'PAGE', access: null, children: [] }],
  },
];

async function mountWith(groups: RoomGroup[], gestures?: SkinGestures) {
  mockGestures = gestures;
  const store = useDeviceStore();
  await store.init(new MockDataSource([CAM, SW]));
  const wrapper = mount(SkinHost, { props: { skin: 'stub', groups, theme: 'light' } });
  return { wrapper, store };
}

describe('SkinHost — a linked placed element becomes a host navigation affordance', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockGestures = undefined;
  });

  it('stamps the link target + role/tabindex on the host cell', async () => {
    const { wrapper } = await mountWith([
      { room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'voll' } }] },
    ]);

    const cell = wrapper.find('.skin-host-cell[data-id="cam1"]');
    expect(cell.attributes('data-link')).toBe('voll');
    expect(cell.attributes('style') ?? '').toContain('cursor: pointer');
    // The CELL is not the link and not a tab stop — a focusable element with
    // neither name nor role would be a WCAG 4.1.2 failure, and `role="link"` on
    // the cell would swallow the tile's own control into its name.
    expect(cell.attributes('role')).toBeUndefined();
    expect(cell.attributes('tabindex')).toBeUndefined();
    // The stretched link is the one named, focusable, announced element.
    const anchor = cell.find('[data-testid="link-anchor"]');
    expect(anchor.exists()).toBe(true);
    expect(anchor.attributes('role')).toBe('link');
    expect(anchor.attributes('tabindex')).toBe('0');
    // Without a nav tree (the static floor) there is no target name to show —
    // the generic wording, never a raw node id.
    expect(anchor.attributes('aria-label')).toBe('Zur verknüpften Seite springen');
    // The skin still only draws the tile body — no skin change is required.
    expect(cell.find('.stub-cam').exists()).toBe(true);
  });

  it('names the link after the target page once the nav tree knows it', async () => {
    const { wrapper, store } = await mountWith([
      { room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'voll' } }] },
    ]);
    store.navTree = NAV;
    await nextTick();

    // The HOST owns the affordance (golden rule 4), so it owns its label: its own
    // locale files plus the target's plain name out of the nav tree.
    expect(wrapper.find('[data-testid="link-anchor"]').attributes('aria-label')).toBe(
      'Zur Seite Vollbild springen',
    );
  });

  it('leaves an element WITHOUT a link exactly as before (additive)', async () => {
    const { wrapper } = await mountWith([{ room: 'Hof', entries: [{ id: 'sw1' }] }]);

    const cell = wrapper.find('.skin-host-cell[data-id="sw1"]');
    expect(cell.attributes('data-link')).toBeUndefined();
    expect(cell.find('[data-testid="link-anchor"]').exists()).toBe(false);
    expect(cell.find('[data-testid="link-active-dot"]').exists()).toBe(false);
  });

  it('draws no indicator while the target is not the current page', async () => {
    const { wrapper } = await mountWith([
      { room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'voll', activeIndicator: 'dot' } }] },
    ]);
    const cell = wrapper.find('.skin-host-cell[data-id="cam1"]');
    expect(cell.attributes('data-link-active')).toBeUndefined();
    expect(cell.find('[data-testid="link-anchor"]').attributes('aria-current')).toBeUndefined();
    expect(wrapper.find('[data-testid="link-active-dot"]').exists()).toBe(false);
  });

  it('marks the link active when the target IS the current page (dot)', async () => {
    const { wrapper, store } = await mountWith([
      { room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'voll', activeIndicator: 'dot' } }] },
    ]);
    store.navigate('voll');
    await nextTick();

    const cell = wrapper.find('.skin-host-cell[data-id="cam1"]');
    expect(cell.attributes('data-link-active')).toBe('true');
    // aria-current belongs to the link, not to the container.
    expect(cell.find('[data-testid="link-anchor"]').attributes('aria-current')).toBe('page');
    expect(wrapper.find('[data-testid="link-active-dot"]').exists()).toBe(true);
  });

  it('marks the link active along the ANCESTOR chain (bar)', async () => {
    const { wrapper, store } = await mountWith([
      { room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'haus', activeIndicator: 'bar' } }] },
    ]);
    // The current page is a CHILD of the link target → the target is active.
    store.navTree = NAV;
    store.navigate('voll');
    await nextTick();

    expect(wrapper.find('[data-testid="link-active-bar"]').exists()).toBe(true);
    expect(wrapper.find('.skin-host-cell[data-id="cam1"]').attributes('data-link-active')).toBe('true');
  });

  it("renders the 'border' indicator as an outline on the cell, not an extra node", async () => {
    const { wrapper, store } = await mountWith([
      { room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'voll', activeIndicator: 'border' } }] },
    ]);
    store.navigate('voll');
    await nextTick();

    const style = wrapper.find('.skin-host-cell[data-id="cam1"]').attributes('style') ?? '';
    // box-shadow, never `outline` — outline belongs to the browser focus ring.
    expect(style).toContain('box-shadow');
    expect(style).not.toContain('outline');
    expect(wrapper.find('[data-testid="link-active-dot"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="link-active-bar"]').exists()).toBe(false);
  });

  it('keeps the role/span footprint of a linked cell (link is additive to layout)', async () => {
    const { wrapper } = await mountWith([
      { room: 'Hof', entries: [{ id: 'sw1', span: 2, link: { targetNodeId: 'voll' } }] },
    ]);
    const style = wrapper.find('.skin-host-cell[data-id="sw1"]').attributes('style') ?? '';
    // switch stays `compact` (span 2 may not promote it) → 1×1, and the cursor
    // from the link is merged in rather than replacing the layout style.
    expect(style).toContain('grid-column');
    expect(style).toContain('cursor: pointer');
  });
});

describe('SkinHost — a link the skin cannot deliver is a DECLARED gap (#1194)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockGestures = undefined;
  });

  it("withholds the affordance and marks it when `tap` is not 'action'", async () => {
    const { wrapper } = await mountWith(
      [{ room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'voll' } }] }],
      { tap: 'openDetail', longPress: 'presets' },
    );

    const cell = wrapper.find('.skin-host-cell[data-id="cam1"]');
    // Declared, inspectable — not a silently swallowed feature (golden rule 3).
    expect(cell.attributes('data-link-unsupported')).toBe('true');
    expect(cell.attributes('data-link')).toBe('voll');
    // …and nothing pretends to be operable: no link, no tab stop, no cursor.
    expect(cell.find('[data-testid="link-anchor"]').exists()).toBe(false);
    expect(cell.attributes('style') ?? '').not.toContain('cursor: pointer');
  });

  it("delivers the link for an explicit tap:'action' and for no declaration at all", async () => {
    for (const gestures of [undefined, { tap: 'action' } as SkinGestures]) {
      setActivePinia(createPinia());
      const { wrapper } = await mountWith(
        [{ room: 'Hof', entries: [{ id: 'cam1', link: { targetNodeId: 'voll' } }] }],
        gestures,
      );
      const cell = wrapper.find('.skin-host-cell[data-id="cam1"]');
      expect(cell.attributes('data-link-unsupported')).toBeUndefined();
      expect(cell.find('[data-testid="link-anchor"]').attributes('tabindex')).toBe('0');
    }
  });
});
