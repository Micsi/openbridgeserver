import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick, type VNode } from 'vue';
import type { PageHost } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — die Seitentyp-Naht (M5 R2-R6 + `kind`), über die ECHTE Kette.
 *
 * Die Popup-Regeln R2-R6 nützen nichts, solange der Deskriptor niemanden
 * erreicht: `composePopup` erzeugt ihn, aber gerendert wird nur, was im
 * `PageHost.openPopups` des seitenbesitzenden Skins landet. Diese Datei prüft
 * deshalb nicht die Komposition (das tut `compose.spec.ts`), sondern die
 * Verdrahtung:
 *
 *   ObsDataSource.popupFor → store.popupFor → store.navigate → store.openPopups
 *   → SkinHost → PageHost.openPopups → Skin
 *
 * Es wird bewusst eine echte {@link ObsDataSource} über einem Fetch-Mock benutzt
 * (kein Doppel des Hosts), damit der Weg vom Backend-Baum bis in den Renderer
 * lückenlos belegt ist. Der Host behält dabei den Zustand: die offenen Popups und
 * ihre Auto-Close-Timer liegen im Store (dem einzigen Zustandsbesitzer), der Skin
 * bekommt sie nur zu lesen.
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

/**
 * Der Baum, den das Backend liefert. Die globale Includeseite steht bewusst
 * ZUERST und das Popup an zweiter Stelle: eine Startseitenwahl, die den
 * Seitentyp ignoriert, landet damit auf `glob` statt auf `home`.
 */
const TREE: ObsVisuNode[] = [
  page('glob', { kind: 'globalInclude', order: 0 }),
  page('pop', {
    kind: 'popup',
    page_config: {
      widgets: [toggle('w-pop', 'dp-pop')],
      popup: { x: 10, y: 20, w: 300, h: 200, modal: true, dim_backdrop: true },
    },
  }),
  page('pop-auto', {
    kind: 'popup',
    page_config: {
      widgets: [toggle('w-pop-auto', 'dp-pop-auto')],
      // R4 am echten Weg: die Frist steht als Backend-Feld im Seiten-Config.
      popup: { auto_close_ms: 1500 },
    },
  }),
  page('home'),
  page('home2'),
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

let wrapper: VueWrapper | null = null;

async function mountWithTree(): Promise<void> {
  await useDeviceStore().init(source());
  wrapper = mount(SkinHost, { props: { skin: 'edomi-stub', groups: [], theme: 'light' } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  captured = null;
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  // Die echte Quelle pollt als Gast; ein Wechsel auf den Mock meldet sie ab.
  await useDeviceStore().init(new MockDataSource([]));
});

describe('SkinHost — eine Popup-Seite öffnet als Popup (R2-R6 erreichen den Renderer)', () => {
  it('legt beim Navigieren auf eine Popup-Seite den Deskriptor in `PageHost.openPopups`', async () => {
    await mountWithTree();
    const store = useDeviceStore();

    captured!.navigate('pop');
    await nextTick();

    // Der Deskriptor des Autors kommt vollständig beim Skin an (R2/R3/R6) …
    expect(captured!.openPopups).toEqual([
      { id: 'pop', position: { x: 10, y: 20, w: 300, h: 200 }, modal: true, dimBackdrop: true },
    ]);
    // … und der Skin hat ihn tatsächlich gerendert.
    expect(wrapper!.find('.popup[data-id="pop"]').exists()).toBe(true);
    // Ein Popup ist KEIN Seitenwechsel: die Seite darunter bleibt stehen.
    expect(store.currentPageId).toBeNull();
    expect(captured!.currentPageId).toBe('home');
  });

  it('öffnet dieselbe Seite auch über einen Seitenlink als Popup (#1194-Pfad)', async () => {
    await mountWithTree();
    const store = useDeviceStore();

    const outcome = store.followLink({ targetNodeId: 'pop' });
    await nextTick();

    expect(outcome).toEqual({ kind: 'navigate', pageId: 'pop' });
    expect(captured!.openPopups.map((p) => p.id)).toEqual(['pop']);
    expect(store.currentPageId).toBeNull();
  });

  it('Gegenrichtung: eine normale Seite wechselt die Seite und öffnet kein Popup', async () => {
    await mountWithTree();
    const store = useDeviceStore();

    captured!.navigate('home2');
    await nextTick();

    expect(store.currentPageId).toBe('home2');
    expect(captured!.openPopups).toEqual([]);
    expect(wrapper!.find('.popup').exists()).toBe(false);
  });

  it('schliesst das Popup wieder über die Host-Naht (der Zustand bleibt beim Host)', async () => {
    await mountWithTree();

    captured!.navigate('pop');
    await nextTick();
    expect(captured!.openPopups).toHaveLength(1);

    captured!.closePopup('pop');
    await nextTick();
    expect(captured!.openPopups).toEqual([]);
    expect(wrapper!.find('.popup').exists()).toBe(false);
  });
});

describe('SkinHost — R4: `auto_close_ms` vom Backend-Feld bis in den laufenden Timer', () => {
  it('schliesst das Popup nach der Frist, die im Backend-JSON stand', async () => {
    await mountWithTree();
    // Erst ab hier die Zeit anhalten: der Mount selbst soll echt laufen.
    vi.useFakeTimers();
    try {
      captured!.navigate('pop-auto');
      await nextTick();
      // Die Frist ist als Deskriptor-Feld beim Skin angekommen …
      expect(captured!.openPopups).toEqual([{ id: 'pop-auto', autoCloseMs: 1500 }]);
      expect(wrapper!.find('.popup[data-id="pop-auto"]').exists()).toBe(true);

      // … und der Host läuft sie tatsächlich ab: kurz davor steht das Popup noch,
      vi.advanceTimersByTime(1400);
      await nextTick();
      expect(wrapper!.find('.popup[data-id="pop-auto"]').exists()).toBe(true);
      // danach ist es von selbst weg.
      vi.advanceTimersByTime(100);
      await nextTick();
      expect(wrapper!.find('.popup').exists()).toBe(false);
      expect(captured!.openPopups).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SkinHost — der Seitentyp `kind` steuert die Startseite', () => {
  it('startet auf der ersten NORMALEN Seite, nicht auf der globalen Includeseite davor', async () => {
    await mountWithTree();
    // `glob` steht im Baum zuerst und ist eine PAGE — ohne `kind` wäre sie die
    // Startseite und der Nutzer sähe eine Includeseite als ganze Seite.
    expect(captured!.currentPageId).toBe('home');
  });
});
