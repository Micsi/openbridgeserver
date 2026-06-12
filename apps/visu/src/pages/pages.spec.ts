import { describe, it, expect } from 'vitest';

import { PAGES, pageById, resolvePage } from './pages';
import { resolveSkin } from '../skin-host/skins';
import { rooms as modelRooms, demoRooms, byId } from '../core/model';

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
