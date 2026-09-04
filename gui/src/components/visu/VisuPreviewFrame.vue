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
  onApplied: (info) => emit('applied', info),
  onRejected: (reason) => {
    rejected.value = reason
    emit('rejected', reason)
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
  </div>
</template>
