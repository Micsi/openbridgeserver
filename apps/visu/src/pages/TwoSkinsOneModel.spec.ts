import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

import de from '../locales/de.json';
import en from '../locales/en.json';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { byId as modelById, rooms as mobileGroups } from '../core/model';
import { activeCtx } from '../core/ctx';
import { pageById, resolvePage } from './pages';

/**
 * A5 · Issue #101 — **the proof of the model**: the same devices under two
 * different skins, out of ONE model, with no data fork.
 *
 * Why this file exists next to OverviewPage.spec / TerminalPage.spec: those two
 * mount one page each, in their own Pinia, and are green independently. Two
 * separately green pages are exactly the weak evidence this issue must not rest
 * on — two forked copies of the model would pass that bar. So here BOTH pages
 * are mounted **at the same time, on the same host store**, and the assertions
 * are about the *shared source*, not about each page's own rendering:
 *
 *  1. Both page definitions name the SAME floor object (`===`, not `toEqual` —
 *     a per-skin copy would satisfy equality but not identity).
 *  2. Both pages put the same device ids on screen in the same order.
 *  3. The two skins really do render differently (else "same output" is trivial).
 *  4. A gesture performed on the terminal page changes what the IONIC page shows
 *     — and the other way round. A fork cannot do this: a second copy of the
 *     model would keep showing the stale value.
 *  5. A canonical host action (no DOM at all) reaches both pages.
 *  6. Neither skin writes into the shared, frozen core model (skins read-only).
 *
 * Ionic web components are not jsdom-friendly, so they are stubbed to plain
 * elements that still render their slots (same pattern as TerminalPage.spec).
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

/** A dimmable light in the first room — the device both skins operate on here. */
const LIGHT = 'kueche-wand';

function makeI18n() {
  return createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de, en } });
}

async function mountPage(pageId: string): Promise<VueWrapper> {
  const wrapper = mount(SkinPage, { props: { pageId }, global: { plugins: [makeI18n()] } });
  await wrapper.vm.$nextTick();
  return wrapper;
}

/** The device ids a page has on screen, in render order (the floor). */
function idsOf(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.skin-host-cell').map((c) => c.attributes('data-id') ?? '');
}

/** The rendered text of one device's cell on a page (skin-specific markup, host text). */
function cellText(wrapper: VueWrapper, id: string): string {
  const cell = wrapper.findAll('.skin-host-cell').find((c) => c.attributes('data-id') === id);
  expect(cell, `no cell for "${id}"`).toBeDefined();
  return cell!.text();
}

/**
 * The state phrase the HOST computes for a device (`ctx.stateText`). Both skins
 * render exactly this string, so it is the one skin-neutral handle on "what the
 * page currently shows about this device" — no skin class name is frozen here.
 */
function hostStateText(id: string): string {
  const store = useDeviceStore();
  return activeCtx().stateText(store.byId(id)!);
}

/** Strip all whitespace — `textContent` glues element boundaries together. */
const squash = (s: string): string => s.replace(/\s+/gu, '');

/**
 * Does a page's cell show the host's current state for this device?
 *
 * Asserted TOKEN BY TOKEN, not as one contiguous string: both skins render the
 * host's `stateText`, but how they cut it into elements — and what they push
 * BETWEEN the pieces — is the skin's business (ionic splits it into a bold word
 * plus a muted rest; the terminal skin wedges its block-bar glyphs between the
 * value and the position word). Pinning the contiguous phrase would pin one
 * skin's markup; pinning its tokens pins the shared host text.
 */
function expectShowsState(wrapper: VueWrapper, id: string): void {
  const shown = squash(cellText(wrapper, id));
  const tokens = hostStateText(id).split(/\s+/u).filter(Boolean);
  expect(tokens.length).toBeGreaterThan(0);
  for (const token of tokens) expect(shown).toContain(token);
}

/** Trigger the canonical action a skin marked on a device's cell (host maps it). */
async function tapAction(wrapper: VueWrapper, id: string, action = 'toggle'): Promise<void> {
  const cell = wrapper.findAll('.skin-host-cell').find((c) => c.attributes('data-id') === id);
  expect(cell, `no cell for "${id}"`).toBeDefined();
  // Address the MARKER, not its position: which element carries `data-action` is
  // the skin's business (the terminal skin moved it from the row to an explicit
  // command). The host is what maps the tap to the canonical store write.
  const marker = cell!.find(`[data-action="${action}"]`);
  expect(marker.exists(), `no [data-action="${action}"] in cell "${id}"`).toBe(true);
  await marker.trigger('click');
  await nextTick();
}

