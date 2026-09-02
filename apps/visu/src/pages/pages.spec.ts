import { describe, it, expect } from 'vitest';

import { PAGES, pageById, resolvePage, groupDevicesByRoom } from './pages';
import { resolveSkin } from '../skin-host/skins';
import { rooms as modelRooms, demoRooms, byId } from '../core/model';
import type { Device } from '@obs/visu-contract';

/**
 * pages/pages — page definitions resolve to the right devices + skin (A5, #101).
 *
 * A page is plain data (a title key, a skin key, an optional room filter); the
 * only behaviour is the pure resolver. These tests pin: the app ships an ionic
 * AND a terminal page, both names resolve through the host skin registry, the
 * full-overview pages cover every core device by reference (no data fork), a
 * room filter scopes in core source order, and an unknown id/room is a loud gap.
 */

/** Total devices referenced across a list of room groups. */
function itemCount(groups: readonly { entries: readonly unknown[] }[]): number {
  return groups.reduce((n, g) => n + g.entries.length, 0);
}

describe('page definitions', () => {
  it('ships at least an ionic page and a terminal page', () => {
    const skinsByPage = Object.fromEntries(PAGES.map((p) => [p.id, p.skin]));
    expect(skinsByPage['overview']).toBe('ionic');
    expect(skinsByPage['terminal']).toBe('terminal');
  });

  it('every page names a skin that the host registry resolves', () => {
    for (const page of PAGES) {
      // an unknown skin would throw here — the registry is the single seam.
      expect(resolveSkin(page.skin).manifest.name).toBe(page.skin);
    }
  });

  it('indexes pages by id', () => {
    expect(pageById['overview']).toBe(PAGES[0]);
    expect(pageById['terminal']).toBe(PAGES[1]);
  });
});

describe('resolvePage — devices per page (no data fork)', () => {
  it('the ionic and terminal pages resolve the SAME devices (identical data, different skin)', () => {
    const ionic = resolvePage('overview');
    const terminal = resolvePage('terminal');

    expect(ionic.def.skin).toBe('ionic');
    expect(terminal.def.skin).toBe('terminal');

    // Same room blocks, same order, same device ids — the whole point of A5.
    expect(terminal.groups).toEqual(ionic.groups);
    // No data fork: the groups are the core model's rooms by reference.
    expect(ionic.groups).toBe(modelRooms);
    expect(terminal.groups).toBe(modelRooms);
  });

  it('a full-overview page (no filter) covers every core room in source order', () => {
    const { groups } = resolvePage('overview');
    expect(groups.map((g) => g.room)).toEqual(modelRooms.map((g) => g.room));
    expect(itemCount(groups)).toBe(itemCount(modelRooms));
  });

  it('throws a visible gap for an unknown page id (no silent default)', () => {
    expect(() => resolvePage('does-not-exist')).toThrow(/unknown page/i);
  });
});

describe('resolvePage — v1.2 media/camera demo page (Issue #122)', () => {
  it('ships a demo-media page rendered by the ionic skin', () => {
    const def = pageById['demo-media'];
    expect(def).toBeDefined();
    expect(def.skin).toBe('ionic');
    expect(def.source).toBe('demo');
    // its named skin still resolves through the host registry
    expect(resolveSkin(def.skin).manifest.name).toBe('ionic');
  });

  it('resolves the demo-media page to the Medien block (media + camera) by reference', () => {
    const { def, groups } = resolvePage('demo-media');
    expect(def.id).toBe('demo-media');
    // No data fork: the demo page selects the core demoRooms by reference.
    expect(groups).toBe(demoRooms);
    expect(groups.map((g) => g.room)).toEqual(['Medien']);

    const ids = groups.flatMap((g) => g.entries.map((e) => e.id));
    const types = ids.map((id) => byId[id]?.type);
    expect(types).toContain('media');
    expect(types).toContain('camera');
    // every resolved entry points at a real device in the single model
    for (const id of ids) expect(byId[id]).toBeDefined();
  });

  it('keeps the media/camera demo OUT of the mobile overview floor (overview unaffected)', () => {
    const overview = resolvePage('overview');
    expect(overview.groups).toBe(modelRooms);
    expect(overview.groups.map((g) => g.room)).not.toContain('Medien');
  });
});

