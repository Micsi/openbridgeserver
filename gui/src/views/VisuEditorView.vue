<script setup>
/**
 * Admin-Bereich „Visu-Editor" (M5 C4 Issue #171, erweitert um C1 Issue #168 und
 * C3 Issue #170).
 *
 * Owner-Entscheid §2.4: der V2-Editor lebt in der Admin-GUI, weil hier die
 * Berechtigungen ausgewertet werden. Teil C4 lieferte die **Vorschau-Bruecke**
 * und das **Gate**; Teil C1 haengt **Seitenbaum** und **Seiteneigenschaften**
 * daneben; Teil C3 den **Autorenteil** (Palette, Elemente der Seite,
 * Datenpunkt-Bindung, Sichtbarkeitsregel). Beide fuellen zusammen den `draft`,
 * den C4 transportiert - siehe die Zusammenfuehrung weiter unten.
 *
 * Das Gate liegt doppelt: die Route wird vom Router weggeleitet (siehe
 * `visuEditorGuard`), und diese Ansicht rendert fuer einen Nicht-Admin gar
 * nichts. Ein direkt gemountetes View darf keine Vorschau zeigen, nur weil die
 * Wache umgangen wurde - und es darf weder einen Baum noch eine Seite laden.
 *
 * ZWEI EINHAENGEPUNKTE, bewusst so gelassen:
 *
 *  - `.editor-canvas` ist die Flaeche, auf der **Teil C2** den WYSIWYG-Canvas
 *    baut (Drag/Resize, Raster, Layer). C1 legt nur den Kasten an, weil der
 *    Playwright-Harness ihn als „der Editor steht" liest
 *    (`apps/visu/e2e/editor-helpers.ts` → `openEditor`).
 *  - Die Vorschau bleibt DIREKTES Kind des `visu-editor`-Kastens. Ihr
 *    Vorfahrenpfad ist in `tests/components/visu/VisuEditorView.spec.js`
 *    gepinnt (Paritaetsnachweis E3); ein neuer Kasten dazwischen waere ein
 *    stiller Eingriff in fremdes Beweismaterial. Der Autorenteil von C3 haengt
 *    deshalb als GESCHWISTER daneben, nicht darum herum.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useVisuEditorStore } from '@/stores/visuEditor'
import { canUseVisuEditor } from '@/utils/visuEditorAccess'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'
import VisuPageTree from '@/components/visu/VisuPageTree.vue'
import VisuPageProperties from '@/components/visu/VisuPageProperties.vue'
import VisuWidgetPalette from '@/components/visu/VisuWidgetPalette.vue'
import VisuWidgetBindingForm from '@/components/visu/VisuWidgetBindingForm.vue'
import { useVisuEditorDraft } from '@/composables/useVisuEditorDraft'
import { createWidget } from '@/utils/visuWidgetTypes'

const auth = useAuthStore()
const route = useRoute()
const editor = useVisuEditorStore()
const allowed = computed(() => canUseVisuEditor(auth))

/**
 * Die bearbeitete Seite steht im Pfad (`/visu-editor/<id>`) - defensiv gelesen.
 * Wer diese Ansicht OHNE Router montiert (die Zaun-Specs des Vorschaurahmens tun
 * das), bekommt aus `useRoute()` kein Objekt; ohne diese Vorsicht faellt dort die
 * Montage, und der Zaun um die Vorschau haette nichts mehr zu messen.
 *
 * DAS GATE HAENGT MIT DRAN: fuer einen Nicht-Admin bleibt die Seiten-Id leer,
 * damit der Autorenteil auch dann nichts am Backend liest, wenn jemand die Wache
 * umgeht und die Ansicht direkt montiert.
 */
const pageId = computed(() =>
  allowed.value ? ((route && route.params ? route.params.pageId : null) ?? null) : null,
)

/**
 * DER BAUM WIRD GENAU EINMAL GELADEN.
 *
 * Zwei Teile brauchen ihn: der Seitenbaum samt Eigenschaftsformular (C1, ueber
 * den Store) und der Entwurf fuer die Vorschau (C3, ueber das Composable). Beide
 * kamen mit einem eigenen `GET /visu/tree` an. Hier teilen sie sich EINEN
 * Ladevorgang - dieselbe Liste, ein Netzweg, und die Reihenfolge der globalen
 * Inkludeseiten (R10) kann gar nicht zwischen beiden auseinanderlaufen.
 */
