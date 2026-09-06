import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, reactive, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';

import de from '../locales/de.json';
import en from '../locales/en.json';

/**
 * app/AppShell — the idle return to the start page (A7, Issue #144).
 *
 * The shell is the host layer that owns the idle timer AND the navigation, so
 * this is where the two halves meet: after the configured span the shell moves
 * to the page the definitions mark as `home`, through the canonical host
 * navigation (`store.navigate` + the routed half), and it leaves no dialog open
 * behind it. Already being on the start page is a no-op — a wall panel must not
 * re-push its own route every N seconds.
 *
 * Ionic web components are not jsdom-friendly; stub them like AppShell.spec.ts.
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
    IonButtons: passthrough('ion-buttons'),
    IonMenuButton: passthrough('ion-menu-button'),
    menuController: { close: vi.fn().mockResolvedValue(undefined) },
  };
});

import AppShell from './AppShell.vue';
import { SHELL_CONTEXT_KEY, type ShellContext } from './shell/shellContext';
import { useAppSettings, reloadAppSettings } from './appSettings';
import { homePage } from '../pages/pages';
import { useDeviceStore } from '../core/store';

const BlankPage = defineComponent({ name: 'BlankPage', setup: () => () => h('div') });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    // Route names ARE page ids (router.ts) — the start page among them.
    routes: [
      { path: '/', name: 'overview', component: BlankPage },
      { path: '/terminal', name: 'terminal', component: BlankPage },
    ],
  });
}

/**
 * Every shell mounted in a test, so it can be torn down even when the test does
 * NOT reach its own `unmount()`.
 *
 * A trailing `wrapper.unmount()` inside the test body is skipped the moment an
 * assertion above it fails — and this component listens on `document` and watches
 * the module-level app setting, so the survivor keeps arming timers inside the
 * NEXT test and masks what really broke. Measured, not feared: a probe run with a
 * deliberately failing test made a following test that mounts nothing at all
 * report two pending timers ("expected 2 to be +0").
 */
const mounted: { unmount(): void }[] = [];

async function mountShell(router: Router, ctx: ShellContext) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de, en } });
  const wrapper = mount(AppShell, {
    global: {
      plugins: [i18n, pinia, router],
      provide: { [SHELL_CONTEXT_KEY as symbol]: ctx },
    },
  });
  mounted.push(wrapper);
  await nextTick();
  return wrapper;
}

/** Tear down every shell this test mounted, whether or not the test got that far. */
function unmountAll(): void {
  while (mounted.length) mounted.pop()?.unmount();
}

describe('AppShell — idle return to the start page (A7, #144)', () => {
  let router: Router;
  let ctx: ShellContext;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    reloadAppSettings();
    ctx = reactive<ShellContext>({});
    router = makeRouter();
    await router.push('/terminal');
    await router.isReady();
  });

  afterEach(() => {
    unmountAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does nothing at all while the setting is at its default (off)', async () => {
    await mountShell(router, ctx);
    const push = vi.spyOn(router, 'push');

    vi.advanceTimersByTime(60 * 60 * 1000);
    await nextTick();

    expect(push).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('terminal');
  });

  it('navigates to the declared start page after the configured span', async () => {
    useAppSettings().setIdleReturnHomeSeconds(60);
    await mountShell(router, ctx);

    vi.advanceTimersByTime(59_999);
    await nextTick();
    expect(router.currentRoute.value.name).toBe('terminal');

    vi.advanceTimersByTime(1);
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(router.currentRoute.value.name).toBe(homePage().id);
    // The canonical host navigation state moved too — not just the URL.
    expect(useDeviceStore().currentPageId).toBe(homePage().id);
  });

  it('an interaction before the span elapses cancels the return', async () => {
    useAppSettings().setIdleReturnHomeSeconds(60);
    await mountShell(router, ctx);

    vi.advanceTimersByTime(50_000);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(50_000);
    await nextTick();

    expect(router.currentRoute.value.name).toBe('terminal');
  });

  it('is a no-op on the start page itself — no push, no reload, no flicker', async () => {
    await router.push('/');
    useAppSettings().setIdleReturnHomeSeconds(60);
    await mountShell(router, ctx);
    const push = vi.spyOn(router, 'push');

    vi.advanceTimersByTime(60_000);
    await nextTick();

    expect(push).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('overview');
  });

  it('closes an open detail/modal on the way back', async () => {
    useAppSettings().setIdleReturnHomeSeconds(60);
    const closeOverlays = vi.fn();
    ctx.closeOverlays = closeOverlays;
    await mountShell(router, ctx);

    vi.advanceTimersByTime(60_000);
    await nextTick();

    expect(closeOverlays).toHaveBeenCalledTimes(1);
  });

  it('closes an open detail/modal even when already on the start page', async () => {
    // "No-op on the start page" means no route push — but a panel resting on the
    // start page with a dialog still open is not the defined state A7 is for.
    await router.push('/');
    useAppSettings().setIdleReturnHomeSeconds(60);
    const closeOverlays = vi.fn();
    ctx.closeOverlays = closeOverlays;
    await mountShell(router, ctx);
    const push = vi.spyOn(router, 'push');

    vi.advanceTimersByTime(60_000);
    await nextTick();

    expect(closeOverlays).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('stops the timer when the shell is torn down', async () => {
    useAppSettings().setIdleReturnHomeSeconds(60);
    const wrapper = await mountShell(router, ctx);
    const push = vi.spyOn(router, 'push');

    // The deliberate mid-test teardown IS the subject here.
    wrapper.unmount();
    vi.advanceTimersByTime(60 * 60 * 1000);
    await nextTick();

    // Nothing navigated after the shell went away — no timer outlived it.
    // (`currentRoute` itself resets to the START location on app unmount, so the
    // navigation attempt is what is asserted here, not the route.)
    expect(push).not.toHaveBeenCalled();
    expect(useDeviceStore().currentPageId).toBeNull();
  });
});

