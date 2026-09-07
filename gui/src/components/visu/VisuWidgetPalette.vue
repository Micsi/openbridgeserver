<script setup>
/**
 * Die Widget-Palette (M5 C3, Issue #170).
 *
 * Sie zeigt die neun Kern-Typen des Vertrags und meldet den gewaehlten Typ nach
 * oben; platziert wird das Element vom Editor, nicht von der Palette (der
 * Canvas gehoert Teil C2). Die Liste selbst steht in `visuWidgetTypes.js` und
 * ist an Vertrag und Abbildung gebunden - hier wird sie nur gerendert.
 *
 * Die fuenf Typen, die die Abbildung der Visu heute noch nicht uebersetzt
 * (Issue #124), sagen das dem Autor. Ein Werkzeug, das ein Element anbietet und
 * verschweigt, dass es in der Vorschau nicht erscheint, laesst ihn den Fehler
 * bei sich suchen.
 */
import { CORE_WIDGET_TYPES, WIDGET_FORMS } from '@/utils/visuWidgetTypes'
import HelpButton from '@/components/ui/HelpButton.vue'

defineEmits(['place'])
</script>

<template>
  <section
    class="widget-palette flex flex-col gap-2"
    data-testid="visu-widget-palette"
  >
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {{ $t('visuEditor.palette.title') }}
      </h2>
      <HelpButton help-id="visu-widget-palette" />
    </div>
    <ul class="grid grid-cols-3 gap-2">
      <li
        v-for="type in CORE_WIDGET_TYPES"
        :key="type"
      >
        <button
          type="button"
          class="widget-palette-item flex w-full flex-col gap-0.5 rounded-md border border-slate-300 px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          :data-type="type"
          :data-preview-mapped="String(WIDGET_FORMS[type].previewMapped)"
          @click="$emit('place', type)"
        >
          <span>{{ $t(`visuEditor.widgetTypes.${type}`) }}</span>
          <span
            v-if="!WIDGET_FORMS[type].previewMapped"
            class="text-xs text-amber-600 dark:text-amber-400"
          >{{ $t('visuEditor.palette.notRendered') }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
