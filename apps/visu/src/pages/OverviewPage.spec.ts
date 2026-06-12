import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

import de from '../locales/de.json';
import en from '../locales/en.json';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { rooms as modelRooms } from '../core/model';

/**
 * pages/OverviewPage — the room-grouped mobile overview (M2, the first Ionic page).
 *
 * The sichtbare M2-Deliverable: mounts without error, renders one tile per
 * `mobileGroups` item (order + grouping as the floor) through the ionic skin, and
 * carries the core widget types (light/blind/jalousie/sensor/scene/switch). Ionic
 * web components are not jsdom-friendly, so they are stubbed to plain elements
 * that still render their slots (same pattern as AppShell.spec).
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

import OverviewPage from './OverviewPage.vue';
import AppShell from '../app/AppShell.vue';
import { provideShellContext } from '../app/shell/shellContext';

function makeI18n(locale = 'de') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'de', messages: { de, en } });
}

/**
 * Mount the page through the real app-level composition (#118): App.vue mounts
 * the single AppShell and provides the shared shell context; the routed page
 * renders its body inside the shell. We mirror that here — provide the context,
 * render the page inside AppShell's body slot — so the integration (one ion-app,
 * the page writing chrome to the shell, the shell-provided roomDivider reaching
 * SkinHost) is exercised end to end. `slots` lets a test inject a skin override.
 */
