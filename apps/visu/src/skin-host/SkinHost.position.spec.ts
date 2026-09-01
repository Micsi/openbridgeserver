import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import type { Device } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — position honouring (Visu-Layering W4).
 *
 * A skin that declares `honors: ['position']` gets an absolute canvas: the host
 * places each cell by its author box (x/y/w/h, scaled by `--vz-pos-unit`) instead
 * of the room/role grid. The skin stays a pure content renderer; the host owns
 * placement. This isolates a stubbed position-honouring skin so it does not touch
 * the real ionic skin (which honours no position and keeps its responsive floor).
 */
vi.mock('./skins', () => ({
  resolveSkin: () => ({
    tiles: { switch: () => h('div', { class: 'stub-tile' }) },
    details: {},
    manifest: {
      name: 'edomi-stub',
      unsupported: [],
      layout: { model: 'grid', honors: ['position'] },
    },
  }),
}));

import SkinHost from './SkinHost';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import type { RoomGroup } from '../core/model';

const SW: Device = {
  id: 'sw1',
  type: 'switch',
  room: 'Wohnen',
  label: 'Lampe',
  accent: 'slate',
  on: false,
} as Device;

describe('SkinHost — honors: position places absolutely (layering W4)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders the positioned canvas with each cell boxed from its author position', async () => {
    await useDeviceStore().init(new MockDataSource([SW]));
    const groups: RoomGroup[] = [
      { room: 'Wohnen', entries: [{ id: 'sw1', position: { x: 2, y: 3, w: 4, h: 5 } }] },
    ];

    const wrapper = mount(SkinHost, { props: { skin: 'edomi-stub', groups, theme: 'light' } });

    // The absolute canvas replaces the room-grid; no grouped grid is emitted.
    expect(wrapper.find('.skin-host-model-positioned').exists()).toBe(true);
    expect(wrapper.find('.skin-host-model-grid').exists()).toBe(false);

    const cell = wrapper.find('.skin-host-cell');
    const style = cell.attributes('style') ?? '';
    expect(style).toContain('position: absolute');
    // x=2, y=3, w=4, h=5 scaled by the unit var.
    expect(style).toContain('* 2)'); // left
    expect(style).toContain('* 3)'); // top
    expect(style).toContain('* 4)'); // width
    expect(style).toContain('* 5)'); // height
    // The content renderer still runs (skin stays a pure content renderer).
    expect(cell.find('.stub-tile').exists()).toBe(true);
  });
});
