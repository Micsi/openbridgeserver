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
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { applyTweaks, type IonicTweaks } from '@obs-visu-skins/ionic';
import '@obs-visu-skins/ionic/ionic.css';

import AppShell from '../app/AppShell.vue';
import DetailModalHost from '../app/DetailModalHost.vue';
import TweaksPanel, { type TweakValues } from '../app/TweaksPanel.vue';
import OverviewGrid from './OverviewGrid';
import { resolvePage } from './pages';
import { resolveSkin } from '../skin-host/skins';

const props = withDefaults(defineProps<{ pageId?: string }>(), { pageId: 'overview' });

const { t } = useI18n();

/** The resolved page: its definition + the ordered, grouped room blocks. */
const page = computed(() => resolvePage(props.pageId));
/** The skin this page is authored against (the def's choice — no runtime switch). */
const skin = computed(() => page.value.def.skin);
/** The ordered, room-grouped blocks this page renders (core rooms, filtered). */
const groups = computed(() => page.value.groups);

/** Whether the active skin declares tweaks (only those skins show the editor). */
const hasTweaks = computed(() => Object.keys(resolveSkin(skin.value).manifest.tweaks ?? {}).length > 0);

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
</script>

<template>
  <AppShell
    class="skin-page"
    :data-page="page.def.id"
    :state="{ active: 'overview' }"
    :root-bind="rootTweaks"
  >
    <template #default>
      <DetailModalHost
        :skin="skin"
        :theme="theme"
        :root-bind="rootTweaks"
      >
        <div
          class="visu-root overview-root"
          v-bind="rootTweaks.attrs"
          :style="rootTweaks.style"
        >
          <OverviewGrid
            :skin="skin"
            :groups="groups"
            :theme="theme"
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
    </template>
  </AppShell>
</template>

<style scoped>
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
