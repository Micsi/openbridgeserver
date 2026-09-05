<script setup>
/**
 * Admin-Bereich „Visu-Editor" (M5 C4 Issue #171, erweitert um C1 Issue #168).
 *
 * Owner-Entscheid §2.4: der V2-Editor lebt in der Admin-GUI, weil hier die
 * Berechtigungen ausgewertet werden. Teil C4 lieferte die **Vorschau-Bruecke**
 * und das **Gate**; Teil C1 haengt **Seitenbaum** und **Seiteneigenschaften**
 * daneben und fuellt damit erstmals den `draft`, den C4 transportiert.
 *
 * Das Gate liegt doppelt: die Route wird vom Router weggeleitet (siehe
 * `visuEditorGuard`), und diese Ansicht rendert fuer einen Nicht-Admin gar
 * nichts. Ein direkt gemountetes View darf keine Vorschau zeigen, nur weil die
 * Wache umgangen wurde - und es darf auch keinen Baum laden.
 *
 * ZWEI EINHAENGEPUNKTE fuer die parallelen Teile, bewusst leer gelassen:
 *
 *  - `.editor-canvas` ist die Flaeche, auf der **Teil C2** den WYSIWYG-Canvas
 *    baut (Drag/Resize, Raster, Layer). C1 legt nur den Kasten an, weil der
 *    Playwright-Harness ihn als „der Editor steht" liest
 *    (`apps/visu/e2e/editor-helpers.ts` → `openEditor`).
 *  - Die Vorschau bleibt DIREKTES Kind des `visu-editor`-Kastens. Ihr
 *    Vorfahrenpfad ist in `tests/components/visu/VisuEditorView.spec.js`
 *    gepinnt (Paritaetsnachweis E3); ein neuer Kasten dazwischen waere ein
 *    stiller Eingriff in fremdes Beweismaterial.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useVisuEditorStore } from '@/stores/visuEditor'
import { canUseVisuEditor } from '@/utils/visuEditorAccess'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'
import VisuPageTree from '@/components/visu/VisuPageTree.vue'
import VisuPageProperties from '@/components/visu/VisuPageProperties.vue'

const auth = useAuthStore()
const route = useRoute()
const editor = useVisuEditorStore()
const allowed = computed(() => canUseVisuEditor(auth))

/**
 * Der Entwurf, den die Vorschau zeigt - jetzt aus dem Editor-Store statt aus
 * einem Platzhalter. Form (Protokoll 1.1): `{ skin, pageId, nodes, tweaks?,
 * theme? }`. `tweaks`/`theme` bleiben offen, bis der Tweak-Editor steht; die
 * Vorschau leitet das Theme dann nach derselben Regel wie die echte Seite ab
 * (`themeOfTweaks`).
 */
const draft = computed(() => editor.previewDraft)
const applied = ref(null)

/**
 * Die Seiten-ID aus der Adresse - defensiv gelesen. Wer diese Ansicht OHNE
 * Router montiert (die Zaun-Specs des Vorschaurahmens tun das), bekommt aus
 * `useRoute()` kein Objekt; ohne diese Vorsicht faellt dort die Montage, und der
 * Zaun um die Vorschau haette nichts mehr zu messen.
 */
const routePageId = () => route?.params?.pageId ?? null

onMounted(async () => {
  if (!allowed.value) return
  await editor.load()
  const pageId = routePageId()
  if (pageId) await editor.select(pageId)
})

// Ein Wechsel der Adresse (Deep-Link, Zurueck-Taste) waehlt die Seite aus, ohne
// den Baum erneut zu laden.
watch(routePageId, async (pageId, previous) => {
  if (!allowed.value || pageId === previous) return
  await editor.select(pageId)
})
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

    <div class="grid gap-4 lg:grid-cols-3">
      <VisuPageTree />

      <!-- Einhaengepunkt fuer Teil C2 (WYSIWYG-Canvas, Issue #169). -->
      <div
        class="editor-canvas min-h-40 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-4 text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.canvasHint') }}
      </div>

      <VisuPageProperties />
    </div>

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
