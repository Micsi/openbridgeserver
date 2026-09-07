<script setup>
/**
 * Admin-Bereich „Visu-Editor" (M5 C4 Issue #171, erweitert um C1 Issue #168,
 * C2 Issue #169 und C3 Issue #170).
 *
 * Owner-Entscheid §2.4: der V2-Editor lebt in der Admin-GUI, weil hier die
 * Berechtigungen ausgewertet werden. Teil C4 lieferte die **Vorschau-Bruecke**
 * und das **Gate**; Teil C1 haengt **Seitenbaum** und **Seiteneigenschaften**
 * daneben; Teil C3 den **Autorenteil** (Palette, Elemente der Seite,
 * Datenpunkt-Bindung, Sichtbarkeitsregel); Teil C2 (Issue #169) den
 * **WYSIWYG-Canvas** (Lage, Layout-Modus, Layer, Ausblenden). Alle fuellen
 * zusammen den `draft`, den C4 transportiert - siehe die Zusammenfuehrung
 * weiter unten.
 *
 * Das Gate liegt doppelt: die Route wird vom Router weggeleitet (siehe
 * `visuEditorGuard`), und diese Ansicht rendert fuer einen Nicht-Admin gar
 * nichts. Ein direkt gemountetes View darf keine Vorschau zeigen, nur weil die
 * Wache umgangen wurde - und es darf weder einen Baum noch eine Seite laden.
 *
 * ZWEI EINHAENGEPUNKTE, bewusst so gelassen:
 *
 *  - `.editor-canvas` ist die Flaeche, auf der **Teil C2** den WYSIWYG-Canvas
 *    baut (Drag/Resize, Raster, Layer). Seit dem Merge von C2 haengt der Canvas
 *    in genau diesem Gitterfeld und bringt die Marke selbst mit. OHNE
 *    ausgewaehlte Seite bleibt der Platzhalter von C1 stehen - er traegt dann
 *    die Marke, und der Playwright-Harness liest sie als „der Editor steht"
 *    (`apps/visu/e2e/editor-helpers.ts` → `openEditor` ohne Seite, der Zustand
 *    von E9/E15). Genau EINE der beiden Flaechen ist da, damit die Marke
 *    eindeutig bleibt.
 *  - Die Vorschau bleibt DIREKTES Kind des `visu-editor`-Kastens. Ihr
 *    Vorfahrenpfad ist in `tests/components/visu/VisuEditorView.spec.js`
 *    gepinnt (Paritaetsnachweis E3); ein neuer Kasten dazwischen waere ein
 *    stiller Eingriff in fremdes Beweismaterial. Der Autorenteil von C3 und der
 *    Canvas von C2 haengen deshalb als GESCHWISTER daneben, nicht darum herum.
 *
 * ZWEI ENTWUERFE, EINE VORSCHAU: der Autorenteil (C1+C3) und der Canvas (C2)
 * beschreiben dieselbe Seite aus verschiedenen Haenden. Zusammengelegt werden
 * sie in `utils/visuEditorDraftMerge.js`; die Zustaendigkeiten stehen dort.
 *
 * `pageId` kommt zusaetzlich als PROP aus der Route (`props: true`), damit diese
 * Ansicht ohne Router montierbar bleibt (M5 C2).
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
import VisuEditorCanvas from '@/components/visu/VisuEditorCanvas.vue'
import VisuPageHistory from '@/components/visu/VisuPageHistory.vue'
import VisuPageTransfer from '@/components/visu/VisuPageTransfer.vue'
import { mergePreviewDrafts } from '@/utils/visuEditorDraftMerge'
import HelpButton from '@/components/ui/HelpButton.vue'

const props = defineProps({
  /** Die Seite aus der Route (`/visu-editor/:pageId`, `props: true`). */
  pageId: { type: String, default: null },
})

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
const pageId = computed(() => {
  if (!allowed.value) return null
  const ausRoute = route && route.params ? route.params.pageId : null
  return props.pageId ?? ausRoute ?? null
})

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
  setWidgets,
  addWidget,
} = useVisuEditorDraft(pageId, { tree: async () => (await ladeBaum(), editor.nodes) })

