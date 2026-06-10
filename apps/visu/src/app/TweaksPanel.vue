<script setup lang="ts">
/**
 * app/TweaksPanel — generic, manifest-driven tweak editor (A6, Issue #102).
 *
 * The panel renders the *active page-skin's* `manifest.tweaks` schema
 * (CONTRACT-v1.md §7) with no per-skin special-casing: every entry is a
 * `select` (segmented buttons over its `options`) or a `slider` (range input
 * over `min`/`max`/`step`). The same code therefore renders the Ionic skin's
 * tweaks (`stil` glass/ios/md, `accentStyle`, `glassBlur`, …) and any future
 * skin's tweaks identically — data describes the controls, code only renders
 * them (Goldene Regel 7).
 *
 * Goldene Regel 4 (the skin owns no state): this is a **controlled** component.
 * The per-page tweak values live with the page (the host), are passed in via
 * `v-model`, and every edit is emitted back as a fresh object — the panel keeps
 * no private copy and mutates nothing it was handed. Missing values fall back to
 * the schema `default`, so a page that has never been tweaked still shows the
 * skin's floor (the same defaults the renderer clamps against, golden rule 6).
 *
 * Skin resolution goes through the host registry (`resolveSkin`), the single
 * seam allowed to know a concrete skin — the panel itself stays skin-agnostic
 * and reads only the contract-typed manifest. An unknown tweak `type` is a hard,
 * visible failure, never a silently dropped control (the "never a silent lamp"
 * discipline the renderer dispatch follows).
 *
 * Quelle der Bedienelemente: reference/vue-ionic/tweaks.js (Segment-Buttons +
 * Range-Slider, Wertanzeige rechts neben dem Label).
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SkinTweak } from '@obs/visu-contract';

import { resolveSkin } from '../skin-host/skins';

defineOptions({ name: 'TweaksPanel' });

/** A single tweak's current value — a string (select) or a number (slider). */
export type TweakValue = string | number;
/** The per-page tweak record the panel reads and emits (key → value). */
export type TweakValues = Readonly<Record<string, TweakValue>>;

const props = defineProps<{
  /** The active page's skin key (author's choice; resolved via the host registry). */
  skin: string;
  /** Per-page tweak values, owned + persisted by the page (skin owns no state). */
  modelValue?: TweakValues;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: TweakValues): void;
}>();

const { t, te } = useI18n();

/**
 * Translate a key, falling back to a literal when the active locale has no entry.
 * vue-i18n is the source of truth (Daten=JSON); the fallback keeps this panel
 * self-contained — a not-yet-translated chrome/tweak string degrades to a
 * readable default rather than surfacing a raw `[key]` placeholder.
 */
function tr(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}

/** The active skin's tweak schema (manifest.tweaks); empty if the skin declares none. */
const schema = computed<ReadonlyArray<readonly [string, SkinTweak]>>(() => {
  const tweaks = resolveSkin(props.skin).manifest.tweaks ?? {};
  return Object.entries(tweaks);
});

/** Current values merged over the schema defaults — the floor a fresh page shows. */
const values = computed<Record<string, TweakValue>>(() => {
  const out: Record<string, TweakValue> = {};
  const provided = props.modelValue;
  for (const [key, spec] of schema.value) {
    const v = provided?.[key];
    out[key] = v !== undefined ? v : spec.default;
  }
  return out;
});

/** Emit a fresh values object with one key changed (controlled component). */
function setTweak(key: string, value: TweakValue): void {
  emit('update:modelValue', { ...values.value, [key]: value });
}

/**
 * Label for a tweak key — `tweaks.<key>.label` if the active locale defines it,
 * otherwise the raw key. The fallback keeps unknown/new skin tweaks rendering
 * (a missing translation is a string gap, not a broken control).
 */
function tweakLabel(key: string): string {
  return tr(`tweaks.${key}.label`, key);
}

/** Label for a select option — `tweaks.<key>.options.<value>` with raw fallback. */
function optionLabel(key: string, value: string): string {
  return tr(`tweaks.${key}.options.${value}`, value);
}

/** Formatted current value shown next to a slider (plain number, locale-agnostic). */
function sliderDisplay(value: TweakValue): string {
  return String(value);
}

/**
 * A tweak `type` the panel does not render is a hard, visible failure — never a
 * silently dropped control (golden rules 2/3). Surfacing it means an authoring /
 * contract mismatch is seen, not papered over.
 */
function unsupportedType(spec: SkinTweak): never {
  throw new Error(
    `TweaksPanel: unsupported tweak type "${(spec as { type: string }).type}" — ` +
      `the panel renders only "select" and "slider".`,
  );
}
</script>

<template>
  <section
    class="tweaks-panel"
    :data-skin="skin"
  >
    <header class="tweaks-panel__head">
      <h2 class="tweaks-panel__title">
        {{ tr('tweaks.title', 'Tweaks') }}
      </h2>
    </header>

    <p
      v-if="schema.length === 0"
      class="tweaks-panel__empty"
    >
      {{ tr('tweaks.empty', 'Keine Tweaks') }}
    </p>

    <div
      v-for="[key, spec] in schema"
      :key="key"
      class="tweaks-panel__row"
      :data-tweak="key"
    >
      <div class="tweaks-panel__label">
        <span class="tweaks-panel__label-text">{{ tweakLabel(key) }}</span>
        <span
          v-if="spec.type === 'slider'"
          class="tweaks-panel__value"
        >
          {{ sliderDisplay(values[key]) }}
        </span>
      </div>

      <!-- select → segmented buttons over the schema options -->
      <div
        v-if="spec.type === 'select'"
        class="tweaks-panel__seg"
        role="group"
      >
        <button
          v-for="opt in spec.options ?? []"
          :key="opt"
          type="button"
          class="tweaks-panel__seg-btn"
          :class="{ 'is-on': values[key] === opt }"
          :aria-pressed="values[key] === opt"
          @click="setTweak(key, opt)"
        >
          {{ optionLabel(key, opt) }}
        </button>
      </div>

      <!-- slider → range input over min/max/step -->
      <input
        v-else-if="spec.type === 'slider'"
        class="tweaks-panel__slider"
        type="range"
        :min="spec.min"
        :max="spec.max"
        :step="spec.step ?? 1"
        :value="values[key]"
        :aria-label="tweakLabel(key)"
        @input="setTweak(key, Number(($event.target as HTMLInputElement).value))"
      >

      <!-- never a silent default: an unknown tweak type is a visible failure -->
      <template v-else>
        {{ unsupportedType(spec) }}
      </template>
    </div>
  </section>
</template>
