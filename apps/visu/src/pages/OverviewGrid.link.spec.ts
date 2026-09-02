import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import type { NavNode, SkinGestures } from '@obs/visu-contract';

/**
 * pages/OverviewGrid — page links as a HOST action (Contract v1.11, #1194).
 *
 * "Ein Element ohne eigene Klick-Funktion springt auf eine andere Visuseite."
 * The gesture seam is the single place that decides this: a tap that resolves NO
 * marked `data-action` (the tile has no click function of its own) follows the
 * cell's `data-link` instead. A tile control that DOES mark an action keeps
 * winning, and a cell without a link keeps its previous no-op.
 *
 * The skin is not involved: it only drew the tile inside the host's cell (golden
 * rule 4 — the host maps the gesture onto the canonical action, the skin owns no
 * state and no navigation).
 */
let mockGestures: SkinGestures | undefined;
vi.mock('../skin-host/skins', () => ({
  resolveSkin: () => ({ tiles: {}, details: {}, presets: {}, manifest: { gestures: mockGestures } }),
}));

import OverviewGrid, { DEFAULT_GESTURES } from './OverviewGrid';
import { LINK_TAP_TARGET } from '../core/links';
import { HOST_KEY, type SkinHostApi } from '../app/DetailModalHost.vue';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';

const IONIC: SkinGestures = { tap: 'action', longPress: 'presets', doubleTap: 'openDetail' };

function makeHost(): SkinHostApi {
  return {
    dispatch: vi.fn(),
    openDetail: vi.fn(),
    closeDetail: vi.fn(),
    openPresets: vi.fn(),
  } as never;
}

async function mountGrid(host: SkinHostApi | null = makeHost()) {
  mockGestures = IONIC;
  const store = useDeviceStore();
  await store.init(new MockDataSource());
  const wrapper = mount(OverviewGrid, {
    props: { skin: 'ionic', groups: [] },
    global: {
      provide: host ? { [HOST_KEY as symbol]: host } : {},
      stubs: { SkinHost: true },
    },
  });
  return { wrapper, store, host };
}

/**
 * Build the host cell the way SkinHost stamps it: `data-id` always, `data-link`
 * when the placed element carries one, plus an optional inner control that marks
 * its own action (the camera's refresh button).
 */
function addCell(
  root: Element,
  id: string,
  opts: { link?: string; action?: string; linkUnsupported?: boolean } = {},
): { cell: HTMLElement; body: HTMLElement; control: HTMLElement } {
  const cell = document.createElement('div');
  cell.className = 'skin-host-cell';
  cell.dataset.id = id;
  if (opts.link) cell.dataset.link = opts.link;
  if (opts.linkUnsupported) cell.dataset.linkUnsupported = 'true';
  // The non-interactive tile body (the camera feed) …
  const body = document.createElement('div');
  cell.appendChild(body);
  // … and the tile's own control, which marks an action.
  const control = document.createElement('button');
  if (opts.action) control.setAttribute('data-action', opts.action);
  cell.appendChild(control);
  root.appendChild(cell);
  return { cell, body, control };
}

describe('OverviewGrid — a tap on a non-interactive linked tile navigates (#1194)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('follows the link when the tapped element marks no action of its own', async () => {
    const { wrapper, store } = await mountGrid();
    const { body } = addCell(wrapper.element, 'hof-cam', { link: 'camera-full', action: 'refresh' });

    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    // The host navigated (host-owned state), not the skin.
    expect(store.currentPageId).toBe('camera-full');
  });

  it("does NOT hijack the tile's own control — even one the host does not dispatch", async () => {
    const { wrapper, store } = await mountGrid();
    const { control } = addCell(wrapper.element, 'hof-cam', {
      link: 'camera-full',
      action: 'refresh',
    });

    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    // `refresh` is a MARKED control of the camera tile. The host has no canonical
    // write for it yet, so it stays a no-op — but the link must not steal its tap.
    expect(store.currentPageId).toBeNull();
  });

  it('a cell without a link keeps its previous no-op (additive)', async () => {
    const { wrapper, store } = await mountGrid();
    const { body } = addCell(wrapper.element, 'hof-cam');

    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(store.currentPageId).toBeNull();
  });

  it('Enter on a focused linked tile navigates too (the cell is role=link)', async () => {
    const { wrapper, store } = await mountGrid();
    const { body } = addCell(wrapper.element, 'hof-cam', { link: 'camera-full' });

    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(store.currentPageId).toBe('camera-full');
  });

  it('a PIN-gated target lands on the gate, NOT on the page', async () => {
    const { wrapper, store } = await mountGrid();
    // A tree whose target inherits `protected` from its parent, with no session.
    const nav: NavNode[] = [
      {
        id: 'keller',
        name: 'Keller',
        type: 'LOCATION',
        access: 'protected',
        children: [{ id: 'technik', name: 'Technik', type: 'PAGE', access: null, children: [] }],
      },
    ];
    store.navTree = nav;

    const { body } = addCell(wrapper.element, 'hof-cam', { link: 'technik' });
    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(store.currentPageId).toBeNull();
    expect(store.pendingGate).toBe('technik');
  });

  it('an unknown target in a real tree changes nothing', async () => {
    const { wrapper, store } = await mountGrid();
    store.navTree = [{ id: 'a', name: 'A', type: 'PAGE', access: null, children: [] }];

    const { body } = addCell(wrapper.element, 'hof-cam', { link: 'gibtsnicht' });
    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(store.currentPageId).toBeNull();
    expect(store.pendingGate).toBeNull();
  });

  it('never fires a link the host declared undeliverable (golden rule 3)', async () => {
    const { wrapper, store } = await mountGrid();
    // The host stamps this when the skin binds `tap` to something other than
    // `action`; both halves must agree, so the seam refuses it too.
    const { body } = addCell(wrapper.element, 'hof-cam', {
      link: 'camera-full',
      linkUnsupported: true,
    });

    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(store.currentPageId).toBeNull();
    expect(store.pendingGate).toBeNull();
  });
});

describe('the host default and the link policy are pinned together (#1194)', () => {
  it("the default tap target IS the target page links are bound to", () => {
    // Two literals in two files: `linksDeliverable(undefined) === true` only holds
    // while the host default tap is `LINK_TAP_TARGET`. Change one without the
    // other and SkinHost would keep stamping a link affordance that never fires.
    expect(DEFAULT_GESTURES.tap).toBe(LINK_TAP_TARGET);
  });
});
