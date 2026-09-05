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
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { canUseVisuEditor } from '@/utils/visuEditorAccess'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'
import VisuWidgetPalette from '@/components/visu/VisuWidgetPalette.vue'
import VisuWidgetBindingForm from '@/components/visu/VisuWidgetBindingForm.vue'
import { useVisuEditorDraft } from '@/composables/useVisuEditorDraft'
import { createWidget } from '@/utils/visuWidgetTypes'

const auth = useAuthStore()
const allowed = computed(() => canUseVisuEditor(auth))

/**
 * Die bearbeitete Seite steht im Pfad (`/visu-editor/<id>`). Ohne Router - so
 * mountet die Gate-Probe diese Ansicht - bleibt sie leer, und der Bereich zeigt
 * nur die Vorschau; ein `useRoute()` ausserhalb eines Routers liefert
 * `undefined`, keinen Fehler.
 */
const route = useRoute()
const pageId = computed(() => (route && route.params ? route.params.pageId || null : null))

/**
 * Der Entwurf, den die Vorschau zeigt. C4 transportiert ihn, C3 fuellt ihn:
 * Knoten der Seite samt ihrer Vorlagen (E10), Elemente ohne erfuellte
 * Sichtbarkeitsregel bereits ausgelassen (E16).
 *
 * Form (Protokoll 1.1): `{ skin, pageId, nodes, tweaks?, theme? }`. `tweaks` und
 * `theme` sind nicht schmueckendes Beiwerk: an ihnen haengen die Wurzel-Attribute
 * und `--vz-*`-Variablen, aus denen der Skin seine Flaechen- und Kachel-Tokens
 * zieht. Wer sie weglaesst, bekommt dieselben Komponenten auf einer anderen
 * Seite — genau das, was Messlatte E3 ausschliesst.
 */
const { draft, pageWidgets, replaceWidget, addWidget } = useVisuEditorDraft(pageId)
const applied = ref(null)

/** Das Element, dessen Bindungsformular offen steht. */
const selectedId = ref(null)
const selected = computed(() => pageWidgets.value.find((w) => w.id === selectedId.value) || null)

/**
 * Ein neues Element aus der Palette. Die Id wird hier vergeben, weil der Entwurf
 * sie sofort braucht - der Server sieht das Element erst beim Speichern.
 */
function platzieren(type) {
  const id =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `w-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  const widget = createWidget(type, { id, name: '' })
  addWidget(widget)
  selectedId.value = id
}
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

    <!-- Autorenteil (M5 C3, Issue #170): Palette, Elemente der Seite,
         Bindungsformular. Bewusst GESCHWISTER des Vorschaurahmens und nicht um
         ihn herum: sein Vorfahrenpfad ist gepinnt (E3), ein neuer Kasten
         darueber waere eine stille Bildaenderung. -->
    <p
      v-if="!pageId"
      data-testid="visu-editor-no-page"
      class="text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('visuEditor.pageMissing') }}
    </p>
    <div
      v-else
      class="grid gap-4 md:grid-cols-3"
      data-testid="visu-editor-authoring"
    >
      <VisuWidgetPalette @place="platzieren" />

      <section class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {{ $t('visuEditor.widgetsOnPage') }}
        </h2>
        <ul class="flex flex-col gap-1">
          <li
            v-for="widget in pageWidgets"
            :key="widget.id"
          >
            <button
              type="button"
              class="editor-widget-item w-full rounded-md px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
              :class="widget.id === selectedId ? 'bg-slate-100 dark:bg-slate-700' : ''"
              :data-widget="widget.id"
              @click="selectedId = widget.id"
            >
              {{ widget.name || widget.id }}
            </button>
          </li>
        </ul>
      </section>

      <!-- `key`: das Formular haelt die halb getippte Sichtbarkeitsregel in
           eigenem Zustand. Ohne den Schluessel wuerde Vue dieselbe Instanz fuer
           das naechste Element weiterverwenden, und dessen Regel stuende noch
           mit den Feldern des vorigen da. -->
      <VisuWidgetBindingForm
        v-if="selected"
        :key="selected.id"
        :widget="selected"
        @update:widget="replaceWidget"
      />
      <p
        v-else
        class="text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.selectWidget') }}
      </p>
    </div>
  </div>
</template>
