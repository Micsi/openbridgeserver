import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick, type VNode } from 'vue';
import type { PageHost } from '@obs/visu-contract';

/**
 * skin-host/SkinHost — Unmount einer Seite darf nur ABRÄUMEN, was SIE SELBST
 * geöffnet hat (Micsi/openbridgeserver#180).
 *
 * `openPopups` liegt im Store, dem einzigen Zustandsbesitzer (golden rule 4) -
 * und genau das machte den ursprünglichen `onBeforeUnmount(() =>
 * store.closeAllPopups())` gefährlich: sind zwei `SkinHost`-Instanzen
 * gleichzeitig gemountet (der Ionic-Outlet hält eine verlassende Seite für ihre
 * Übergangsanimation lebendig, s. `pages/SkinPage.vue`), räumt das Unmount der
 * EINEN auch die offenen Popups der ANDEREN mit ab, weil `closeAllPopups()`
 * unterschiedslos JEDEN Eintrag der gemeinsamen Liste löscht.
 *
 * Diese Datei belegt BEIDE Seiten der Reparatur:
 *  - eine fremde Instanz unmounten lässt "meine" offenen Popups unberührt,
 *  - die EIGENE Instanz unmounten räumt weiterhin alles ab, was SIE öffnete
 *    (kein Leck - das bereits von `SkinHost.popup.spec.ts` belegte Verhalten).
 *
 * Zwei Instanzen brauchen zwei eingefangene `PageHost`s; die vorhandenen
 * Popup-Spezifikationen fangen nur EINEN globalen `captured` ein, hier also ein
 * Array, in Mount-Reihenfolge gefüllt.
 */
const capturedHosts: PageHost[] = [];
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
      capturedHosts.push(host);
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

let wrapperA: VueWrapper | null = null;
let wrapperB: VueWrapper | null = null;

async function mountTwo(): Promise<{ a: PageHost; b: PageHost }> {
  await useDeviceStore().init(new MockDataSource([]));
  wrapperA = mount(SkinHost, { props: { skin: 'edomi-stub', groups: [], theme: 'light' } });
  wrapperB = mount(SkinHost, { props: { skin: 'edomi-stub', groups: [], theme: 'light' } });
  // `page:` lief für beide Mounts, in Reihenfolge — der letzte Render je Instanz
  // ist ihr aktueller Host, aber jede Instanz rendert nur EINMAL initial hier.
  return { a: capturedHosts[0], b: capturedHosts[1] };
}

beforeEach(() => {
  setActivePinia(createPinia());
  capturedHosts.length = 0;
});

afterEach(() => {
  wrapperA?.unmount();
  wrapperB?.unmount();
  wrapperA = null;
  wrapperB = null;
});

describe('SkinHost — Unmount schliesst nur die eigenen Popups (#180)', () => {
  it('räumt beim Unmount der EINEN Instanz die Popups der ANDEREN nicht ab', async () => {
    const { a, b } = await mountTwo();
    const store = useDeviceStore();

    a.openPopup({ id: 'from-a' });
    b.openPopup({ id: 'from-b' });
    await nextTick();
    expect(store.openPopups.map((p) => p.id).sort()).toEqual(['from-a', 'from-b']);

    wrapperA!.unmount();
    wrapperA = null;
    await nextTick();

    // "from-a" ist mit der Seite gestorben, "from-b" gehört einer LEBENDEN
    // Seite und darf nicht mit verschwinden.
    expect(store.openPopups.map((p) => p.id)).toEqual(['from-b']);
  });

  it('räumt beim eigenen Unmount weiterhin ALLES ab, was diese Instanz öffnete (kein Leck)', async () => {
    const { a, b } = await mountTwo();
    const store = useDeviceStore();

    a.openPopup({ id: 'a1' });
    a.openPopup({ id: 'a2' });
    b.openPopup({ id: 'b1' });
    await nextTick();
    expect(store.openPopups).toHaveLength(3);

    wrapperA!.unmount();
    wrapperA = null;
    await nextTick();

    expect(store.openPopups.map((p) => p.id)).toEqual(['b1']);

    wrapperB!.unmount();
    wrapperB = null;
    await nextTick();

    expect(store.openPopups).toEqual([]);
  });
  /**
   * Die Buchfuehrung muss beim Schliessen auch WIEDER VERGESSEN. Sonst haelt
   * eine Instanz eine laengst abgegebene Id fest und reisst beim Unmount ein
   * Popup mit, das inzwischen einer ANDEREN Seite gehoert - derselbe Fehler wie
   * #180, nur eine Windung spaeter und darum schwerer zu sehen.
   */
  it('vergisst eine wieder geschlossene Id, sodass ihr Unmount ein FREMD geoeffnetes Popup gleicher Id verschont', async () => {
    const { a, b } = await mountTwo();
    const store = useDeviceStore();

    a.openPopup({ id: 'shared' });
    await nextTick();
    a.closePopup('shared');
    await nextTick();
    expect(store.openPopups).toEqual([]);

    // Dieselbe Id, neu geoeffnet - sie gehoert jetzt B.
    b.openPopup({ id: 'shared' });
    await nextTick();
    expect(store.openPopups.map((p) => p.id)).toEqual(['shared']);

    wrapperA!.unmount();
    wrapperA = null;
    await nextTick();

    expect(store.openPopups.map((p) => p.id)).toEqual(['shared']);
  });
});
