<script setup lang="ts">
/**
 * app/AppShell — the Ionic application shell (A3, Issue #99).
 *
 * The host's chrome around the rendered page: an `ion-app` root, a side
 * navigation menu (the top-level sections from `useShellState`, in source
 * order), an optional brand titlebar, the section header (RoomBar), and the
 * scrollable content where the page's tiles live. It owns the shell UI state
 * (active nav · unread · showTitlebar) — the skin owns no state (Goldene Regel
 * 1/4); it only fills the shell's slots.
 *
 * Shell-Slots v1 — each has a host default, and a skin/page may override it:
 *   - `background`  decorative backdrop layer behind the content
 *   - `header`      the top bar (default: menu + title + clock pill)
 *   - `roomDivider` the per-group label (default: accent dot + room name + count)
 *   - `empty`       shown when a section has nothing to render
 *   - `error`       shown for a hard failure (unknown skin / render gap)
 *   - default slot  the page body (tiles); the host lays the rooms out as the
 *                   floor (order + grouping), the page/skin renders the tiles.
 *
 * Must-keep (A3): the clock/messages pill pulses on `unread`; the titlebar is
 * optional (`showTitlebar`); the overview is room-grouped — the gap between
 * groups reads as "another room" (Goldene Regel 5). Safe-area insets are wired
 * via CSS `env(safe-area-inset-*)` so notches/home-indicators are respected —
 * measured against emulated device insets in e2e-pwa/safe-areas.spec.ts (#104).
 *
 * Slot props let a skin reuse the host's data without owning it:
 *   - `header`      { title, withClock, unread, markRead } — `markRead` lets a
 *                   custom header acknowledge the unread pulse without reaching
 *                   outside the slot contract (the default header is wired to it).
 *   - `roomDivider` { room, count } — the per-group label. The shell turns this
 *                   named slot into a renderer it `provide`s to the body
 *                   (ROOM_DIVIDER_KEY); SkinHost calls it above each room block,
 *                   so a skin override of `#roomDivider` actually takes effect.
 *                   With no override the default RoomDivider is the fallback.
 */
import { computed, h, inject, provide, ref, useSlots, watch, watchEffect, type ComponentPublicInstance } from 'vue';
import { useI18n } from 'vue-i18n';
import { routerKey } from 'vue-router';
import {
  IonApp,
  IonContent,
  IonHeader,
  IonMenu,
  IonList,
  IonItem,
  IonLabel,
  IonPage,
  IonRouterOutlet,
  IonToolbar,
  IonTitle,
  menuController,
} from '@ionic/vue';

import { useShellState, type NavKey, type ShellStateOptions } from './shell/useShellState';
import ShellHeader from './shell/ShellHeader.vue';
import ShellBackground from './shell/ShellBackground.vue';
import RoomDivider from './shell/RoomDivider.vue';
import ShellEmpty from './shell/ShellEmpty.vue';
import ShellError from './shell/ShellError.vue';
import LoginPanel from './LoginPanel.vue';
import AccessGate from './AccessGate.vue';
import { useShellContext } from './shell/shellContext';
import { ROOM_DIVIDER_KEY, type RoomDividerRenderer } from './shell/roomDivider';
import SettingsPanel from './SettingsPanel.vue';
import { useAppSettings } from './appSettings';
import { useIdleReturnHome } from './useIdleReturnHome';
import { homePage } from '../pages/pages';
import { useDeviceStore } from '../core/store';
import type { RootTweakStyle } from '@obs-visu-skins/ionic';

