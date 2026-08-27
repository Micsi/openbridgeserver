import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';

import type { SkinGestures } from '@obs/visu-contract';

/**
 * pages/OverviewGrid – the gesture seam, now *skin-manifest-getrieben* (Contract
 * v1.7). The skin's manifest declares which gesture maps to which GestureTarget
 * (`action` / `openDetail` / `presets`) and the host applies it. A skin that
 * declares nothing keeps the backward-compatible default (tap → action,
 * long-press → openDetail; no double-tap, no presets).
 *
 * The ionic model (declared in its manifest) is:
 *   - tap        → action  (a display-only openDetail tile opens the detail;
 *                           a control is operated) – for mouse, touch AND
 *                           keyboard, so the old detail===0 special case is gone,
 *   - long-press → presets (quick menu for a device with presets, else detail),
 *   - double-tap → openDetail.
 *
 * resolveSkin is stubbed so each test drives a specific gestures declaration
 * (`mockGestures`); SkinHost is stubbed so the test drives its own
 * `.skin-host-cell[data-id]` DOM through the grid's event-capture seam. The store
 * is seeded so the preset check (`store.byId(id).presets`) sees the real model
 * (kueche-roll – a blind – has presets, kueche-wand – a light – has none).
 */

/** The gestures the stubbed skin manifest exposes for the current test. */
let mockGestures: SkinGestures | undefined;
vi.mock('../skin-host/skins', () => ({
  resolveSkin: () => ({
    tiles: {},
    details: {},
    presets: {},
    manifest: { gestures: mockGestures },
  }),
}));

import OverviewGrid from './OverviewGrid';
import { HOST_KEY, type SkinHostApi } from '../app/DetailModalHost.vue';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';

/** The ionic interaction model, as declared in its manifest. */
const IONIC: SkinGestures = { tap: 'action', longPress: 'presets', doubleTap: 'openDetail' };

/** A stub host API capturing the calls the grid makes. */
function makeHost(): SkinHostApi & {
  openDetail: ReturnType<typeof vi.fn>;
  openPresets: ReturnType<typeof vi.fn>;
} {
  return {
    dispatch: vi.fn(),
    openDetail: vi.fn(),
    closeDetail: vi.fn(),
    openPresets: vi.fn(),
  } as never;
}

async function mountGrid(host: SkinHostApi | null, gestures?: SkinGestures) {
  mockGestures = gestures;
  const store = useDeviceStore();
  await store.init(new MockDataSource());
  const wrapper = mount(OverviewGrid, {
    props: { skin: 'ionic', groups: [] },
    global: {
      // A grid with no host provided falls back to `inject(HOST_KEY, null)`.
      provide: host ? { [HOST_KEY as symbol]: host } : {},
      stubs: { SkinHost: true },
    },
  });
  return { wrapper, store };
}

/** Append a `.skin-host-cell[data-id]` (optionally with an inner data-action control). */
function addCell(root: Element, id: string, action?: string): { cell: HTMLElement; control: HTMLElement } {
  const cell = document.createElement('div');
  cell.className = 'skin-host-cell';
  cell.dataset.id = id;
  const control = document.createElement('button');
  if (action) control.setAttribute('data-action', action);
  cell.appendChild(control);
  root.appendChild(cell);
  return { cell, control };
}

