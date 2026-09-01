import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { h, nextTick, type VNode } from 'vue';
import type { Device, PageHost } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — page-renderer seam (Visu-Layering W4).
 *
 * A skin that owns the whole page exports a `page` renderer; the host delegates
 * the body to it, owning STATE (current page, open popups + auto-close timers) and
 * the content-tile rendering, while the skin owns the appearance. This captures the
 * PageHost a stubbed page-owning skin receives and pins: the page renderer replaces
 * the floor, `renderTile` produces a host tile, and the popup state + auto-close are
 * host-owned (a re-open does not extend the timer).
 */
let captured: PageHost | null = null;
vi.mock('./skins', () => ({
  resolveSkin: () => ({
    tiles: { switch: () => h('div', { class: 'stub-tile' }) },
    details: {},
    manifest: { name: 'edomi-stub', unsupported: [], layout: { model: 'grid', honors: ['position'] } },
    page: (host: PageHost) => {
      captured = host;
      return h('div', { class: 'skin-page-owned' }, [
        host.renderTile('sw1') as VNode,
        h('span', { class: 'popup-count' }, String(host.openPopups.length)),
      ]);
    },
  }),
}));

import SkinHost from './SkinHost';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';

const SW: Device = { id: 'sw1', type: 'switch', room: 'R', label: 'S', accent: 'slate', on: false } as Device;

describe('SkinHost — page-renderer seam (layering W4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    captured = null;
  });

  it('delegates the page to the skin renderer and renders host tiles (not the floor)', async () => {
    await useDeviceStore().init(new MockDataSource([SW]));
    const wrapper = mount(SkinHost, { props: { skin: 'edomi-stub', groups: [], theme: 'light' } });

    // The skin owns the page: its marker renders, the floor grid does not.
    expect(wrapper.find('.skin-page-owned').exists()).toBe(true);
    expect(wrapper.find('.skin-host-model-grid').exists()).toBe(false);
    // renderTile produced the host cell with the skin's content renderer inside.
    const tile = wrapper.find('.skin-host-cell[data-id="sw1"]');
    expect(tile.exists()).toBe(true);
    expect(tile.find('.stub-tile').exists()).toBe(true);
    // The host passes its state + services.
    expect(captured).not.toBeNull();
    expect(typeof captured!.navigate).toBe('function');
    expect(typeof captured!.layersFor).toBe('function');
  });

  it('owns the popup state: open adds it, a re-open does not extend, close removes it', async () => {
    vi.useFakeTimers();
    await useDeviceStore().init(new MockDataSource([SW]));
    const wrapper = mount(SkinHost, { props: { skin: 'edomi-stub', groups: [] } });

    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    await nextTick();
    expect(wrapper.find('.popup-count').text()).toBe('1');

    // Re-open near the deadline must NOT extend it (Edomi rule).
    vi.advanceTimersByTime(900);
    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    vi.advanceTimersByTime(200); // 1100ms since first open → auto-closed
    await nextTick();
    expect(wrapper.find('.popup-count').text()).toBe('0');

    // Manual open + close.
    captured!.openPopup({ id: 'p2' });
    await nextTick();
    expect(wrapper.find('.popup-count').text()).toBe('1');
    captured!.closePopup('p2');
    await nextTick();
    expect(wrapper.find('.popup-count').text()).toBe('0');
    vi.useRealTimers();
  });
});
