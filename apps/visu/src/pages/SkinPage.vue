<script setup lang="ts">
/**
 * pages/SkinPage — the generic, page-definition-driven Visu page (A5, Issue #101).
 *
 * One page component renders ANY {@link PageDef}: it resolves the def into its
 * ordered, grouped devices ({@link resolvePage}) and renders them through the
 * skin the def names. The same devices therefore appear as Glass tiles on the
 * `ionic` page and as list rows on the `terminal` page — identical core data,
 * different skin (the A5 promise). The page is the author's choice of skin; it
 * owns no device state and no renderer — it only wires the host pieces together:
 *
 *   - AppShell (A3) provides the chrome: nav menu, header with the clock pill,
 *     the room-grouped body. The page fills the shell's default slot.
 *   - DetailModalHost (A2) provides the host API (gesture → canonical store
 *     action) and owns the detail surface. OverviewGrid (its descendant)
 *     captures a tap → canonical action and a long-press → `openDetail`.
 *   - SkinHost (A1/A4), inside the grid, turns the ordered, grouped rooms into
 *     tiles/rows via the def's skin, addressed by type.
 *   - TweaksPanel (A6) edits the active skin's manifest-declared tweaks. A skin
 *     that declares no tweaks (terminal) shows no toggle — the page owns the
 *     values (skin owns no state) and only feeds them to skins that read them.
 *
 * Goldene Regeln honoured: the skin owns no state (the page + store do); gestures
 * are mapped by the host, never the skin; the renderer is addressed by type; the
 * skin is addressed by name (resolved by the host registry); order + grouping are
 * the floor; AA tokens come from core.
 */
