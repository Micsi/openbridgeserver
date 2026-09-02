import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

import de from '../locales/de.json';
import en from '../locales/en.json';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { byId } from '../core/model';
import { resolveSkin } from '../skin-host/skins';
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
    IonPopover: passthrough('ion-popover'),
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

/** Split the terminal floor into skin-rendered vs. declared-unsupported item counts.
 *  Whatever the skin declares `unsupported` renders as the host's quiet
 *  placeholder (a declared gap); everything else renders as a `.t-row`. Derived
 *  from the manifest, so this tracks the skin instead of freezing one release. */
function terminalRenderSplit(): { rows: number; unsupported: number } {
  const ids = resolvePage('terminal').groups.flatMap((g) => g.entries.map((e) => e.id));
  const skipped = terminalUnsupported();
  const unsupported = ids.filter((id) => skipped.has(byId[id]!.type)).length;
  return { rows: ids.length - unsupported, unsupported };
}

/** The core types the terminal skin declares as unsupported (may be empty). */
function terminalUnsupported(): Set<string> {
  return new Set<string>(resolveSkin('terminal').manifest.unsupported);
}

/** The distinct device types the terminal page actually puts on screen. */
function terminalTypesOnPage(): string[] {
  const ids = resolvePage('terminal').groups.flatMap((g) => g.entries.map((e) => e.id));
  return [...new Set(ids.map((id) => byId[id]!.type))].sort();
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

    // the terminal skin renders each supported device as a `.t-row` list line (not a
    // tile); the media/camera it declares unsupported render a quiet placeholder.
    const split = terminalRenderSplit();
    const rows = wrapper.findAll('.t-row');
    expect(rows.length).toBe(split.rows);
    expect(wrapper.findAll('.skin-host-unsupported').length).toBe(split.unsupported);
    expect(wrapper.find('.vz-tile').exists()).toBe(false);

    // Every type on the page is addressed BY TYPE through the terminal skin, and
    // lands on exactly one of the two outcomes: a rendered row, or the host's
    // declared-gap placeholder. Which one is derived from the skin's manifest —
    // naming the types here would freeze one release of the skin into the app's
    // tests (that is how this file went stale when terminal took up media/camera).
    const skipped = terminalUnsupported();
    const typesOnPage = terminalTypesOnPage();
    expect(typesOnPage.length).toBeGreaterThan(0);
    for (const type of typesOnPage) {
      const declaredGap = skipped.has(type);
      expect(wrapper.find(`.skin-host-unsupported[data-type="${type}"]`).exists()).toBe(declaredGap);
      expect(wrapper.find(`.t-row[data-type="${type}"]`).exists()).toBe(!declaredGap);
    }
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

    // The row MARKS the canonical intent and the host maps the tap. Where the
    // marker sits is the skin's business — it used to be on the row itself, the
    // current skin puts it on an explicit `[an]`/`[aus]` command — so address the
    // marker, not its position.
    const toggle = cell!.find('[data-action="toggle"]');
    expect(toggle.exists()).toBe(true);
    await toggle.trigger('click');
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