describe('AppShell — the return keeps working (A7, #144 regression)', () => {
  let router: Router;
  let ctx: ShellContext;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    reloadAppSettings();
    ctx = reactive<ShellContext>({});
    router = makeRouter();
    await router.push('/terminal');
    await router.isReady();
  });

  afterEach(() => {
    unmountAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('offers the setting inside the REAL shell menu (the "einstellbar" criterion)', async () => {
    // A7 asks for the setting to be adjustable "in der Visu-Oberfläche". The
    // panel having its own passing spec proves nothing about that — it has to be
    // reachable from the shell the app actually mounts.
    const wrapper = await mountShell(router, ctx);

    const field = wrapper.find('ion-menu input.settings-idle-seconds');
    expect(field.exists()).toBe(true);
    expect(wrapper.find('ion-menu .settings-panel').exists()).toBe(true);
  });

  it('trusts the HOST state, not the route, on an external floor', async () => {
    // The other half of the floor decision. With a live backend tree the page ids
    // are tree nodes, not routes: a link jump moves `currentPageId` while the URL
    // stays put. Here the URL sits ON the start page while the host is elsewhere —
    // so a shell that asked the route first would call it a no-op and strand the
    // panel on the backend page forever.
    await router.push('/');
    useAppSettings().setIdleReturnHomeSeconds(60);
    await mountShell(router, ctx);

    const store = useDeviceStore();
    store.externalFloor = true;
    store.navigate('backend-node-17');

    vi.advanceTimersByTime(60_000);
    await nextTick();

    expect(store.currentPageId).toBe(homePage().id);
  });

  it('returns home AGAIN after a router-only navigation', async () => {
    useAppSettings().setIdleReturnHomeSeconds(60);
    await mountShell(router, ctx);

    vi.advanceTimersByTime(60_000);
    await vi.runOnlyPendingTimersAsync();
    await nextTick();
    expect(router.currentRoute.value.name).toBe('overview');

    // The browser's own Back button, and opening a deep URL directly: with
    // `createWebHistory` (router.ts) both are plain router navigations, and
    // neither writes `store.currentPageId`.
    await router.push('/terminal');
    expect(router.currentRoute.value.name).toBe('terminal');

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(60_000);
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(router.currentRoute.value.name).toBe('overview');
  });
});

describe('AppShell — the kiosk case A7 exists for (A7, #144)', () => {
  let router: Router;
  let ctx: ShellContext;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    reloadAppSettings();
    ctx = reactive<ShellContext>({});
    router = makeRouter();
    await router.push('/terminal');
    await router.isReady();
  });

  afterEach(() => {
    unmountAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns home while a BACKEND-driven value keeps changing and nobody is there', async () => {
    // The wall panel, an hour after the last person left, with a light detail
    // still open. The device keeps changing from outside (a poll every 4 s —
    // obs-datasource.ts:109), and every such patch re-renders the open detail,
    // which rewrites `ion-range`'s `value` PROP, which makes @ionic/core emit a
    // bubbling, composed `ionInput` from its watcher (verified in the shipped
    // components/ion-range.js). None of that is a person. The return must fall.
    useAppSettings().setIdleReturnHomeSeconds(60);
    await mountShell(router, ctx);

    for (let elapsed = 0; elapsed < 60 * 60 * 1000; elapsed += 4000) {
      document.body.dispatchEvent(new Event('ionInput', { bubbles: true }));
      vi.advanceTimersByTime(4000);
    }
    // NO trailing timer flush here on purpose: flushing whatever is still pending
    // would fire the span after the fact and paper over exactly the defect. The
    // question is whether the return fell DURING the hour, and `advanceTimersByTime`
    // already ran every timer that came due inside the loop.
    await nextTick();

    expect(useDeviceStore().currentPageId).toBe(homePage().id);
  });
});
