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
 * Wenn im Rahmen gar keine Vorschau antwortet, ist das eine sichtbare Lage und
 * kein Schweigen: heute liefert der Server unter der Standard-Vorschauadresse
 * ueber seinen SPA-404-Fallback die Admin-GUI selbst aus, im Vorschaukasten
 * stuende also ein verschachteltes Dashboard. Nach der Handshake-Frist steht
 * stattdessen ein Hinweis. Die echte Ausliefer-Route der Vorschau gehoert zu
 * **Teil D** (s. `visuEditorAccess.js`).
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { createVisuPreviewBridge } from '@/composables/useVisuPreviewBridge'
import { previewOriginOf, VISU_PREVIEW_URL } from '@/utils/visuEditorAccess'

const props = defineProps({
  /** Der Entwurf, den die Vorschau zeigen soll (C1–C3 fuellen ihn). */
  draft: { type: Object, default: null },
})
const emit = defineEmits(['applied', 'rejected'])

const frame = ref(null)
const rejected = ref(null)
/** Kein Handshake innerhalb der Frist — im Rahmen liegt keine Vorschau. */
const unreachable = ref(false)
const previewUrl = VISU_PREVIEW_URL
const previewOrigin = computed(() => previewOriginOf(previewUrl, window.location.href))

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
    <iframe
      ref="frame"
      data-testid="visu-preview-frame"
      :src="previewUrl"
      :title="$t('visuEditor.previewTitle')"
      class="w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white"
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