function mountInApp(slots: Record<string, string> = {}) {
  const Root = defineComponent({
    components: { AppShell, OverviewPage },
    setup() {
      const ctx = provideShellContext();
      return { ctx };
    },
    template: `
      <AppShell with-router-outlet :title="ctx.title" :state="ctx.state" :root-bind="ctx.rootBind">
        <template #default><OverviewPage /></template>
        ${slots.roomDivider ? `<template #roomDivider="p">${slots.roomDivider}</template>` : ''}
      </AppShell>`,
  });
  return mount(Root, { global: { plugins: [makeI18n()] } });
}

/** Total devices referenced across the room groups (the floor item count). */
function totalGroupItems(): number {
  return modelRooms.reduce((n, g) => n + g.entries.length, 0);
}

async function seedStore(): Promise<void> {
  const store = useDeviceStore();
  await store.init(new MockDataSource());
}

async function mountOverview() {
  const wrapper = mount(OverviewPage, { global: { plugins: [makeI18n()] } });
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('OverviewPage — mounts and renders the room-grouped overview', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('mounts without error and renders only the page body (no nested ion-app, #118)', async () => {
    await seedStore();
    const wrapper = await mountOverview();
    expect(wrapper.exists()).toBe(true);
    // The page renders ONLY its body — the ion-app shell is mounted once at app
    // level (App.vue), never by the page. A nested ion-app here was the #118 bug.
    expect(wrapper.find('ion-app').exists()).toBe(false);
    // the skin grid (the page's actual content) is present
    expect(wrapper.find('.skin-host').exists()).toBe(true);
  });

  it('renders one tile per mobileGroups item (order + grouping as the floor)', async () => {
    await seedStore();
    const wrapper = await mountOverview();
    const cells = wrapper.findAll('.skin-host-cell');
    expect(cells.length).toBe(totalGroupItems());
    expect(cells.length).toBeGreaterThanOrEqual(modelRooms.length);
  });

  it('renders one grid per room block (grouping is part of the floor)', async () => {
    await seedStore();
    const wrapper = await mountOverview();
    // Each room block is its own grid (clean rows + room separation).
    const roomGrids = wrapper.findAll('.skin-host-model-grid');
    expect(roomGrids.length).toBe(modelRooms.length);
    expect(roomGrids[0].attributes('data-group')).toBe(modelRooms[0].room);
    // first cell belongs to the first room block, in source order
    const first = wrapper.find('.skin-host-cell');
    expect(first.attributes('data-group')).toBe(modelRooms[0].room);
  });

  it('renders the core mobile widget types via the ionic skin (type-addressed)', async () => {
    await seedStore();
    const wrapper = await mountOverview();
    // The v1 mobile model (mobileGroups) carries light · switch · blind · jalousie.
    // Each is rendered by the ionic skin's type-addressed renderer; assert the
    // skin's per-type markup is present (a missing type would have thrown a gap).
    expect(wrapper.find('.vz-tile[data-type="light"]').exists()).toBe(true); // light
    expect(wrapper.find('.vz-tile[data-type="switch"]').exists()).toBe(true); // switch
    expect(wrapper.find('.vz-tile.blind').exists()).toBe(true); // blind
    expect(wrapper.find('.jal-body').exists()).toBe(true); // jalousie
  });

  it('tapping a tile dispatches its canonical action to the store (data-id wiring)', async () => {
    // Regression: the host resolves the tapped tile's device id from the cell's
    // data-id (OverviewGrid → tileIdFor → cell.dataset.id). When that attribute
    // was missing, every tap resolved no id and silently no-op'd — taps did
    // nothing although the markup rendered fine. Guard the full gesture → store path.
    await seedStore();
    const store = useDeviceStore();
    const wrapper = await mountOverview();

    const id = 'kueche-wand'; // first mobile light (Wandleuchten), starts off
    const lightOn = () => (store.byId(id) as { on?: boolean } | undefined)?.on;
    expect(lightOn()).toBe(false);

    // every cell must carry its device id for the gesture mapping to work
    const cell = wrapper.findAll('.skin-host-cell').find((c) => c.attributes('data-id') === id);
    expect(cell).toBeDefined();

    // tap the light tile → the host dispatches `toggle` onto the core store
    await cell!.find('[data-type="light"]').trigger('click');
    expect(lightOn()).toBe(true);
  });

  it('exposes the ionic tweak controls when the panel is opened (A6, page owns values)', async () => {
    await seedStore();
    const wrapper = await mountOverview();
    expect(wrapper.find('.tweaks-panel').exists()).toBe(false);
    await wrapper.find('.overview-tweaks-toggle').trigger('click');
    expect(wrapper.find('.tweaks-panel').exists()).toBe(true);
    // the panel renders the ionic skin's declared tweaks (stil/accentStyle/…)
    expect(wrapper.find('[data-tweak="stil"]').exists()).toBe(true);
  });
});

describe('OverviewPage — app-level shell composition (#118 / #116)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('mounts exactly ONE ion-app for the whole app (no nested shell, #118)', async () => {
    await seedStore();
    const wrapper = mountInApp();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('ion-app')).toHaveLength(1);
    // the page body still rendered inside the single shell
    expect(wrapper.find('.skin-host').exists()).toBe(true);
  });

  it('flows the page title into the app-level shell header (per-page context)', async () => {
    await seedStore();
    const wrapper = mountInApp();
    await wrapper.vm.$nextTick();
    // the page wrote pages.overview.title into the shared shell context; the
    // header shows it (not a stale nav label).
    expect(wrapper.find('.shell-header-title').text()).toBe(de.pages.overview.title);
  });

  it('renders the default RoomDivider per room block when no override is given (#116)', async () => {
    await seedStore();
    const wrapper = mountInApp();
    await wrapper.vm.$nextTick();
    const dividers = wrapper.findAll('.room-divider');
    expect(dividers.length).toBe(modelRooms.length);
    expect(dividers[0].find('.room-divider-name').text()).toBe(modelRooms[0].room);
  });

  it('a #roomDivider skin override actually replaces the default (#116)', async () => {
    await seedStore();
    const wrapper = mountInApp({
      roomDivider: `<span class="skin-divider">{{ p.room }}#{{ p.count }}</span>`,
    });
    await wrapper.vm.$nextTick();
    // the override took effect — the default divider is gone, the skin one renders
    expect(wrapper.find('.room-divider').exists()).toBe(false);
    const overrides = wrapper.findAll('.skin-divider');
    expect(overrides.length).toBe(modelRooms.length);
    expect(overrides[0].text()).toBe(`${modelRooms[0].room}#${modelRooms[0].entries.length}`);
  });
});