const props = withDefaults(
  defineProps<{
    /** Seed the host shell state (active section · unread · showTitlebar). */
    state?: ShellStateOptions;
    /** Override the header/section title (already localised). When omitted the
     *  title is derived from the active nav key. A page whose id is not a nav key
     *  (e.g. the terminal page) passes its own resolved title here so the chrome
     *  shows the page, not a stale "Overview". */
    title?: string;
    /** A hard error to surface in the `error` slot (unknown skin / render gap). */
    error?: string | null;
    /** Whether the page body is empty (drives the `empty` slot fallback). */
    empty?: boolean;
    /** Render the embedded `ion-router-outlet` (the app) vs. only the default slot (tests/pages). */
    withRouterOutlet?: boolean;
    /** The page's skin root bindings (data-theme + tweak CSS vars). Applied to the
     *  page so the whole shell — header included — sits inside the themed surface:
     *  toolbars go transparent + themed (ionic.css .visu-root) and the photo/
     *  gradient background spans behind the chrome. */
    rootBind?: RootTweakStyle;
    /** The CSS namespace of the ACTIVE page's skin (`Skin.rootClass`). The shell
     *  page carries it so the chrome sits on the surface of the skin the page
     *  actually uses — `.visu-root` on an ionic page, `.t-root` on the terminal
     *  page. Hardcoding `visu-root` here made the chrome ionic-toned (photo
     *  background, `--ion-*` tokens) on EVERY page, whatever its skin. */
    rootClass?: string;
  }>(),
  {
    state: undefined,
    title: undefined,
    error: null,
    empty: false,
    withRouterOutlet: false,
    rootBind: undefined,
    rootClass: undefined,
  },
);

const { t } = useI18n();
const slots = useSlots();

/** Per-page context from the active routed page (app-level mount). Props win when
 *  given (standalone/test mounting); otherwise the shell reads the active page's
 *  context the page wrote into the shared seam. */
const ctx = useShellContext();
const ctxState = computed<ShellStateOptions | undefined>(() => props.state ?? ctx.state);
const ctxTitle = computed<string | undefined>(() => props.title ?? ctx.title);
const ctxError = computed<string | null>(() => (props.error ?? ctx.error) ?? null);
const ctxEmpty = computed<boolean>(() => props.empty || ctx.empty === true);
const ctxRootBind = computed<RootTweakStyle | undefined>(() => props.rootBind ?? ctx.rootBind);
/** The active page's skin namespace. No page (shell mounted standalone) means no
 *  skin surface — the shell then draws plain Ionic chrome rather than borrowing
 *  one skin's look. */
const ctxRootClass = computed<string | undefined>(() => props.rootClass ?? ctx.rootClass);

/**
 * Apply that namespace ADDITIVELY, not through `:class`.
 *
 * `#app-shell-content` is the menu's content target, and Ionic writes classes on
 * it imperatively (`menu-content`, `menu-content-overlay`, `menu-content-open`).
 * A Vue class BINDING owns the whole attribute: `patchClass` rewrites
 * `el.className` on every change, so the first skin-to-skin route change silently
 * dropped Ionic's classes (measured: `visu-root menu-content menu-content-overlay`
 * → `t-root`). Harmless for `type="overlay"`, immediately visible for
 * `type="push"`/`"reveal"`. So the class attribute stays static and only THIS one
 * token is added/removed on the element — Vue and Ionic stop writing the same
 * attribute. `flush: 'post'` so the element exists on the first run.
 */
const shellPage = ref<ComponentPublicInstance | null>(null);
let appliedRootClass: string | undefined;
watchEffect(
  () => {
    const next = ctxRootClass.value;
    const el = shellPage.value?.$el as HTMLElement | undefined;
    if (!el || appliedRootClass === next) return;
    if (appliedRootClass) el.classList.remove(appliedRootClass);
    if (next) el.classList.add(next);
    appliedRootClass = next;
  },
  { flush: 'post' },
);

const shell = useShellState(ctxState.value);

// Track the active page's nav so the menu highlights the routed page (the shell
// lives once at app level, so its state must follow the routed page's context).
watch(
  () => ctxState.value?.active,
  (active) => {
    if (active) shell.setNav(active);
  },
);

/** Active section title: the page's explicit override, else derived from the
 *  active nav key. Fed to the header slot and the default ShellHeader. */
const activeTitle = computed(() => ctxTitle.value ?? t(`shell.nav.${shell.active.value}`));

/** The per-group divider renderer offered to the body (SkinHost) — the
 *  `#roomDivider` slot override, or the default RoomDivider as fallback content.
 *  This makes the documented `#roomDivider` slot API real (#116). */
const roomDividerRenderer: RoomDividerRenderer = (dividerProps) =>
  slots.roomDivider
    ? slots.roomDivider(dividerProps)
    : h(RoomDivider, dividerProps);
