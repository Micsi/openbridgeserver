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
 *
 * C2 (Issue #169) haengt den WYSIWYG-Canvas als GESCHWISTER des Vorschaurahmens
 * daneben - nicht darum herum. Das ist Absicht: der Vorfahrenpfad des Rahmens
 * ist gepinnt (`tests/helpers/previewFrameFence.js`), weil `transform`/`filter`/
 * `zoom` an JEDEM Vorfahren dem Autor ein anderes Bild zeigen wuerden als dem
 * Nutzer (E3). Ein zusaetzlicher Wrapper um den Rahmen waere genau der Weg
 * dorthin; ein Geschwister ist keiner.
 *
 * `pageId` kommt als PROP aus der Route (`props: true`), nicht aus `useRoute()`:
 * diese Ansicht laesst sich damit ohne Router montieren.
 */
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { canUseVisuEditor } from '@/utils/visuEditorAccess'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'
import VisuEditorCanvas from '@/components/visu/VisuEditorCanvas.vue'

defineProps({
  /** Die Seite, die der Canvas bearbeitet (Route `/visu-editor/:pageId`). */
  pageId: { type: String, default: null },
})

const auth = useAuthStore()
const allowed = computed(() => canUseVisuEditor(auth))

/**
 * Der Entwurf, den die Vorschau zeigt. C1–C3 schreiben ihn; C4 transportiert ihn.
 *
 * Form (Protokoll 1.1): `{ skin, pageId, nodes, tweaks?, theme? }`. `tweaks` und
 * `theme` sind nicht schmueckendes Beiwerk: an ihnen haengen die Wurzel-Attribute
 * und `--vz-*`-Variablen, aus denen der Skin seine Flaechen- und Kachel-Tokens
 * zieht. Wer sie weglaesst, bekommt dieselben Komponenten auf einer anderen
 * Seite — genau das, was Messlatte E3 ausschliesst.
 */
const draft = ref(null)
const applied = ref(null)
/** Die Vorschau-Breite, die der Autor gewaehlt hat (E17), oder `null`. */
const previewWidth = ref(null)
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

    <VisuEditorCanvas
      :page-id="pageId"
      @draft="draft = $event"
      @preview-width="previewWidth = $event"
    />

    <VisuPreviewFrame
      :draft="draft"
      :width="previewWidth"
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