describe('groupDevicesByRoom — the live (external) floor for a real backend', () => {
  // Real model devices stand in for a backend tree's mapped devices; the point
  // is the grouping, not where the ids come from.
  const kuecheWand = byId['kueche-wand'] as Device;
  const kuechePendel = byId['kueche-pendel'] as Device;
  const wcSpiegel = byId['wc-spiegel'] as Device;

  it('groups devices by room in first-appearance order, entries in device order', () => {
    // Interleave rooms so first-appearance order (not per-room clustering of the
    // input) is what decides the block order.
    // Grouping is by the DEVICE's own `room` (the backend PAGE node name in OBS
    // mode) — for a real backend that is the label the user sees, distinct from
    // the demo model's display RoomGroup labels.
    const groups = groupDevicesByRoom([kuecheWand, wcSpiegel, kuechePendel]);
    expect(groups.map((g) => g.room)).toEqual([kuecheWand.room, wcSpiegel.room]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['kueche-wand', 'kueche-pendel']);
    expect(groups[1].entries.map((e) => e.id)).toEqual(['wc-spiegel']);
  });

  it('emits ONLY ids drawn from the given devices (never an off-model entry)', () => {
    // The invariant that keeps the layout resolver from throwing against a real
    // backend: every derived entry id is one of the live devices, so byId(id)
    // resolves for each — unlike the static mock floor with its demo ids.
    const devs = [kuecheWand, kuechePendel, wcSpiegel];
    const ids = new Set(devs.map((d) => d.id));
    const groups = groupDevicesByRoom(devs);
    for (const g of groups) for (const e of g.entries) expect(ids.has(e.id)).toBe(true);
  });

  it('skips id-less devices and returns no blocks for an empty set', () => {
    expect(groupDevicesByRoom([])).toEqual([]);
    const groups = groupDevicesByRoom([{ ...kuecheWand, id: '' } as Device, kuechePendel]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['kueche-pendel']);
  });

  it('carries the additive author position onto the entry when the map has one (layering W3)', () => {
    const positions = new Map([['kueche-wand', { x: 10, y: 20, w: 3, h: 2 }]]);
    const groups = groupDevicesByRoom([kuecheWand, kuechePendel], positions);
    const [wand, pendel] = groups[0].entries;
    expect(wand.position).toEqual({ x: 10, y: 20, w: 3, h: 2 });
    // A device without a position stays a plain entry (no empty position key).
    expect(pendel.position).toBeUndefined();
  });

  it('leaves every entry position-less when no map is given (responsive floor)', () => {
    const groups = groupDevicesByRoom([kuecheWand, kuechePendel]);
    expect(groups[0].entries.every((e) => e.position === undefined)).toBe(true);
  });
});

describe('pages — the #1194 full-screen camera page + link plumbing', () => {
  it('ships a camera-full page rendered by the ionic skin', () => {
    const def = pageById['camera-full'];
    expect(def).toBeDefined();
    expect(def.skin).toBe('ionic');
    expect(() => resolveSkin(def.skin)).not.toThrow();
  });

  it('resolves camera-full to the full-width camera that links back, plus a self-link', () => {
    const { groups } = resolvePage('camera-full');
    const entries = groups.flatMap((g) => g.entries);
    expect(entries.map((e) => e.id)).toEqual(['hof-cam', 'garage-cam']);
    expect(byId['hof-cam']?.type).toBe('camera');
    // The big tile jumps back to the media block …
    expect(entries[0].link?.targetNodeId).toBe('demo-media');
    // … the small one points at THIS page, so the host marks it active.
    expect(entries[1].link).toEqual({ targetNodeId: 'camera-full', activeIndicator: 'dot' });
  });

  it('the media block links its camera tiles to the full-screen page', () => {
    const cams = demoRooms.flatMap((g) => g.entries).filter((e) => byId[e.id]?.type === 'camera');
    expect(cams.length).toBeGreaterThan(0);
    for (const cam of cams) expect(cam.link?.targetNodeId).toBe('camera-full');
  });

  it('groupDevicesByRoom carries per-device links from an external floor', () => {
    const devices = [byId['hof-cam'], byId['wohn-sonos']] as Device[];
    const links = new Map([['hof-cam', { targetNodeId: 'node-7' }]]);
    const groups = groupDevicesByRoom(devices, undefined, links);
    const entries = groups.flatMap((g) => g.entries);
    expect(entries.find((e) => e.id === 'hof-cam')?.link).toEqual({ targetNodeId: 'node-7' });
    expect(entries.find((e) => e.id === 'wohn-sonos')?.link).toBeUndefined();
  });
});
