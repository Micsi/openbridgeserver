<script setup>
/**
 * Die eingebettete WYSIWYG-Vorschau des Visu-Editors (M5 C4, Issue #171).
 *
 * Der iframe zeigt den `/preview`-Modus der echten Visu; der Entwurf reist per
 * `postMessage` hinueber und wird dort ueber denselben SkinHost gerendert
 * (Messlatte **E3**: die Vorschau IST die Visu, kein Nachbau).
 *
 * Die Admin-Session geht ausschliesslich ueber die Bruecke an den geprueften
 * Origin — nie an die iframe-URL (`src` bleibt der nackte Pfad).
 *
 * Die Ausliefer-Route steht seit Teil D (#174): `obs/main.py` mountet
 * `visu_v2_dist/` unter `/visu-v2/`, und `/visu-v2/preview` liefert die echte
 * Visu aus. Fehlt das Verzeichnis, antwortet die Route mit 404 — NICHT mit der
 * Admin-Schale; ein verschachteltes Dashboard im Vorschaukasten kann es also
 * nicht mehr geben.
 *
 * Antwortet im Rahmen trotzdem keine Vorschau, ist das eine sichtbare Lage und
 * kein Schweigen: nach der Handshake-Frist steht dort ein Hinweis. Zwei
 * Ursachen sind haeufig — die V2-Visu ist nicht gebaut (`visu_v2_dist/` fehlt;
 * in den VEROEFFENTLICHTEN Paketen ist das bis Micsi/openbridgeserver#191 noch
 * der Normalfall), oder Admin-GUI und Visu laufen im Entwicklungsbetrieb
 * getrennt und `VITE_VISU_PREVIEW_URL`/`VITE_PREVIEW_ALLOWED_ORIGINS` passen
 * nicht zusammen (s. `visuEditorAccess.js`).
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { createVisuPreviewBridge } from '@/composables/useVisuPreviewBridge'
import { previewOriginOf, VISU_PREVIEW_URL } from '@/utils/visuEditorAccess'
import HelpButton from '@/components/ui/HelpButton.vue'

const props = defineProps({
  /** Der Entwurf, den die Vorschau zeigen soll (C1–C3 fuellen ihn). */
  draft: { type: Object, default: null },
  /**
   * Feste Breite des Rahmens in CSS-Pixeln, oder `null` fuer „so breit wie der
   * Platz" (C2, Messlatte **E17**: die Vorschau folgt dem gewaehlten Breakpoint).
   *
   * `box-sizing: content-box` steht bewusst dabei: die GUI setzt global
   * `border-box`, und mit dem Rahmenstrich waere die INNERE Breite - also die,
   * die die Vorschau zum Layouten hat - um die Rahmenbreite kleiner als der
   * gewaehlte Breakpoint. Ein 480er Breakpoint muss 480 Pixel breit layouten.
   *
   * Die Deklaration aendert die BREITE, nicht das BILD: sie gehoert keiner der
   * Familien (`transform`/`filter`/`zoom`/`opacity`), gegen die der Zaun um den
   * Rahmen steht (`tests/helpers/previewFrameFence.js`).
   */
  width: { type: Number, default: null },
})
const emit = defineEmits(['applied', 'rejected'])

const frame = ref(null)
const rejected = ref(null)
/** Kein Handshake innerhalb der Frist — im Rahmen liegt keine Vorschau. */
const unreachable = ref(false)
const previewUrl = VISU_PREVIEW_URL
const previewOrigin = computed(() => previewOriginOf(previewUrl, window.location.href))
/** Kein `style`-Attribut, solange keine Breite gewaehlt ist (der Pin liest es). */
const frameStyle = computed(() =>
  props.width === null || props.width === undefined
    ? null
    : { width: `${props.width}px`, boxSizing: 'content-box' },
)

const bridge = createVisuPreviewBridge({
  previewOrigin: previewOrigin.value,
  listener: window,
  getFrameWindow: () => (frame.value ? frame.value.contentWindow : null),
  getSession: () => {
    const accessToken = localStorage.getItem('access_token')
    return accessToken ? { accessToken } : null
  },
  getDraft: () => props.draft,
  // Der Handshake steht - auch wenn er die Frist gerissen hat. Der Hinweis
  // „keine Vorschau erreichbar" waere ab jetzt falsch. Auf `draft-applied` zu
  // warten reicht dafuer nicht: solange der Editor keinen Entwurf haelt, kommt
  // nie einer, und der Hinweis stuende dauerhaft.
  onAccepted: () => {
    unreachable.value = false
  },
  onApplied: (info) => {
    unreachable.value = false
    emit('applied', info)
  },
  onRejected: (reason) => {
    rejected.value = reason
    emit('rejected', reason)
  },
  onTimeout: () => {
    unreachable.value = true
  },
})

onMounted(() => bridge.start())
onBeforeUnmount(() => bridge.stop())
// Jeder neue Entwurf geht sofort hinueber — gespeichert wird dabei nichts.
watch(() => props.draft, () => bridge.sendDraft(), { deep: true })
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- GESCHWISTER des Rahmens, nie ein Vorfahre: der Vorfahrenpfad des
         `<iframe>` ist gepinnt (`tests/helpers/previewFrameFence.js`), weil
         `transform`/`filter`/`zoom`/`opacity` darauf dem Autor ein anderes Bild
         zeigen wuerden als dem Nutzer (E3). -->
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {{ $t('visuEditor.previewTitle') }}
      </h2>
      <HelpButton help-id="visu-editor-preview" />
    </div>
    <iframe
      ref="frame"
      data-testid="visu-preview-frame"
      :src="previewUrl"
      :title="$t('visuEditor.previewTitle')"
      class="editor-preview w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white"
      :style="frameStyle"
    />
    <p
      v-if="rejected"
      data-testid="visu-preview-rejected"
      class="text-sm text-amber-600 dark:text-amber-400"
    >
      {{ $t('visuEditor.rejected') }}
    </p>
    <p
      v-if="unreachable && !rejected"
      data-testid="visu-preview-unreachable"
      class="text-sm text-amber-600 dark:text-amber-400"
    >
      {{ $t('visuEditor.unreachable') }}
    </p>
  </div>
</template>
