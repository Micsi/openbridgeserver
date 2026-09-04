<script setup>
/**
 * Admin-Bereich „Visu-Editor" (M5 C4, Issue #171).
 *
 * Owner-Entscheid §2.4: der V2-Editor lebt in der Admin-GUI, weil hier die
 * Berechtigungen ausgewertet werden. Teil C4 liefert davon die **Vorschau-
 * Bruecke** und das **Gate**; Baum, Eigenschaften, Canvas und Palette kommen aus
 * C1–C3 und fuellen spaeter denselben `draft`.
 *
 * Das Gate liegt doppelt: die Route wird vom Router weggeleitet (siehe
 * `visuEditorGuard`), und diese Ansicht rendert fuer einen Nicht-Admin gar
 * nichts. Ein direkt gemountetes View darf keine Vorschau zeigen, nur weil die
 * Wache umgangen wurde.
 */
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { canUseVisuEditor } from '@/utils/visuEditorAccess'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'

const auth = useAuthStore()
const allowed = computed(() => canUseVisuEditor(auth))

/** Der Entwurf, den die Vorschau zeigt. C1–C3 schreiben ihn; C4 transportiert ihn. */
const draft = ref(null)
const applied = ref(null)
</script>

<template>
  <div
    v-if="allowed"
    data-testid="visu-editor"
    class="flex flex-col gap-4 p-4"
  >
    <header class="flex flex-col gap-1">
      <h1 class="text-lg font-semibold text-slate-800 dark:text-slate-100">
        {{ $t('visuEditor.title') }}
      </h1>
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('visuEditor.intro') }}
      </p>
    </header>

    <VisuPreviewFrame
      :draft="draft"
      @applied="applied = $event"
    />

    <p
      v-if="applied"
      data-testid="visu-editor-applied"
      class="text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('visuEditor.applied', { count: applied.widgetCount }) }}
    </p>
  </div>
</template>
