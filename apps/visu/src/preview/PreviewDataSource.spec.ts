import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { h, type VNode } from 'vue';
import type { PageHost } from '@obs/visu-contract';

/**
 * preview/PreviewDataSource - die eigene Datenquelle der Vorschau (C4, #171).
 *
 * Die Falle, gegen die diese Spec schuetzt: `MockDataSource` kann kein Layering
 * (`navTree()`/`layersFor()` fehlen), also rendert ein seitenbesitzender Skin
 * damit **stumm leer** - kein Fehler, kein Hinweis, nur eine leere Seite. Die
 * Vorschau braucht deshalb eine Quelle, die den Entwurf als `navTree()` /
 * `layersFor()` / `positions()` liefert und die Werte vom Backend bezieht.
 *
 * Der Entwurf fliesst dabei ueber den Host (Store -> PageHost) in den Skin, nie
 * direkt hinein: der Skin besitzt keinen Zustand (Goldene Regel 4).
 */

/** Der PageHost, den ein seitenbesitzender Skin vom Host bekommt. */
let captured: PageHost | null = null;
vi.mock('../skin-host/skins', () => ({
  resolveSkin: () => ({
    tiles: {
      light: () => h('div', { class: 'stub-tile' }),
      switch: () => h('div', { class: 'stub-tile' }),
    },
    details: {},
    rootClass: 'stub-root',
    manifest: {
      name: 'edomi-stub',
      unsupported: [],
      layout: { model: 'grid', honors: ['position', 'layers', 'nav'] },
    },
    page: (host: PageHost) => {
      captured = host;
      const layers = host.layersFor(host.currentPageId ?? '');
      return h(
        'div',
        { class: 'skin-page-owned' },
        layers.flatMap((l) => l.items.map((it) => host.renderTile(it.id) as VNode)),
      );
    },
  }),
}));

import SkinHost from '../skin-host/SkinHost';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { PreviewDataSource, type PreviewValueBackend } from './PreviewDataSource';
import type { PreviewDraft } from './protocol';

/** Ein Entwurf mit zwei Seiten, Positionen, einem Link und einem Seitentyp. */
const DRAFT: PreviewDraft = {
  skin: 'edomi',
  pageId: 'page-wohnen',
  nodes: [
    {
      id: 'loc-eg',
      parent_id: null,
      name: 'Erdgeschoss',
      type: 'LOCATION',
      kind: 'normal',
      page_config: null,
    },
    {
      id: 'page-wohnen',
      parent_id: 'loc-eg',
      name: 'Wohnen',
      type: 'PAGE',
      kind: 'normal',
      page_config: {
        widgets: [
          {
            id: 'w-lamp',
            name: 'Stehlampe',
            type: 'Licht',
            datapoint_id: null,
            status_datapoint_id: null,
            config: { dp_switch: 'dp-lamp' },
            x: 10,
            y: 20,
            w: 30,
            h: 40,
          },
          {
            id: 'w-cam',
            name: 'Kamera',
            type: 'Toggle',
            datapoint_id: 'dp-cam',
            status_datapoint_id: null,
            config: { target_node_id: 'page-global', active_indicator: 'dot' },
          },
        ],
      },
    },
    {
      id: 'page-global',
      parent_id: null,
      name: 'Kopfzeile',
      type: 'PAGE',
      kind: 'globalInclude',
      page_config: {
        widgets: [
          {
            id: 'w-head',
            type: 'Toggle',
            datapoint_id: 'dp-head',
            status_datapoint_id: null,
            config: {},
          },
        ],
      },
    },
  ],
};

/** Ein Backend-Doppel: haelt fest, was seitenbezogen gelesen/geschrieben wurde. */
function makeBackend(values: Record<string, unknown> = {}): PreviewValueBackend & {
  reads: { ids: readonly string[]; pageId: string }[];
  writes: { dp: string; value: unknown; pageId: string }[];
} {
  const reads: { ids: readonly string[]; pageId: string }[] = [];
  const writes: { dp: string; value: unknown; pageId: string }[] = [];
  return {
    reads,
    writes,
    read(ids, pageId) {
      reads.push({ ids: [...ids], pageId });
      return Promise.resolve(new Map(ids.filter((id) => id in values).map((id) => [id, values[id]])));
    },
    write(dp, value, pageId) {
      writes.push({ dp, value, pageId });
      return Promise.resolve();
    },
  };
}

