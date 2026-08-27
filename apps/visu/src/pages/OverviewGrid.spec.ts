import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';

import OverviewGrid from './OverviewGrid';
import { HOST_KEY, type SkinHostApi } from '../app/DetailModalHost.vue';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';

/**
 * pages/OverviewGrid – the gesture seam (Welle 3). The grid turns a gesture on a
 * skin tile into a canonical action per the Zielmodell (vom User festgelegt):
 *   - long-press → position-preset quick menu (openPresets) for a device with
 *     presets, else the detail (openDetail),
 *   - double-tap → detail (openDetail),
 *   - single-tap → Direktbedienung (dispatchIntent); a mouse single-tap no longer
 *     opens the detail, but a keyboard activation (Enter/Space, detail===0) still does.
 *
 * SkinHost is stubbed so the test drives its own `.skin-host-cell[data-id]` DOM
 * through the grid's event-capture seam; the store is seeded so the long-press
 * preset check (`store.byId(id).presets`) sees the real model (kueche-roll has
 * presets, kueche-wand – a light – has none).
 */

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

async function mountGrid(host: SkinHostApi) {
  const store = useDeviceStore();
  await store.init(new MockDataSource());
  const wrapper = mount(OverviewGrid, {
    props: { skin: 'ionic', groups: [] },
    global: {
      provide: { [HOST_KEY as symbol]: host },
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

describe('OverviewGrid – gesture seam', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('long-press on a device WITH presets opens the preset quick menu', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-roll'); // blind with presets in the model

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420); // long-press threshold

    expect(host.openPresets).toHaveBeenCalledWith('kueche-roll', expect.anything());
    expect(host.openDetail).not.toHaveBeenCalled();
  });

  it('long-press on a device WITHOUT presets falls back to the detail', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-wand'); // a light – no presets

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420);

    expect(host.openDetail).toHaveBeenCalledWith('kueche-wand');
    expect(host.openPresets).not.toHaveBeenCalled();
  });

  it('double-tap opens the detail', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host);
    const root = wrapper.find('.overview-grid').element;
    const { cell } = addCell(root, 'kueche-wand');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(100); // well under the 420 ms long-press threshold
    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(host.openDetail).toHaveBeenCalledTimes(1);
    expect(host.openDetail).toHaveBeenCalledWith('kueche-wand');
    expect(host.openPresets).not.toHaveBeenCalled();
  });

  it('a mouse single-tap on an openDetail control does NOT open the detail', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host);
    const root = wrapper.find('.overview-grid').element;
    const { control } = addCell(root, 'kueche-wand', 'openDetail');

    // A real pointer click reports MouseEvent.detail >= 1.
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(host.openDetail).not.toHaveBeenCalled();
  });

  it('a keyboard activation (detail===0) of an openDetail control opens the detail', async () => {
    const host = makeHost();
    const { wrapper } = await mountGrid(host);
    const root = wrapper.find('.overview-grid').element;
    const { control } = addCell(root, 'kueche-wand', 'openDetail');

    // Enter/Space on a role=button reports MouseEvent.detail === 0.
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

    expect(host.openDetail).toHaveBeenCalledWith('kueche-wand');
  });

  it('a single-tap on a control dispatches the canonical intent to the store', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    const { control } = addCell(root, 'kueche-wand', 'toggle');

    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).toHaveBeenCalledWith('kueche-wand');
    expect(host.openDetail).not.toHaveBeenCalled();
  });

  it('suppresses the click that coincides with a completed long-press', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    const { cell, control } = addCell(root, 'kueche-wand', 'toggle');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(420); // long-press fires (openDetail here, no presets)
    // The trailing click of the same gesture must not also dispatch the control.
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).not.toHaveBeenCalled();
  });

  it('suppresses the click that coincides with a completed double-tap', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;
    const { cell, control } = addCell(root, 'kueche-wand', 'toggle');

    cell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(100);
    cell.dispatchEvent(new Event('pointerdown', { bubbles: true })); // double-tap fires
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).not.toHaveBeenCalled();
  });

  it('a single-tap on a cell without a data-action control is a no-op', async () => {
    const host = makeHost();
    const { wrapper, store } = await mountGrid(host);
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
    const { wrapper, store } = await mountGrid(host);
    const spy = vi.spyOn(store, 'toggle');
    const root = wrapper.find('.overview-grid').element;

    // A click on the grid root itself (no enclosing cell) resolves no id.
    root.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(spy).not.toHaveBeenCalled();
    expect(host.openDetail).not.toHaveBeenCalled();
  });
});
