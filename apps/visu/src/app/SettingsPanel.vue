<script setup lang="ts">
/**
 * app/SettingsPanel — host settings in the shell menu (A7, Issue #144).
 *
 * The Visu's own preferences, next to the LoginPanel in the navigation menu:
 * things the APP does, not things a skin draws. Today that is exactly one entry
 * — the idle return to the start page, which a wall panel needs and a phone
 * usually does not, so it ships off and is switched on here.
 *
 * Controlled view (Goldene Regel 4 in its host form): the panel owns nothing. It
 * reads {@link useAppSettings} and calls the setter; the setter normalises and
 * persists, and the field then shows what was actually STORED — never a value the
 * host silently ignored.
 *
 * Plain form controls rather than Ionic inputs, like TweaksPanel: a host panel
 * whose controls are ordinary DOM is testable in jsdom without stubbing web
 * components, and it inherits the surrounding menu's type scale either way.
 *
 * The heading is `settings.title` = "App-Einstellungen", deliberately NOT
 * "Einstellungen": `NAV_KEYS` (shell/useShellState) already ships a `settings`
 * SECTION whose label the menu renders a few rows above this panel. Two identical
 * headings stacked in one menu, meaning different things — a section of the
 * visualisation up there, the app's own preferences down here — is a menu nobody
 * can read. Pinned by SettingsPanel.spec.ts → "its heading is not the same word
 * as the nav section already in the menu", in both locales.
 */
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  useAppSettings,
  IDLE_RETURN_HOME_MAX_SECONDS,
  IDLE_RETURN_HOME_MIN_SECONDS,
  IDLE_RETURN_HOME_OFF,
} from './appSettings';

defineOptions({ name: 'SettingsPanel' });

const { t } = useI18n();
const settings = useAppSettings();

/** Stable ids so the label and the help text are wired to the field (a11y). */
const fieldId = useId();
const helpId = useId();

const seconds = computed(() => settings.idleReturnHomeSeconds.value);

/** What the setting currently does, in words — "off" is a state, not a blank. */
const stateText = computed(() =>
  seconds.value === IDLE_RETURN_HOME_OFF
    ? t('settings.idleReturnHome.off')
    : t('settings.idleReturnHome.active', { n: seconds.value }),
);

function onChange(ev: Event): void {
  settings.setIdleReturnHomeSeconds((ev.target as HTMLInputElement).value);
}
</script>

<template>
  <section class="settings-panel">
    <h2 class="settings-panel__title">
      {{ t('settings.title') }}
    </h2>

    <div
      class="settings-panel__row"
      data-setting="idleReturnHomeSeconds"
    >
      <label
        :for="fieldId"
        class="settings-idle-label settings-panel__label"
      >
        {{ t('settings.idleReturnHome.label') }}
      </label>

      <div class="settings-panel__field">
        <input
          :id="fieldId"
          class="settings-idle-seconds"
          type="number"
          inputmode="numeric"
          :min="IDLE_RETURN_HOME_OFF"
          :max="IDLE_RETURN_HOME_MAX_SECONDS"
          :step="1"
          :value="seconds"
          :aria-describedby="helpId"
          @change="onChange"
        >
        <span class="settings-panel__unit">{{ t('settings.idleReturnHome.unit') }}</span>
      </div>

      <p class="settings-idle-state settings-panel__state">
        {{ stateText }}
      </p>

      <p
        :id="helpId"
        class="settings-idle-help settings-panel__help"
      >
        {{ t('settings.idleReturnHome.help', { min: IDLE_RETURN_HOME_MIN_SECONDS, max: IDLE_RETURN_HOME_MAX_SECONDS }) }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.settings-panel {
  padding: 8px 16px 16px;
}

.settings-panel__title {
  margin: 0 0 8px;
  font-size: 0.9rem;
  font-weight: 700;
  opacity: 0.75;
}

.settings-panel__label {
  display: block;
  font-size: 0.9rem;
}

.settings-panel__field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

/* The `--ion-*` fallbacks here are safe in a way AccessGate's were not, and the
   difference is WHERE the element sits. AccessGate.vue:166-171 records that
   `--ion-background-color` "on a terminal page no longer resolves, so this painted
   a light strip across the black page" — but that element lives INSIDE the shell
   page, which carries the active skin's root class. This panel lives in the
   `ion-menu`, a SIBLING of that page: measured in the browser on `/visu/terminal`,
   the shell page is `… t-root menu-content …` while the menu itself reports
   `closest('.t-root, .visu-root') === null`. The menu is therefore Ionic's own
   surface on every page, the field's white matches the menu's own `#fff`, and no
   skin can strand a light control on a dark ground. Verified visually with the
   menu open over the black terminal page. */
.settings-idle-seconds {
  width: 6rem;
  /* 44 px Touch-Boden (#104 AC3) — die Polsterung allein ergab 32 px. */
  box-sizing: border-box;
  min-height: 44px;
  padding: 6px 8px;
  border: 1px solid var(--ion-color-step-200, #cfd4dc);
  border-radius: 8px;
  background: var(--ion-background-color, #fff);
  color: var(--ion-text-color, #1b2027);
  font: inherit;
}

.settings-panel__unit,
.settings-panel__state,
.settings-panel__help {
  font-size: 0.8rem;
  opacity: 0.7;
}

.settings-panel__state,
.settings-panel__help {
  margin: 6px 0 0;
}
</style>