let baumLaeuft = null
function ladeBaum() {
  if (!allowed.value) return Promise.resolve()
  if (!baumLaeuft) baumLaeuft = editor.load()
  return baumLaeuft
}

/**
 * Der Entwurf des Autorenteils (C3): Knoten der Seite samt ihrer Vorlagen (E10),
 * jedes Element mit seiner Sichtbarkeitsregel als DATEN (E16). Ausgewertet wird
 * die Regel drueben im Host, damit die Vorschau dieselbe Seite zeigt wie die
 * ausgelieferte Visu.
 */
const {
  draft: autorenEntwurf,
  pageWidgets,
  replaceWidget,
  addWidget,
} = useVisuEditorDraft(pageId, { tree: async () => (await ladeBaum(), editor.nodes) })

/**
 * Der Entwurf, den die Vorschau zeigt - aus BEIDEN Teilen zusammengesetzt.
 *
 * Form (Protokoll 1.1): `{ skin, pageId, nodes, tweaks?, theme? }`.
 *
 *  - C3 liefert die KNOTEN: die Seite mit ihren frisch gelesenen Vorlagen (E10)
 *    und den Elementen, die der Autor gerade setzt (E11/E16).
 *  - C1 liefert die SEITENEIGENSCHAFTEN: den Skin der Seite (E19), die Includes,
 *    das Opt-out gegen die globalen und den Popup-Deskriptor - und zwar im
 *    UNGESPEICHERTEN Stand, sonst zeigte die Vorschau den Server statt den
 *    Entwurf.
 *
 * Ohne den Autorenteil (keine Seite in der Adresse) bleibt der Entwurf des
 * Stores stehen; ohne geladene Seiten-Konfiguration im Store bleibt der frische
 * Stand von C3 unangetastet - eine Vorgabe waere hier schlimmer als keine.
 *
 * Am Ende ein Klon aus reinen Daten: ein Vue-Proxy scheitert im `postMessage`
 * der Bruecke mit „could not be cloned".
 */
const draft = computed(() => {
  const autoren = autorenEntwurf.value
  const eigenschaften = editor.previewDraft
  if (!autoren) return eigenschaften
  if (!eigenschaften || eigenschaften.pageId !== autoren.pageId) return autoren
  const seite = eigenschaften.nodes.find((node) => node.id === autoren.pageId)
  const gespeicherte = editor.pageConfigs[autoren.pageId]
  return JSON.parse(
    JSON.stringify({
      ...autoren,
      skin: eigenschaften.skin,
      nodes: autoren.nodes.map((node) => {
        if (node.id !== autoren.pageId || !seite) return node
        const eigen = {
          ...node,
          name: seite.name,
          kind: seite.kind,
          access: seite.access,
        }
        // Nur wenn der Store die Seite WIRKLICH gelesen hat: sonst waere sein
        // Entwurf ein leerer Platzhalter, der den frischen Stand ueberschriebe.
        if (!gespeicherte || !seite.page_config) return eigen
        return {
          ...eigen,
          page_config: {
            ...node.page_config,
            includes: [...(seite.page_config.includes ?? [])],
            ignore_global_includes: seite.page_config.ignore_global_includes === true,
            popup: seite.page_config.popup ?? null,
          },
        }
      }),
    }),
  )
})

const applied = ref(null)

/** Das Element, dessen Bindungsformular offen steht. */
const selectedId = ref(null)
const selected = computed(() => pageWidgets.value.find((w) => w.id === selectedId.value) || null)

onMounted(async () => {
  if (!allowed.value) return
  await ladeBaum()
  if (pageId.value) await editor.select(pageId.value)
})

// Ein Wechsel der Adresse (Deep-Link, Zurueck-Taste) waehlt die Seite aus, ohne
// den Baum erneut zu laden.
watch(pageId, async (neu, vorher) => {
  if (!allowed.value || neu === vorher) return
  selectedId.value = null
  await editor.select(neu)
})

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