describe('OverviewGrid – skin-manifest-driven gesture seam', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    mockGestures = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── tap → action ─────────────────────────────────────────────────────────
  it('single-tap (tap:action) on an openDetail element opens the detail', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host, IONIC);
    const root = wrapper.find('.overview-grid').element;
    const { control } = addCell(root, 'kueche-wand', 'openDetail');

    // A real pointer click reports MouseEvent.detail >= 1 – it now opens the detail
    // (this is the inverse of the pre-v1.7 behaviour, where only the double-tap did).
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(host.openDetail).toHaveBeenCalledWith('kueche-wand');
  });

  it('single-tap (tap:action) on an openDetail element opens the detail via keyboard too', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host, IONIC);
    const root = wrapper.find('.overview-grid').element;
    const { control } = addCell(root, 'kueche-wand', 'openDetail');

    // Enter/Space on a role=button reports MouseEvent.detail === 0; the same
    // `action` path handles it, so keyboard users keep a one-press route.
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

    expect(host.openDetail).toHaveBeenCalledWith('kueche-wand');
  });

  it('single-tap (tap:action) on a control dispatches the canonical intent to the store', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host, IONIC);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    const { control } = addCell(root, 'kueche-wand', 'toggle');

    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).toHaveBeenCalledWith('kueche-wand');
    expect(host.openDetail).not.toHaveBeenCalled();
  });

  it('single-tap on a cell without a data-action control is a no-op', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host, IONIC);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    // A cell resolves an id, but its inner control marks no intent (parseIntent null).
    const { control } = addCell(root, 'kueche-wand');

    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).not.toHaveBeenCalled();
    expect(host.openDetail).not.toHaveBeenCalled();
  });

  it('a tap outside any tile is ignored', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host, IONIC);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;

    // A click on the grid root itself (no enclosing cell) resolves no id.
    root.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).not.toHaveBeenCalled();
    expect(host.openDetail).not.toHaveBeenCalled();
  });

  // ── long-press → presets ─────────────────────────────────────────────────
  it('long-press (longPress:presets) on a device WITH presets opens the preset quick menu', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host, IONIC);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-roll'); // blind with presets in the model

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420); // long-press threshold

    expect(host.openPresets).toHaveBeenCalledWith('kueche-roll', expect.anything());
    expect(host.openDetail).not.toHaveBeenCalled();
  });

  it('long-press (longPress:presets) on a device WITHOUT presets falls back to the detail', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host, IONIC);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-wand'); // a light – no presets property

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420);

    expect(host.openDetail).toHaveBeenCalledWith('kueche-wand');
    expect(host.openPresets).not.toHaveBeenCalled();
  });

  it('long-press (longPress:presets) on a device with an EMPTY presets array falls back to the detail', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host, IONIC);
    // A device that carries a `presets` key but no entries: the length guard is
    // false, so the host falls back to the detail rather than an empty popover.
    vi.spyOn(store, 'byId').mockReturnValue({
      id: 'empty-blind',
      type: 'blind',
      room: 'r',
      label: 'l',
      accent: 'orange',
      position: 0,
      locked: false,
      presets: [],
    } as never);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'empty-blind');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420);

    expect(host.openDetail).toHaveBeenCalledWith('empty-blind');
    expect(host.openPresets).not.toHaveBeenCalled();
  });

  // ── double-tap → openDetail ──────────────────────────────────────────────
  it('double-tap (doubleTap:openDetail) opens the detail', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host, IONIC);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-wand');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(100); // well under the 420 ms long-press threshold
    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(host.openDetail).toHaveBeenCalledTimes(1);
    expect(host.openDetail).toHaveBeenCalledWith('kueche-wand');
    expect(host.openPresets).not.toHaveBeenCalled();
  });

  it('a skin/manifest WITHOUT a doubleTap declaration makes a double-tap a no-op', async () => {
    const host = makeHost();
    // Declares tap + longPress but no doubleTap: applyGesture(undefined) is a no-op.
    const { wrapper } = await mountGrid(host, { tap: 'action', longPress: 'openDetail' });
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-wand');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(100);
    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(host.openDetail).not.toHaveBeenCalled();
    expect(host.openPresets).not.toHaveBeenCalled();
  });

  // ── the backward-compatible default model (skin declares no gestures) ─────
  it('the default model (skin without gestures) dispatches a single tap as an action', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host); // no gestures ⇒ DEFAULT_GESTURES
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    const { control } = addCell(root, 'kueche-wand', 'toggle');

    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).toHaveBeenCalledWith('kueche-wand');
    expect(host.openDetail).not.toHaveBeenCalled();
  });

  it('the default model (skin without gestures) opens the detail on a long-press', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-roll'); // even a device with presets → detail

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420);

    expect(host.openDetail).toHaveBeenCalledWith('kueche-roll');
    expect(host.openPresets).not.toHaveBeenCalled();
  });

  // ── click-suppression after a completed long-press / double-tap ──────────
  it('suppresses the click that coincides with a completed long-press', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host, IONIC);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    const { cell, control } = addCell(root, 'kueche-wand', 'toggle');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420); // long-press fires (openDetail fallback here, no presets)
    // The trailing click of the same gesture must not also dispatch the control.
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).not.toHaveBeenCalled();
  });

  it('suppresses the click that coincides with a completed double-tap', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host, IONIC);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    const { cell, control } = addCell(root, 'kueche-wand', 'toggle');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(100);
    cell.dispatchEvent(new Event('pointerdown', { bubbles: true })); // double-tap fires
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).not.toHaveBeenCalled();
  });

  // ── host-null safety (the grid may run before a host is provided) ─────────
  it('with no host provided, an openDetail tap and a default long-press are safe no-ops', async () => {
    const { wrapper, store } = await mountGrid(null); // default model, no host
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;

    // tap:action on an openDetail element → host?.openDetail short-circuits.
    const { control } = addCell(root, 'kueche-wand', 'openDetail');
    expect(() => control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))).not.toThrow();

    // long-press → openDetail target with no host → host?.openDetail short-circuits.
    const { cell } = addCell(root, 'wc-spiegel');
    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(() => vi.advanceTimersByTime(420)).not.toThrow();

    // A control tap still reaches the store (no host needed for a canonical write).
    // A real tap is pointerdown then click; the pointerdown resets the prior
    // long-press `fired` flag so this click is not suppressed.
    const { cell: toggleCell, control: toggleCtl } = addCell(root, 'wc-luefter', 'toggle');
    toggleCell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    toggleCtl.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(spy).toHaveBeenCalledWith('wc-luefter');
  });

  it('with no host provided, a presets long-press falls back to a safe no-op', async () => {
    const { wrapper } = await mountGrid(null, IONIC); // presets long-press, no host
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-roll'); // device WITH presets

    // host?.openPresets is falsy (no host) ⇒ the else branch runs host?.openDetail,
    // which also short-circuits – no throw, nothing dispatched.
    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(() => vi.advanceTimersByTime(420)).not.toThrow();
  });
});