/**
 * DREI ANSICHTEN, EIN ENTWURF (Nachzug M5 C3 Runde 2, #170/#173).
 *
 * Die Textansicht des Canvas (E13) zeigt dieselbe Seite wie die Flaeche und wie
 * die Autorenliste daneben. Wer dort einen Namen, eine Bindung oder einen
 * Konfig-Schluessel aendert - oder ein Element loescht -, aendert damit den
 * EINEN Entwurf, und der Autorenteil muss mitziehen.
 *
 * OHNE DIESE ZEILE war es ein stiller Verlust: der Autorenteil hielt seinen
 * alten Stand, der Canvas legte ihn beim Speichern ueber die Textaenderung
 * (`adoptAuthored`), der Server bekam den alten Namen - und „Gespeichert" stand
 * darueber. Im Browser gemessen, per Gegenprobe auf `adoptAuthored()`
 * zurueckgefuehrt.
 */
function uebernimmTextstand(widgets) {
  setWidgets(widgets)
}

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
/**
 * Der Entwurf des AUTORENTEILS (C1 + C3) - die eine Haelfte. Die andere kommt
 * aus dem Canvas (C2); zusammengelegt werden sie weiter unten in `draft`.
 */
const autorenUndEigenschaften = computed(() => {
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

/** Die Vorschau-Breite, die der Autor am Canvas gewaehlt hat (E17), oder `null`. */
const previewWidth = ref(null)
/** Der Entwurf des Canvas (C2): Lage, Layout-Modus, Layer-Schalter. */
const canvasDraft = ref(null)
/** Die Kacheln, die der Canvas gerade ausblendet (E8) - siehe den Zusammenleger. */
const canvasHiddenIds = ref([])

/**
 * DER ENTWURF, DEN DIE VORSCHAU BEKOMMT: beide Haelften zusammengelegt.
 * Wer welchen Belang entscheidet, steht in `utils/visuEditorDraftMerge.js`.
 */
const draft = computed(() =>
  mergePreviewDrafts(autorenUndEigenschaften.value, canvasDraft.value, {
    hiddenIds: canvasHiddenIds.value,
  }),
)

/** Das Element, dessen Bindungsformular offen steht. */
const selectedId = ref(null)
const selected = computed(() => pageWidgets.value.find((w) => w.id === selectedId.value) || null)

/**
 * Die Auswahl des Canvas ist DIESELBE Auswahl (M5 Teil D, Issue #174).
 *
 * Vorher waren es zwei: ein Klick auf eine Kachel waehlte sie auf der Flaeche
 * aus, das Bindungsformular darunter meldete aber weiter „Kein Element
 * ausgewaehlt" - der Autor musste dasselbe Element ein zweites Mal in der Liste
 * anklicken, und wer das nicht wusste, kam an die Bindung gar nicht heran.
 *
 * Uebernommen wird die Id UNGEPRUEFT, und das ist Absicht. Der erste Entwurf
 * liess nur durch, was gerade schon in `pageWidgets` stand - und genau daran
 * fiel er unter Last um: Canvas und Store laden ihre Seite getrennt, und ein
 * Klick, der vor dem Store ankam, wurde still verworfen (an der laufenden
 * Instanz gemessen, mal offenes, mal geschlossenes Formular auf derselben
 * Seite). Die Pruefung ist ohnehin ueberfluessig: `selected` schlaegt die Id in
 * `pageWidgets` nach und liefert `null`, solange dort nichts passt. Ein Element
 * einer Include- oder Global-Ebene, das der Ansicht nicht gehoert, laesst das
 * Formular damit geschlossen; sobald die eigene Seite geladen ist, oeffnet es
 * sich von selbst.
 */
function uebernimmAuswahl(id) {
  selectedId.value = id ?? null
}

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

/* ------------------------------------------------ Verlauf und Datei (C6) */

/**
 * WAEHREND WIEDERHERGESTELLT WIRD, IST DER CANVAS WEG - und das ist keine
 * Kosmetik (M5 C6, Issue #173, E12).
 *
 * Der Canvas haelt einen Entwurf. Vom Augenblick des Klicks an beschreibt der
 * nicht mehr die Seite: unter ihm wird gerade ein anderer Stand geschrieben.
 * Ihn stehenzulassen hiesse, dem Autor eine Lage zu zeigen, die es nicht mehr
 * gibt - und der naechste „Speichern"-Klick schriebe sie zurueck.
 *
 * Zurueck kommt er als NEUE Montage (`v-if`), nicht als aufgefrischte: so
 * durchlaeuft er seinen eigenen Ladeweg und liest den wiederhergestellten Stand
 * vom Server, statt einen mitgebrachten zu behalten. Das gilt auch nach einem
 * FEHLSCHLAG: dann steht auf dem Server der alte Stand, und genau den soll der
 * Autor sehen.
 */
const restoring = ref(false)
/** Der Verlaufs-Kasten - der Canvas zieht ihn nach, bevor er quittiert. */
const historyRef = ref(null)

/**
 * Was nach einem Speichern des Canvas noch geschehen muss, BEVOR „Gespeichert"
 * erscheint: der Verlauf wird nachgezogen (E12). Sonst zeigte ein Blick in den
 * Verlauf unmittelbar nach dem Speichern die Liste von vor dem Speichern.
 */
async function nachSpeichern() {
  // DER STAND DER SEITENEIGENSCHAFTEN ZIEHT MIT (#187).
  //
  // Ihr Speicherplan baut seine Nutzlast auf der Konfiguration, die der Store
  // beim Auswaehlen der Seite gelesen hat. Ohne dieses Nachlesen stuende dort
  // weiter die Widget-Liste von vorher, und ein Klick auf „Speichern" in den
  // Seiteneigenschaften machte die gerade gespeicherte Autorenarbeit wieder
  // zunichte - Name, Bindung, Regel und ganze Elemente, mit zwei Quittungen
  // „Gespeichert" hintereinander (gemessen). Ein `GET`, kein zweiter Schreiber.
  if (allowed.value && pageId.value) await editor.refreshPageConfig(pageId.value)
  await historyRef.value?.reload?.()
}

function onRestoreStart() {
  restoring.value = true
}

/**
 * Nach dem Wiederherstellen wird der Store neu geladen.
 *
 * Das ist die Antwort auf den DRITTEN SCHREIBER. Formular (C1) und Canvas (C2)
 * schreiben `page_config` heute unabhaengig voneinander
 * (Micsi/openbridgeserver#187). Das Formular haelt nach einem Wiederherstellen
 * noch den Entwurf von vorher - `includes`, Popup-Deskriptor, Zugriff -, und
 * sein naechstes „Speichern" schriebe ihn zurueck und machte die
 * Wiederherstellung stillschweigend rueckgaengig. Beide Haelften holen sich
 * deshalb ihren Stand neu: der Canvas ueber seine Neumontage, das Formular
 * ueber diesen Ladevorgang.
 *
 * DIE SPERRE FAELLT ZULETZT, nicht zuerst. Zwischen `restored` und dem frischen
 * Entwurf liegen zwei Runden zum Server; gaebe `restoring` schon davor frei,
 * waere das Formular in dieser Zeit bedienbar UND haette noch den alten Stand -
 * genau die Lage, gegen die die Sperre da ist, nur um zwei HTTP-Runden
 * verschoben. Mit kuenstlich geweitetem Fenster war sie in Runde 2 messbar
 * (der alte Entwurf gewann). Das `finally` gilt auch fuer den Abbruch oben und
 * fuer ein gescheitertes Laden: nach einem Wiederherstellen wird dieses
 * Formular in jedem Fall wieder bedienbar.
 */
async function onRestored() {
  try {
    if (!allowed.value) return
    await editor.load()
    if (pageId.value) await editor.select(pageId.value)
  } finally {
    restoring.value = false
  }
}

/** Nach einem Import steht ein neuer Knoten im Baum; ohne Neuladen saehe ihn niemand. */
async function onImported() {
  if (!allowed.value) return
  await editor.load()
}

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
      <div class="flex items-center gap-2">
        <h1 class="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {{ $t('visuEditor.title') }}
        </h1>
        <HelpButton help-id="visu-editor" />
      </div>
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ $t('visuEditor.intro') }}
      </p>
    </header>

    <div class="grid gap-4 lg:grid-cols-3">
      <VisuPageTree />

      <!-- Teil C2 (WYSIWYG-Canvas, Issue #169). OHNE ausgewaehlte Seite bleibt
           der Platzhalter stehen: er traegt `.editor-canvas`, und der
           Playwright-Harness liest die Marke als „der Editor steht"
           (`apps/visu/e2e/editor-helpers.ts` -> `openEditor` ohne Seite, der
           Zustand von E9/E15). Genau EINE der beiden Flaechen ist da, damit die
           Marke eindeutig bleibt. -->
      <!--
        `order-first` auf schmalen Geraeten: das Gitter faellt unter `lg` auf
        EINE Spalte zusammen, und in DOM-Reihenfolge stuende der Canvas dann
        unter dem Seitenbaum - bei 393x851 (der Viewport des M5-Harness) ausser
        Sicht. Ein Zeiger-Drag rechnet aber mit `boundingBox()` und scrollt
        nicht mit; E1 landete damit auf x=0 statt x=40, E4 fand keine
        Ausrichtlinie. Gemessen im ersten Integrationslauf. Ab `lg` gilt wieder
        die Anordnung aus Teil C1: Baum | Canvas | Eigenschaften.
      -->
      <VisuEditorCanvas
        v-if="pageId && !restoring"
        class="order-first lg:order-none"
        :page-id="pageId"
        :after-save="nachSpeichern"
        :authored-widgets="pageWidgets"
        @draft="canvasDraft = $event"
        @preview-width="previewWidth = $event"
        @hidden-ids="canvasHiddenIds = $event"
        @selected="uebernimmAuswahl"
        @widgets="uebernimmTextstand"
      />
      <!-- Waehrend eines Wiederherstellens traegt dieser Platzhalter bewusst
           NICHT die Marke `.editor-canvas`: sie steht fuer „der Editor zeigt die
           Seite", und genau das tut er in diesem Augenblick nicht. -->
      <div
        v-else-if="pageId"
        data-testid="visu-editor-restoring"
        class="order-first min-h-40 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 lg:order-none dark:border-slate-600 dark:text-slate-400"
      >
        {{ $t('visuEditor.restoring') }}
      </div>
      <div
        v-else
        class="editor-canvas min-h-40 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-4 text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.canvasHint') }}
      </div>

      <!-- Waehrend eines Wiederherstellens ist dieses Formular GESPERRT. Der
           Canvas verschwindet dabei; das Formular bleibt stehen (es zeigt Name
           und Zugriff, nicht nur die Flaeche) - und ein Klick auf sein
           „Speichern" im Sekundenbruchteil zwischen `restore-start` und
           `restored` schriebe den Entwurf von vorher ueber den gerade
           wiederhergestellten Stand. Dieselbe Begruendung wie das Aushaengen
           des Canvas, nur mit dem Mittel, das zu einem stehenbleibenden
           Formular passt. -->
      <VisuPageProperties :restoring="restoring" />
    </div>

    <!-- Verlauf und Datei (M5 C6, Issue #173): E12 und E18. Beide stehen NEBEN
         dem Editor, nicht darin - der Verlauf gehoert der Seite, der Import gar
         keiner (er legt eine neue an und ist deshalb auch ohne ausgewaehlte
         Seite da). -->
    <div class="flex flex-wrap items-start gap-4">
      <VisuPageHistory
        ref="historyRef"
        :page-id="pageId"
        @restore-start="onRestoreStart"
        @restored="onRestored"
      />
      <VisuPageTransfer
        :page-id="pageId"
        @imported="onImported"
      />
    </div>

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