describe('preview/PreviewDataSource - der Entwurf als Datenquelle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    captured = null;
  });

  it('liefert die Geraete des Entwurfs, ohne dass etwas gespeichert wurde', async () => {
    const backend = makeBackend();
    const src = new PreviewDataSource(backend);
    src.setDraft(DRAFT);

    const devices = await src.list();
    expect(devices.map((d) => d.id).sort()).toEqual(['w-cam', 'w-head', 'w-lamp']);
    expect(backend.writes).toHaveLength(0);
  });

  it('liefert navTree() aus dem Entwurf - die Hierarchie, nicht eine flache Liste', async () => {
    const src = new PreviewDataSource(makeBackend());
    src.setDraft(DRAFT);
    await src.list();

    const tree = src.navTree();
    expect(tree.length).toBeGreaterThan(0);
    const eg = tree.find((n) => n.id === 'loc-eg');
    expect(eg).toBeDefined();
    expect(eg!.type).toBe('LOCATION');
    expect(eg!.children.map((c) => c.id)).toEqual(['page-wohnen']);
    expect(tree.some((n) => n.id === 'page-global')).toBe(true);
  });

  it('liefert layersFor() mit den Elementen der Entwurfsseite', async () => {
    const src = new PreviewDataSource(makeBackend());
    src.setDraft(DRAFT);
    await src.list();

    const layers = src.layersFor('page-wohnen');
    expect(layers.length).toBeGreaterThan(0);
    const own = layers.find((l) => l.origin === 'own');
    expect(own).toBeDefined();
    expect(own!.items.map((i) => i.id)).toEqual(['w-lamp', 'w-cam']);
    // Der Link des Entwurfs reist auf dem platzierten Element mit (v1.11).
    expect(own!.items.find((i) => i.id === 'w-cam')!.link).toEqual({
      targetNodeId: 'page-global',
      activeIndicator: 'dot',
    });
  });

  it('liefert positions() aus den Autorenkoordinaten des Entwurfs', async () => {
    const src = new PreviewDataSource(makeBackend());
    src.setDraft(DRAFT);
    await src.list();

    expect(src.positions().get('w-lamp')).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(src.positions().has('w-cam')).toBe(false);
  });

  it('bezieht die Werte seitenbezogen vom Backend', async () => {
    const backend = makeBackend({ 'dp-lamp': true, 'dp-cam': false });
    const src = new PreviewDataSource(backend);
    src.setDraft(DRAFT);

    const devices = await src.list();
    expect(devices.find((d) => d.id === 'w-lamp')).toMatchObject({ on: true });
    expect(devices.find((d) => d.id === 'w-cam')).toMatchObject({ on: false });
    // Seitenbezogen: die Datenpunkte der Seite werden unter DEREN id gelesen.
    const wohnen = backend.reads.find((r) => r.pageId === 'page-wohnen');
    expect(wohnen).toBeDefined();
    expect([...wohnen!.ids].sort()).toEqual(['dp-cam', 'dp-lamp']);
  });

  it('schreibt eine kanonische Aktion seitenbezogen an das Backend', async () => {
    const backend = makeBackend({ 'dp-lamp': false });
    const src = new PreviewDataSource(backend);
    src.setDraft(DRAFT);
    await src.list();

    await src.dispatch('w-lamp', 'toggle');
    expect(backend.writes).toEqual([{ dp: 'dp-lamp', value: true, pageId: 'page-wohnen' }]);
  });

  it('uebernimmt einen neuen Entwurf, ohne die Quelle neu bauen zu muessen', async () => {
    const src = new PreviewDataSource(makeBackend());
    src.setDraft(DRAFT);
    await src.list();
    expect(src.layersFor('page-wohnen')[0].items.length).toBeGreaterThan(0);

    src.setDraft({ ...DRAFT, nodes: [DRAFT.nodes[2]], pageId: 'page-global' });
    const devices = await src.list();
    expect(devices.map((d) => d.id)).toEqual(['w-head']);
    expect(src.layersFor('page-wohnen')).toEqual([]);
    expect(src.layersFor('page-global')[0].items.map((i) => i.id)).toEqual(['w-head']);
  });

  it('bleibt ohne Entwurf leer, statt zu werfen', async () => {
    const src = new PreviewDataSource(makeBackend());
    await expect(src.list()).resolves.toEqual([]);
    expect(src.navTree()).toEqual([]);
    expect(src.layersFor('irgendwas')).toEqual([]);
    expect(src.positions().size).toBe(0);
    expect(src.links().size).toBe(0);
  });
});

describe('preview/PreviewDataSource - der seitenbesitzende Skin bekommt einen Baum', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    captured = null;
  });

  it('MockDataSource laesst einen seitenbesitzenden Skin stumm leer rendern (die Falle)', async () => {
    await useDeviceStore().init(new MockDataSource([]));
    mount(SkinHost, { props: { skin: 'edomi-stub', groups: [], theme: 'light' } });

    expect(captured).not.toBeNull();
    expect(captured!.navTree).toEqual([]);
    expect(captured!.layersFor('page-wohnen')).toEqual([]);
  });

  it('PreviewDataSource gibt demselben Skin einen nicht leeren Baum und Layer', async () => {
    const src = new PreviewDataSource(makeBackend({ 'dp-lamp': true }));
    src.setDraft(DRAFT);
    await useDeviceStore().init(src);

    const wrapper = mount(SkinHost, {
      props: { skin: 'edomi-stub', groups: [], theme: 'light', currentPage: 'page-wohnen' },
    });

    expect(captured).not.toBeNull();
    expect(captured!.navTree.length).toBeGreaterThan(0);
    expect(captured!.currentPageId).toBe('page-wohnen');
    const layers = captured!.layersFor('page-wohnen');
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.flatMap((l) => l.items).map((i) => i.id)).toContain('w-lamp');
    // Der Entwurf ist wirklich gerendert, nicht nur vorhanden.
    expect(wrapper.find('.skin-host-cell[data-id="w-lamp"]').exists()).toBe(true);
  });

  it('loest einen Link auf, ohne zu navigieren (PageHost.resolveLink, Contract 1.12)', async () => {
    const src = new PreviewDataSource(makeBackend());
    src.setDraft(DRAFT);
    await useDeviceStore().init(src);

    mount(SkinHost, {
      props: { skin: 'edomi-stub', groups: [], theme: 'light', currentPage: 'page-wohnen' },
    });

    const outcome = captured!.resolveLink({ targetNodeId: 'page-global' });
    expect(outcome).toEqual({ kind: 'navigate', pageId: 'page-global' });
    // Reines Auflösen: die gezeigte Seite bleibt die Entwurfsseite.
    expect(captured!.currentPageId).toBe('page-wohnen');
  });
});
