import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

import de from '../locales/de.json';
import en from '../locales/en.json';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { resolvePage } from './pages';

/**
 * pages/SkinPage as the terminal page (A5, Issue #101).
 *
 * The SAME generic page component, driven by the `terminal` PageDef, renders the
 * core devices as the terminal skin's LIST ROWS (`.t-row`) instead of the ionic
 * Glass tiles. This pins the A5 promise from the page side: identical core data,
 * a different skin, addressed by the def's skin key. Ionic web components are not
 * jsdom-friendly, so they are stubbed to plain elements that still render their
 * slots (same pattern as OverviewPage.spec / AppShell.spec).
 */
vi.mock('@ionic/vue', () => {
  const passthrough = (tag: string) =>
    defineComponent({
      name: tag,
      setup(_props, { slots }) {
        return () => h(tag, {}, slots.default ? slots.default() : []);
      },
    });
  return {
    IonApp: passthrough('ion-app'),
    IonContent: passthrough('ion-content'),
    IonHeader: passthrough('ion-header'),
    IonMenu: passthrough('ion-menu'),
    IonList: passthrough('ion-list'),
    IonItem: passthrough('ion-item'),
    IonLabel: passthrough('ion-label'),
    IonPage: passthrough('ion-page'),
    IonRouterOutlet: passthrough('ion-router-outlet'),
    IonToolbar: passthrough('ion-toolbar'),
    IonTitle: passthrough('ion-title'),
    IonModal: passthrough('ion-modal'),
    IonButtons: passthrough('ion-buttons'),
    IonMenuButton: passthrough('ion-menu-button'),
    menuController: { close: vi.fn().mockResolvedValue(undefined) },
  };
});

import SkinPage from './SkinPage.vue';

function makeI18n(locale = 'de') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'de', messages: { de, en } });
}

/** Total devices the terminal page resolves (the floor item count). */
function terminalItemCount(): number {
  return resolvePage('terminal').groups.reduce((n, g) => n + g.entries.length, 0);
}

async function seedStore(): Promise<void> {
  const store = useDeviceStore();
  await store.init(new MockDataSource());
}

async function mountPage(pageId: string) {
  const wrapper = mount(SkinPage, {
    props: { pageId },
    global: { plugins: [makeI18n()] },
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('SkinPage(terminal) — renders the devices through the terminal skin', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('mounts without error and renders the terminal list model (not a grid)', async () => {
    await seedStore();
    const wrapper = await mountPage('terminal');
    expect(wrapper.exists()).toBe(true);
    // terminal's manifest.layout.model === 'list' → the host renders a flat list.
    expect(wrapper.find('.skin-host-model-list').exists()).toBe(true);
    expect(wrapper.find('.skin-host-model-grid').exists()).toBe(false);
  });

  it('renders one list ROW per device through the terminal skin (type-addressed)', async () => {
    await seedStore();
    const wrapper = await mountPage('terminal');

    // one host cell per resolved device (order + grouping as the floor)
    const cells = wrapper.findAll('.skin-host-cell');
    expect(cells.length).toBe(terminalItemCount());

    // the terminal skin renders each device as a `.t-row` list line (not a tile)
    const rows = wrapper.findAll('.t-row');
    expect(rows.length).toBe(terminalItemCount());
    expect(wrapper.find('.vz-tile').exists()).toBe(false);

    // the core mobile types are present, addressed by type through the terminal skin
    expect(wrapper.find('.t-row[data-type="light"]').exists()).toBe(true);
    expect(wrapper.find('.t-row[data-type="switch"]').exists()).toBe(true);
    expect(wrapper.find('.t-row[data-type="blind"]').exists()).toBe(true);
    expect(wrapper.find('.t-row[data-type="jalousie"]').exists()).toBe(true);
  });

  it('tapping a terminal light row dispatches its canonical action to the store', async () => {
    await seedStore();
    const store = useDeviceStore();
    const wrapper = await mountPage('terminal');

    const id = 'kueche-wand'; // first mobile light (Wandleuchten), starts off
    const lightOn = () => (store.byId(id) as { on?: boolean } | undefined)?.on;
    expect(lightOn()).toBe(false);

    const cell = wrapper.findAll('.skin-host-cell').find((c) => c.attributes('data-id') === id);
    expect(cell).toBeDefined();

    // the terminal light row carries data-action="toggle"; the host maps the tap.
    await cell!.find('[data-type="light"]').trigger('click');
    expect(lightOn()).toBe(true);
  });

  it('shows no tweaks toggle for the terminal skin (it declares no tweaks)', async () => {
    await seedStore();
    const wrapper = await mountPage('terminal');
    // terminal manifest has no `tweaks` → the page offers no tweak editor.
    expect(wrapper.find('.overview-tweaks-toggle').exists()).toBe(false);
  });
});

describe('SkinPage(overview) — ionic page stays green (A5 regression)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders the ionic Glass tiles in a grid (not terminal rows)', async () => {
    await seedStore();
    const wrapper = await mountPage('overview');
    expect(wrapper.find('.skin-host-model-grid').exists()).toBe(true);
    expect(wrapper.find('.skin-host-model-list').exists()).toBe(false);
    expect(wrapper.find('.vz-tile[data-type="light"]').exists()).toBe(true);
    expect(wrapper.find('.t-row').exists()).toBe(false);
    // ionic declares tweaks → the editor toggle is offered
    expect(wrapper.find('.overview-tweaks-toggle').exists()).toBe(true);
  });
});