provide(ROOM_DIVIDER_KEY, roomDividerRenderer);

/** Clock pill lives inline in the header only when no brand titlebar is shown. */
const headerWithClock = computed(() => !shell.showTitlebar.value);

/* ------------------------------------- idle return to the start page (A7, #144) */
/**
 * Kiosk behaviour: after a configurable span with no interaction the host puts
 * the panel back into its defined resting state — the page the definitions mark
 * as `home` (`pages.homePage()`), with no dialog left open. Off by default.
 *
 * The two halves are deliberately apart: `useIdleReturnHome` only measures the
 * idle span (Verhalten=Code, no knowledge of pages), and THIS handler is the
 * only place that decides what a timeout means. Skins know nothing of either
 * (Goldene Regel 4) — the timer and the navigation live in the host.
 *
 * The router is injected optionally: the shell also mounts without one (unit
 * tests, and the page-owning-skin path where the host's own `currentPageId` is
 * the truth), and there the return moves the host state alone.
 */
const router = inject(routerKey, null);
const store = useDeviceStore();
const appSettings = useAppSettings();

/**
 * The page the host currently shows — the SAME precedence as
 * `SkinHost.shownPageId()` (skin-host/SkinHost.ts), which asks the routed page
 * FIRST and only then the host's own `currentPageId`.
 *
 * Which of the two is the truth depends on the floor, so the floor decides:
 *
 *  - **Static floor** (`externalFloor === false`, the shipped page definitions):
 *    the ROUTE is the truth. `SkinPage` deliberately does not write
 *    `store.currentPageId` here (SkinPage.vue: the Ionic outlet keeps the leaving
 *    page mounted, so two SkinPages are alive during a transition and a shared
 *    piece of state would race between them) — it hands the routed id down as
 *    `currentPage` instead. Reading `currentPageId` first therefore measured the
 *    wrong thing: the only writers on this floor are `store.followLink` and this
 *    very `returnHome`, so after the FIRST return the value stuck at the start
 *    page forever and every later timeout became a silent no-op — while the
 *    router had long moved on. Two ways that happens, both real in this app
 *    (`router.ts` uses `createWebHistory`, so history entries ARE router
 *    navigations): the browser's own Back/Forward, and opening a deep URL such as
 *    `/visu/terminal` directly. Neither writes `currentPageId`. The Back case was
 *    reproduced in a real browser against the running dev server, and is
 *    regression-tested in AppShell.idle.spec.ts → "returns home AGAIN after a
 *    router-only navigation".
 *  - **External floor** (a live backend tree): `currentPageId` is the truth. The
 *    backend page ids are not routes, so a link jump moves that state while the
 *    URL stays put, and trusting the route name would make the shell believe it
 *    sits on the start page when it does not.
 */
function shownPageId(): string | null {
  const routed = router?.currentRoute.value.name;
  const routedId = typeof routed === 'string' ? routed : null;
  if (store.externalFloor) return store.currentPageId ?? routedId;
  // No router at all (the shell mounted standalone) falls back to the host state.
  return routedId ?? store.currentPageId ?? null;
}

function returnHome(): void {
  // Always leave the page without an open overlay: closing a dialog is not a
  // navigation, so it costs no reload and no flicker even on the start page —
  // and a panel resting on the start page with a detail modal still up is
  // exactly the state A7 exists to prevent.
  ctx.closeOverlays?.();

  // KNOWN LIMIT (deliberate, A7 scope): `homePage()` resolves against the frozen
  // static `PAGES`, so the id it yields is a definition id. Against a live backend
  // tree (`store.externalFloor`) no node carries that id, and the return would
  // write a page id the tree does not know. A7's technical gate is A5 #101
  // (static page definitions) — "which backend node is Home" is not declared
  // anywhere yet, so resolving it is out of this issue's scope rather than
  // something guessed here. Named, not left implicit: when the external floor
  // gains a home marker, THIS is the line that reads it.
  const home = homePage();
  // Already there: no push. Re-pushing the current route every span would be a
  // pointless reload of the start page (the "kein Flackern" requirement).
  if (shownPageId() === home.id) return;

  // The canonical host navigation (`core/store → navigate`), plus the routed
  // half for the statically routed pages — the same two steps the page-link
  // action takes in OverviewGrid.
  store.navigate(home.id);
  if (router?.hasRoute(home.id)) void router.push({ name: home.id });
}

