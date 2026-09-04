import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick, type VNode } from 'vue';
import type { Device, PageHost } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — der Popup-ZUSTAND des Hosts (M5 R7/R8 + die Fristen).
 *
 * Der Zustand (welche Popups offen sind und ihre Auto-Close-Fristen) liegt im
 * Store, der Skin liest ihn nur durch seinen `PageHost` (goldene Regel 4).
 * Genau an dieser Naht hängen drei Aussagen, die der Code trifft und die vorher
 * kein Test gehalten hat:
 *
 *   - **Die Frist wird beim Schliessen abgeräumt.** Ohne das läuft der alte
 *     Timer weiter und schliesst ein danach erneut geöffnetes Popup auf der
 *     ALTEN Frist, also zu früh.
 *   - **R7, die Gegenrichtung dazu:** solange das Popup OFFEN ist, verlängert
 *     erneutes Öffnen die Frist nicht (Edomi-Regel). Beide Seiten derselben
 *     Bedingung, deshalb beide hier.
 *   - **R8:** beliebig viele VERSCHIEDENE Popups sind gleichzeitig offen, jedes
 *     mit eigenem Deskriptor und eigener Frist.
 *   - **Unmount:** stirbt die Komponente, bleibt kein Timer zurück, der auf eine
 *     tote Seite feuert.
 *
 * Die Zeit wird durchweg mit Fake-Timern kontrolliert; der Mock als Quelle
 * bringt selbst keine Timer mit, `vi.getTimerCount()` zählt also nur die Fristen
 * des Hosts.
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

const SW: Device = { id: 'sw1', type: 'switch', room: 'R', label: 'S', accent: 'slate', on: false } as Device;

let wrapper: VueWrapper | null = null;

async function mountHost(): Promise<void> {
  await useDeviceStore().init(new MockDataSource([SW]));
  wrapper = mount(SkinHost, { props: { skin: 'edomi-stub', groups: [], theme: 'light' } });
}

/** Die Ids der Popups, die der Skin gerade GEZEICHNET hat (nicht nur der Zustand). */
function renderedPopupIds(): string[] {
  return wrapper!.findAll('.popup').map((el) => el.attributes('data-id') ?? '');
}

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  captured = null;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe('SkinHost — die Auto-Close-Frist gehört zum offenen Popup, nicht zur Popup-Id', () => {
  it('räumt die Frist beim Schliessen ab: erneutes Öffnen startet eine NEUE Frist', async () => {
    await mountHost();

    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p1']);

    // Kurz vor Fristende von Hand schliessen …
    vi.advanceTimersByTime(900);
    captured!.closePopup('p1');
    await nextTick();
    expect(renderedPopupIds()).toEqual([]);

    // … und sofort wieder öffnen. Die alte Frist wäre nach 100 ms fällig; sie darf
    // das neu geöffnete Popup NICHT treffen.
    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    await nextTick();
    vi.advanceTimersByTime(300);
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p1']);

    // Die neue Frist läuft dagegen ab, wenn SIE fällig ist (1000 ms nach dem
    // zweiten Öffnen), nicht früher und nicht nie.
    vi.advanceTimersByTime(700);
    await nextTick();
    expect(renderedPopupIds()).toEqual([]);
  });

  it('Gegenrichtung (R7): solange das Popup OFFEN ist, verlängert erneutes Öffnen die Frist nicht', async () => {
    await mountHost();

    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    await nextTick();

    // Erneutes Öffnen kurz vor Fristende — ohne dazwischen zu schliessen.
    vi.advanceTimersByTime(900);
    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p1']);

    // 1000 ms nach dem ERSTEN Öffnen ist Schluss, nicht 1000 ms nach dem zweiten.
    vi.advanceTimersByTime(100);
    await nextTick();
    expect(renderedPopupIds()).toEqual([]);
  });
});

describe('SkinHost — R8: beliebig viele VERSCHIEDENE Popups gleichzeitig', () => {
  it('hält drei Popups gleichzeitig offen, jedes mit eigenem Deskriptor', async () => {
    await mountHost();

    captured!.openPopup({ id: 'p1', autoCloseMs: 1000, modal: true });
    captured!.openPopup({ id: 'p2', autoCloseMs: 3000, position: { x: 5, y: 6, w: 100, h: 80 } });
    captured!.openPopup({ id: 'p3' });
    await nextTick();

    // Alle drei sind offen — anhängen, nicht ersetzen — und jeder Deskriptor
    // kommt unverändert beim Skin an.
    expect(captured!.openPopups).toEqual([
      { id: 'p1', autoCloseMs: 1000, modal: true },
      { id: 'p2', autoCloseMs: 3000, position: { x: 5, y: 6, w: 100, h: 80 } },
      { id: 'p3' },
    ]);
    expect(renderedPopupIds()).toEqual(['p1', 'p2', 'p3']);
  });

  it('jedes der gleichzeitig offenen Popups läuft auf seiner EIGENEN Frist ab', async () => {
    await mountHost();

    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    captured!.openPopup({ id: 'p2', autoCloseMs: 3000 });
    captured!.openPopup({ id: 'p3' }); // ohne Frist: bleibt
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p1', 'p2', 'p3']);

    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p2', 'p3']);

    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p3']);

    // Ohne `autoCloseMs` schliesst nichts von selbst — auch nach langer Zeit.
    vi.advanceTimersByTime(60_000);
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p3']);
  });

  it('das Schliessen eines Popups lässt die Fristen der anderen unberührt', async () => {
    await mountHost();

    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    captured!.openPopup({ id: 'p2', autoCloseMs: 2000 });
    await nextTick();

    captured!.closePopup('p1');
    await nextTick();
    expect(renderedPopupIds()).toEqual(['p2']);

    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(renderedPopupIds()).toEqual([]);
  });
});

describe('SkinHost — stirbt die Komponente, bleibt keine Frist zurück', () => {
  it('räumt beim Unmount die offenen Popups UND ihre Timer ab', async () => {
    await mountHost();
    const store = useDeviceStore();

    captured!.openPopup({ id: 'p1', autoCloseMs: 1000 });
    captured!.openPopup({ id: 'p2', autoCloseMs: 5000 });
    await nextTick();
    expect(store.openPopups).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(2);

    wrapper!.unmount();
    wrapper = null;

    // Kein Zustand einer toten Seite bleibt stehen …
    expect(store.openPopups).toEqual([]);
    // … und kein Timer, der später auf sie feuern könnte (kein Leck).
    expect(vi.getTimerCount()).toBe(0);

    // Nachweis, dass wirklich nichts mehr passiert: die Zeit läuft weiter, der
    // Zustand bleibt leer (ein überlebender Timer würde hier hineinschreiben).
    vi.advanceTimersByTime(10_000);
    expect(store.openPopups).toEqual([]);
  });
});