describe('A5 — two skins, one model (Issue #101)', () => {
  let ionic: VueWrapper;
  let terminal: VueWrapper;

  beforeEach(async () => {
    // ONE Pinia → ONE host store for both pages. Seeded exactly once: neither
    // page gets its own seed, so there is nothing to fork from.
    setActivePinia(createPinia());
    await useDeviceStore().init(new MockDataSource());
    ionic = await mountPage('overview');
    terminal = await mountPage('terminal');
  });

  it('both page definitions name the SAME floor object (identity, not equality)', () => {
    expect(pageById['overview'].skin).toBe('ionic');
    expect(pageById['terminal'].skin).toBe('terminal');
    // The no-data-fork guarantee in one `===`: a per-skin copy would pass
    // `toEqual` and fail here.
    expect(pageById['terminal'].groups).toBe(pageById['overview'].groups);
    expect(pageById['overview'].groups).toBe(mobileGroups);
    expect(resolvePage('terminal').groups).toBe(resolvePage('overview').groups);
  });

  it('puts the same devices on screen, in the same order, under both skins', () => {
    const floor = mobileGroups.flatMap((g) => g.entries.map((e) => e.id));
    expect(idsOf(ionic)).toEqual(floor);
    expect(idsOf(terminal)).toEqual(floor);
  });

  it('renders them through genuinely DIFFERENT skins (else "same" would be trivial)', () => {
    expect(ionic.find('.skin-host-model-grid').exists()).toBe(true);
    expect(terminal.find('.skin-host-model-list').exists()).toBe(true);
    // ionic draws Glass tiles, terminal draws list rows — neither borrows the other.
    expect(ionic.find('.vz-tile').exists()).toBe(true);
    expect(ionic.find('.t-row').exists()).toBe(false);
    expect(terminal.find('.t-row').exists()).toBe(true);
    expect(terminal.find('.vz-tile').exists()).toBe(false);
  });

  it('a gesture on the TERMINAL page changes what the IONIC page shows (no fork)', async () => {
    const store = useDeviceStore();
    const before = { ionic: cellText(ionic, LIGHT), terminal: cellText(terminal, LIGHT) };
    expect((store.byId(LIGHT) as { on?: boolean }).on).toBe(false);
    // both pages currently show the same host-computed state phrase
    expectShowsState(ionic, LIGHT);
    expectShowsState(terminal, LIGHT);

    await tapAction(terminal, LIGHT);

    expect((store.byId(LIGHT) as { on?: boolean }).on).toBe(true);
    const after = { ionic: cellText(ionic, LIGHT), terminal: cellText(terminal, LIGHT) };
    // The page that was NEVER touched moved with it — that is the whole claim.
    expect(after.ionic).not.toBe(before.ionic);
    expect(after.terminal).not.toBe(before.terminal);
    expectShowsState(ionic, LIGHT);
    expectShowsState(terminal, LIGHT);
  });

  it('…and the other way round: a gesture on the IONIC page moves the TERMINAL page', async () => {
    const store = useDeviceStore();
    await tapAction(ionic, LIGHT); // on
    expect((store.byId(LIGHT) as { on?: boolean }).on).toBe(true);
    const midTerminal = cellText(terminal, LIGHT);
    expectShowsState(terminal, LIGHT);

    await tapAction(ionic, LIGHT); // off again
    expect((store.byId(LIGHT) as { on?: boolean }).on).toBe(false);
    expect(cellText(terminal, LIGHT)).not.toBe(midTerminal);
    expectShowsState(terminal, LIGHT);
  });

  it('a canonical host action (no DOM) reaches both pages at once', async () => {
    const store = useDeviceStore();
    const blind = 'kueche-roll';
    const before = { ionic: cellText(ionic, blind), terminal: cellText(terminal, blind) };

    // A value no fixture carries, written through the host action layer only.
    store.setPosition(blind, 37);
    await nextTick();

    expect(cellText(ionic, blind)).not.toBe(before.ionic);
    expect(cellText(terminal, blind)).not.toBe(before.terminal);
    expectShowsState(ionic, blind);
    expectShowsState(terminal, blind);
    expect(cellText(ionic, blind)).toContain('37');
    expect(cellText(terminal, blind)).toContain('37');
  });

  it('neither skin writes into the shared core model (skins read-only)', async () => {
    // The static model is the seed, the store owns the live state. After driving
    // both skins, the shared floor and the seed device must be untouched and
    // still frozen — no skin ever wrote `d.on = …` into the model.
    const floorBefore = JSON.stringify(mobileGroups);
    const seedLight = JSON.stringify(modelById[LIGHT]);

    await tapAction(terminal, LIGHT);
    await tapAction(ionic, LIGHT);

    expect(JSON.stringify(mobileGroups)).toBe(floorBefore);
    expect(JSON.stringify(modelById[LIGHT])).toBe(seedLight);
    expect(Object.isFrozen(mobileGroups)).toBe(true);
  });
});