import { ref, computed, inject, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { routeLocationKey } from 'vue-router';
import { IonPage } from '@ionic/vue';
import { applyTweaks, type IonicTweaks } from '@obs-visu-skins/ionic';
import '@obs-visu-skins/ionic/ionic.css';
// Edomi POC chrome (nav + pixel canvas + popups); harmless when another skin renders.
import '@obs-visu-skins/edomi/edomi.css';
// The terminal skin's stylesheet is loaded by the app entry (`main.ts`), not here
// — see the note there. Without it the terminal page renders as raw unstyled
// markup while its jsdom tests stay green: mounts prove structure, not pixels.

import { storeToRefs } from 'pinia';

import DetailModalHost from '../app/DetailModalHost.vue';
import TweaksPanel, { type TweakValues } from '../app/TweaksPanel.vue';
import OverviewGrid from './OverviewGrid';
import { PAGES, resolvePage, groupDevicesByRoom } from './pages';
import { resolveSkin } from '../skin-host/skins';
import { useDeviceStore } from '../core/store';
import { NAV_KEYS, type NavKey } from '../app/shell/useShellState';
import { useShellContext } from '../app/shell/shellContext';

const props = withDefaults(defineProps<{ pageId?: string }>(), { pageId: 'overview' });

const { t } = useI18n();

/** The resolved page: its definition + the ordered, grouped room blocks. */
const page = computed(() => resolvePage(props.pageId));
/** The skin this page is authored against (the def's choice — no runtime switch). */
const skin = computed(() => page.value.def.skin);
/** The page's own localised title (pages.<id>.title) — feeds the shell chrome so
 *  a non-overview page (e.g. terminal) shows its title, not a stale "Overview". */
const pageTitle = computed(() => t(page.value.def.titleKey));
/** Seed the shell's active nav from the page id when it is a top-level nav key,
 *  else leave the default so the menu does not falsely highlight "Overview". */
const shellState = computed(() =>
  NAV_KEYS.includes(page.value.def.id as NavKey) ? { active: page.value.def.id as NavKey } : {},
);
/** Live host state — the store owns the device floor when the source is external. */
const store = useDeviceStore();
const { devices, externalFloor, positions, links } = storeToRefs(store);
/**
 * The ordered, room-grouped blocks this page renders. With the mock source the
 * floor is the static model (core `rooms`, filtered by the page def). With an
 * external source (a real backend tree via ObsDataSource) the mock ids do not
 * exist, so derive the floor from the live devices grouped by room — the same
 * "order + grouping are the floor" rule, sourced from the tree instead of the
 * demo model. Empty until the async seed lands (renders nothing, then fills).
 */
const groups = computed(() =>
  externalFloor.value
    ? groupDevicesByRoom(devices.value, positions.value, links.value)
    : page.value.groups,
);

/** Whether the active skin declares tweaks (only those skins show the editor). */
const hasTweaks = computed(() => Object.keys(resolveSkin(skin.value).manifest.tweaks ?? {}).length > 0);
/** The CSS namespace the ACTIVE skin's stylesheet is scoped to. Hardcoding one
 *  skin's root here is what left the terminal page rendering as raw markup while
 *  its mount tests were green — the class has to follow the page's skin. */
const skinRootClass = computed(() => resolveSkin(skin.value).rootClass);

/* ----------------------------------------------------------- tweak state (A6) */
// The page owns the per-page tweak values (the skin owns no state, golden rule 4).
// Seeded empty → TweaksPanel merges the skin's manifest defaults as the floor.
const tweaks = ref<TweakValues>({});
const showTweaks = ref(false);

/** Map the page's tweak values to the ionic skin root attrs + CSS vars (data → code).
 *  Only the ionic skin reads these; for a tweak-less skin the values stay empty so
 *  `applyTweaks` yields the skin's neutral defaults (harmless on a list skin). */
const rootTweaks = computed(() => applyTweaks(tweaks.value as IonicTweaks));

/** Active theme drives the AA-safe tokens the host hands each renderer (golden rule 6). */
const theme = computed<'light' | 'dark' | 'image'>(() => {
  const v = tweaks.value['theme'];
  return v === 'dark' || v === 'image' ? v : 'light';
});

/* ------------------------------------------------ app-level shell context (#118) */
// The shell is mounted once at app level (App.vue). This page feeds it the
// per-page chrome — title, active nav, themed root bindings — through the shared
// reactive seam; the shell reads it to draw the page-dependent chrome. With no
// app provider (a page mounted standalone in a test) this writes to a local
// context, leaving the page fully self-contained.
const shellContext = useShellContext();
// The outlet keeps a LEAVING page mounted (hidden) in its view stack, so several
// SkinPages can be alive at once — and they all watch the same shared seam. Only
// the page the router currently points at may write it; otherwise the last effect
// to re-run wins and the chrome keeps the old page's title and skin surface. Route
// names ARE the page ids (router.ts). With no router at all (a page mounted
// standalone in a test) there is nothing to compete with, so the page writes.
// `inject(routeLocationKey, null)` rather than `useRoute()`: the same seam, but it
// tolerates no router at all instead of warning about a missing injection.
const route = inject(routeLocationKey, null);
const isRoutedPage = computed(() => route?.name == null || route.name === page.value.def.id);
watchEffect(() => {
  if (!isRoutedPage.value) return;
  shellContext.title = pageTitle.value;
  shellContext.state = shellState.value;
  shellContext.rootBind = rootTweaks.value;
  // The chrome sits on the surface of THIS page's skin, not on a hardcoded one.
  shellContext.rootClass = skinRootClass.value;
});

/* --------------------------------------------------- current page (#1194) */
// "Which page am I on" decides whether a link's active indicator lights. On the
// STATIC floor that is the ROUTED page, and it is passed down explicitly rather
// than written into the store: the Ionic router outlet keeps the leaving page
// mounted for its transition, so two SkinPages can live at once — a shared piece
// of state would then race between them. With an external floor the backend page
// ids rule, so nothing is passed and the host's own `currentPageId` (written by
// the link action and by a page-owning skin's nav) decides.
const currentPage = computed(() => (externalFloor.value ? undefined : page.value.def.id));

/**
 * Display names for link targets on the STATIC floor (#1194). There is no nav
 * tree there, so without these every link would announce the same generic
 * fallback and two links to different pages would be indistinguishable to a
 * screen reader (WCAG 2.4.4). The page layer owns the definitions and their
 * translated titles, so it is the right place to resolve them; the host prefers
 * a live nav-tree name when one exists.
 */
const pageNames = computed<Record<string, string> | undefined>(() =>
  externalFloor.value ? undefined : Object.fromEntries(PAGES.map((p) => [p.id, t(p.titleKey)])),
);
</script>

<template>
  <!-- The page renders ONLY its body — the Ionic shell (ion-app + chrome) is
       mounted once at app level (App.vue) and reads this page's chrome from the
       shared shell context. No nested ion-app per page (#118).

       The body is an `IonPage` (a plain `<div class="ion-page">`) because the
       routed view is what `ion-router-outlet` manages: the outlet locates the
       leaving view through the `registerIonPage` callback `IonPage` fires on
       mount, and only a REGISTERED view gets `ion-page-hidden` when it leaves.
       With a bare div the outlet found no leaving element, so every in-app route
       change left the previous page mounted and visible UNDER the new one — two
       stacked `.skin-page`s after `/` → `/terminal`. This is not the nested
       `ion-app`/duplicated chrome #118 ruled out: the chrome still lives once, at
       app level; this only makes the routed body identifiable to the outlet. -->
  <IonPage
    class="skin-page"
    :data-page="page.def.id"
  >
    <DetailModalHost
      :skin="skin"
      :theme="theme"
      :root-bind="rootTweaks"
    >
      <div
        class="overview-root"
        :class="skinRootClass"
        v-bind="rootTweaks.attrs"
        :style="rootTweaks.style"
      >
        <OverviewGrid
          :skin="skin"
          :groups="groups"
          :theme="theme"
          :current-page="currentPage"
          :page-names="pageNames"
        />
      </div>

      <!-- Tweaks editor (A6): only when the active skin declares tweaks. The
           page owns the values; the skin reads them. -->
      <template v-if="hasTweaks">
        <button
          type="button"
          class="overview-tweaks-toggle"
          :aria-expanded="showTweaks"
          @click="showTweaks = !showTweaks"
        >
          {{ t('overview.tweaks.toggle') }}
        </button>
        <TweaksPanel
          v-if="showTweaks"
          v-model="tweaks"
          :skin="skin"
        />
      </template>
    </DetailModalHost>
  </IonPage>
</template>

<style scoped>
/* `.ion-page` is `position: absolute; inset: 0; contain: layout size style` — the
   box Ionic gives a view that OWNS the viewport. Here the routed view lives inside
   the shell's scrolling `ion-content` (#118), so that box would pin the page to a
   zero-height slot and nothing below the fold could be scrolled to. Put it back in
   flow so the shell's content scrolls the page: exactly what Ionic itself does for
   a page it hosts in a non-outlet box (`ion-modal > .ion-page`). Only the box is
   neutralised — the `ion-page` CLASS stays, which is what the outlet registers and
   what `ion-page-hidden` (display:none !important) then hides on leave. */
.skin-page {
  position: relative;
  contain: layout style;
}

.overview-root {
  /* Room blocks read as separate rooms by the gap between groups (Must-Keep);
     the ionic skin draws the gap via --vz-room-gap on the .visu-root. */
  display: block;
}

.overview-tweaks-toggle {
  margin: var(--obs-space, 12px);
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--ion-color-step-200, #cfd4dc);
  background: var(--ion-background-color, #fff);
  color: var(--ion-text-color, #1b2027);
  font: inherit;
  cursor: pointer;
}
</style>