useIdleReturnHome(appSettings.idleReturnHomeSeconds, returnHome);

function selectNav(key: NavKey): void {
  shell.setNav(key);
  void menuController.close();
}

defineExpose({ shell });
</script>

<template>
  <IonApp class="app-shell">
    <!-- Navigation: the top-level sections in source order (the floor). -->
    <IonMenu
      content-id="app-shell-content"
      type="overlay"
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle>{{ t('shell.nav.menuTitle') }}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent class="app-shell-menu-content">
        <IonList>
          <IonItem
            v-for="key in shell.nav"
            :key="key"
            button
            :detail="false"
            :class="{ active: key === shell.active.value }"
            @click="selectNav(key)"
          >
            <IonLabel>{{ t(`shell.nav.${key}`) }}</IonLabel>
          </IonItem>
        </IonList>

        <!-- Opt-in login (Welle L). Guest stays the default: this is an entry,
             never a wall — the nav above works without it. -->
        <LoginPanel />

        <!-- Host settings (A7, #144): the app's own preferences, not skin tweaks. -->
        <SettingsPanel />
      </IonContent>
    </IonMenu>

    <IonPage
      id="app-shell-content"
      ref="shellPage"
      class="app-shell-page"
      v-bind="ctxRootBind?.attrs"
      :style="ctxRootBind?.style"
    >
      <!-- Optional brand titlebar (store.js → showTitlebar). Holds the clock pill
           when shown; otherwise the pill rides in the header below. -->
      <IonHeader
        v-if="shell.showTitlebar.value"
        class="app-shell-titlebar"
      >
        <IonToolbar>
          <IonTitle>{{ t('shell.titlebar.brand') }}</IonTitle>
          <slot
            name="header"
            :title="activeTitle"
            :with-clock="true"
            :unread="shell.unread.value"
            :mark-read="shell.markRead"
          >
            <ShellHeader
              :title="activeTitle"
              :with-clock="true"
              :unread="shell.unread.value"
              @read="shell.markRead"
            />
          </slot>
        </IonToolbar>
      </IonHeader>

      <!-- Section header (RoomBar). Skin may replace via the `header` slot. -->
      <IonHeader
        v-else
        class="app-shell-header"
      >
        <IonToolbar>
          <slot
            name="header"
            :title="activeTitle"
            :with-clock="headerWithClock"
            :unread="shell.unread.value"
            :mark-read="shell.markRead"
          >
            <ShellHeader
              :title="activeTitle"
              :with-clock="headerWithClock"
              :unread="shell.unread.value"
              @read="shell.markRead"
            />
          </slot>
        </IonToolbar>
      </IonHeader>

      <IonContent class="app-shell-content">
        <!-- Decorative backdrop layer (skin may override). -->
        <slot name="background">
          <ShellBackground />
        </slot>

        <div class="app-shell-body">
          <!-- Access gates (Welle 3b): a dezenter PIN/login hint for gated pages.
               Additive and non-blocking: renders nothing for a guest on public
               pages, so it never becomes a wall. -->
          <AccessGate />

          <!-- Hard failure: surfaced loudly, never a silent gap. -->
          <slot
            v-if="ctxError"
            name="error"
            :message="ctxError"
          >
            <ShellError :message="ctxError" />
          </slot>

          <!-- Empty section. -->
          <slot
            v-else-if="ctxEmpty"
            name="empty"
          >
            <ShellEmpty />
          </slot>

          <!-- The page body. The default slot receives the RoomDivider component
               so a page/skin can draw the per-group label with the host default;
               the embedded router outlet is opt-in (the running app). -->
          <template v-else>
            <slot
              :room-divider="RoomDivider"
              :shell="shell"
            />
            <!-- `animated="false"`: the routed pages are in-flow inside the shell's
                 scrolling content (they cannot be the absolutely positioned boxes a
                 slide transition animates without losing the scroll), so an animated
                 push would show BOTH pages stacked for the duration. An instant swap
                 keeps "exactly one page visible" true at every moment. -->
            <IonRouterOutlet
              v-if="withRouterOutlet"
              :animated="false"
            />
          </template>
        </div>
      </IonContent>
    </IonPage>
  </IonApp>
</template>

<style scoped>
/* Safe-area insets — respect notches / home indicators (#104 AC2).
   Measured against emulated device insets in e2e-pwa/safe-areas.spec.ts.

   The HEADERS carry no rule of their own, and that is deliberate. Ionic derives
   `--ion-safe-area-*` from `env()` on `html` (@ionic/core/css/core.css) and then
   spends them in two DIFFERENT rules — worth naming exactly, because the top
   inset does NOT come from the toolbar's own stylesheet:
     - top:        `ion-header ion-toolbar:first-of-type { padding-top: var(--ion-safe-area-top, 0) }`
                   (…/collection/components/header/header.md.css:65) — a descendant
                   rule of the HEADER, which is why it covers `.app-shell-titlebar` too;
     - left/right: `ion-toolbar { padding-left/right: var(--ion-safe-area-left/right) }`
                   (…/collection/components/toolbar/toolbar.md.css:84-85).
   The rule that used to sit here padded the
   `ion-header` on top of that, and measuring it showed both failure modes at
   once: the top inset counted TWICE (the header content started at 94px instead
   of 47px, a 47px dead band under the notch), and `padding-left/right` on a
   box that is already full width pushed the header 24px past the right edge of
   the viewport (right=417 in a 393px viewport). The shell only has to cover what
   Ionic does not.

   What Ionic does NOT cover is the two SCROLLING surfaces below/beside it. */
.app-shell-content {
  --padding-start: env(safe-area-inset-left, 0px);
  --padding-end: env(safe-area-inset-right, 0px);
  --padding-bottom: env(safe-area-inset-bottom, 0px);
}

/* The side menu is a SECOND scrolling surface with its own edges, and it was the
   gap: Ionic derives `--ion-safe-area-*` from `env()` and its TOOLBAR uses them,
   so the menu's titlebar was already clear — but the list below it was not. On a
   notched device in landscape the menu opens against the cut-off edge, so every
   nav row started underneath it (measured: item x=0 with a 12 px left inset), and
   the last row of a scrolled menu ended under the home indicator. The menu sits on
   the START side, so it takes the start + bottom insets. */
.app-shell-menu-content {
  --padding-start: env(safe-area-inset-left, 0px);
  --padding-bottom: env(safe-area-inset-bottom, 0px);
}

.app-shell-body {
  position: relative;
  z-index: 1; /* above the decorative background layer */
}

/* The routed view lives in this body. `ion-router-outlet` is `position: absolute;
   inset: 0; contain: layout size style` — it claims the viewport and contributes
   NO height, so inside the shell's scrolling content it collapsed the body to 0px
   and the pages spilled out of a box `ion-content` could not scroll. Put the
   outlet in flow and let it be sized by the page inside it; size containment is
   the only part dropped, layout/style containment stays. */
.app-shell-body :deep(ion-router-outlet) {
  position: relative;
  contain: layout style;
}

/* The page IS the skin's themed surface (it carries the skin's root class), so the
   shell content never paints its own ground over it — that is skin-agnostic. */
.app-shell-page .app-shell-content {
  --background: transparent;
}

/* The frosted toolbar backdrop is the ionic skin's glass idiom, so it stays keyed
   on ITS namespace: on an ionic page the toolbars blur over the photo/gradient
   (their transparent fill + colour come from ionic.css .visu-root →
   --ion-toolbar-background / --ion-toolbar-color); on a terminal page there is no
   glass to imitate and the rule simply does not apply. */
.app-shell-page.visu-root .app-shell-header ion-toolbar,
.app-shell-page.visu-root .app-shell-titlebar ion-toolbar {
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
}

/* Active nav entry — additive accent, legible in every theme. */
.app-shell-page :deep(ion-item.active) {
  --color: var(--obs-accent, var(--ion-color-primary));
  font-weight: 700;
}
</style>
