import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { h, type VNode } from 'vue';
import { routeLocationKey, type RouteLocationNormalizedLoaded } from 'vue-router';
import type { PageHost } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — der Popup-Deep-Link (`?popup=<id>`, Micsi/openbridgeserver#184).
 *
 * R16 (M5-Messlatte) scheitert in seinem dritten Schritt daran, dass
 * `/edomi?popup=<id>` das Popup nicht öffnet: eine im Editor angelegte Popup-
 * Seite ist nicht direkt adressierbar. Die Auflage dazu ist eng - der Deep-Link
 * MUSS über dieselbe Stelle laufen wie jede andere Popup-Öffnung
 * (`store.navigate` + `popupFor`, s. `core/store.ts`), keine zweite Bahn.
 *
 * Diese Datei prüft deshalb NICHT den Router selbst (der Host bekommt die
 * Zielseite nur über die injizierte `RouteLocation`, exakt wie
 * `pages/SkinPage.vue` es schon für den Seitennamen tut), sondern die
 * Verdrahtung ab da:
 *
 *   route.query.popup → store.navigate(id) → store.popupFor(id) →
 *   store.openPopup → store.openPopups → SkinHost → PageHost.openPopups → Skin
 *
 * mit einer echten {@link ObsDataSource} über einem Fetch-Doppel (kein Doppel
 * des Hosts) - derselbe Aufbau wie `SkinHost.pagekind.spec.ts`.
 */
let captured: PageHost | null = null;
vi.mock('./skins', () => ({
  resolveSkin: () => ({
    tiles: { switch: () => h('div', { class: 'stub-tile' }) },
    details: {},
    manifest: {
      name: 'edomi-stub',
      unsupported: [],
      layout: { model: 'grid', honors: ['position', 'popup'] },
    },
    page: (host: PageHost) => {
      captured = host;
      return h(
        'div',
        { class: 'skin-page-owned' },
        host.openPopups.map((p) => h('div', { class: 'popup', 'data-id': p.id }) as VNode),
      );
    },
  }),
}));

import SkinHost from './SkinHost';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { ObsClient } from '../core/obs/client';
import { ObsDataSource } from '../core/obs/obs-datasource';
import type { ObsVisuNode } from '../core/obs/mapping';

const toggle = (id: string, dp: string) => ({
  id,
  name: id,
  type: 'Toggle',
  datapoint_id: dp,
  status_datapoint_id: null,
  config: {},
});

const page = (id: string, extra: Partial<ObsVisuNode> = {}): ObsVisuNode => ({
  id,
  parent_id: null,
  name: id,
  type: 'PAGE',
  access: 'public',
  page_config: { widgets: [toggle(`w-${id}`, `dp-${id}`)] },
  ...extra,
});

const TREE: ObsVisuNode[] = [
  page('home'),
  page('pop', {
    kind: 'popup',
    page_config: {
      widgets: [toggle('w-pop', 'dp-pop')],
      popup: { x: 10, y: 20, w: 300, h: 200, modal: true },
    },
  }),
];

function source(): ObsDataSource {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(TREE), { status: 200 });
    if (u.endsWith('/writable')) return new Response(JSON.stringify({ writable: {} }), { status: 200 });
    if (u.endsWith('/value')) return new Response(JSON.stringify({ value: null }), { status: 200 });
    return new Response('not found', { status: 404 });
  });
  return new ObsDataSource(
    new ObsClient({ apiBase: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch }),
  );
}

/** Eine minimale `RouteLocationNormalizedLoaded` — nur `query` wird gelesen. */
function routeWith(query: Record<string, string>): RouteLocationNormalizedLoaded {
  return { query } as unknown as RouteLocationNormalizedLoaded;
}

let wrapper: VueWrapper | null = null;

async function mountWithQuery(query: Record<string, string>): Promise<void> {
  await useDeviceStore().init(source());
  wrapper = mount(SkinHost, {
    props: { skin: 'edomi-stub', groups: [], theme: 'light' },
    global: { provide: { [routeLocationKey as symbol]: routeWith(query) } },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  captured = null;
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  await useDeviceStore().init(new MockDataSource([]));
});

describe('SkinHost — der Popup-Deep-Link (`?popup=<id>`, #184)', () => {
  it('öffnet die per `?popup=<id>` benannte Seite als Popup, über dieselbe Stelle wie jede andere Öffnung', async () => {
    await mountWithQuery({ popup: 'pop' });
    const store = useDeviceStore();

    expect(captured!.openPopups).toEqual([
      { id: 'pop', position: { x: 10, y: 20, w: 300, h: 200 }, modal: true },
    ]);
    expect(wrapper!.find('.popup[data-id="pop"]').exists()).toBe(true);
    // Ein Popup ist kein Seitenwechsel (R2): die Seite darunter bleibt stehen.
    expect(store.currentPageId).toBeNull();
    expect(captured!.currentPageId).toBe('home');
  });

  it('ohne `?popup=` bleibt alles zu — kein ungefragt geöffnetes Popup', async () => {
    await mountWithQuery({});

    expect(captured!.openPopups).toEqual([]);
    expect(wrapper!.find('.popup').exists()).toBe(false);
  });

  it('ein `?popup=<id>` auf eine NORMALE Seite navigiert (kein Popup) statt nichts zu tun', async () => {
    await mountWithQuery({ popup: 'home' });
    const store = useDeviceStore();

    expect(captured!.openPopups).toEqual([]);
    expect(store.currentPageId).toBe('home');
  });

  it('ohne Router (kein injiziertes Route-Objekt) bleibt der Host unverändert nutzbar', async () => {
    await useDeviceStore().init(source());
    wrapper = mount(SkinHost, { props: { skin: 'edomi-stub', groups: [], theme: 'light' } });

    expect(captured!.openPopups).toEqual([]);
    expect(captured!.currentPageId).toBe('home');
  });
});
