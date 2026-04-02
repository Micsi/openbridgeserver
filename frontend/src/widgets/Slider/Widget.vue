<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { datapoints } from '@/api/client'
import type { DataPointValue } from '@/types'

const props = defineProps<{
  config: Record<string, unknown>
  datapointId: string | null
  value: DataPointValue | null
  statusValue: DataPointValue | null
  editorMode: boolean
}>()

const label = computed(() => (props.config.label as string | undefined) ?? '—')
const min   = computed(() => (props.config.min  as number | undefined) ?? 0)
const max   = computed(() => (props.config.max  as number | undefined) ?? 100)
const step  = computed(() => (props.config.step as number | undefined) ?? 1)

// Status-Datenpunkt hat Vorrang für die Anzeige
const displayValue = computed(() => props.statusValue ?? props.value)

const unit = computed(() => (props.config.unit as string | undefined) ?? (displayValue.value?.u ?? ''))

/** Wandelt DataPointValue in eine Zahl um – akzeptiert number und string */
function toNumber(v: DataPointValue | null): number {
  if (v === null) return min.value
  const raw = v.v
  if (typeof raw === 'number') return raw
  const parsed = parseFloat(String(raw))
  return isNaN(parsed) ? min.value : parsed
}

// localValue: nur der Ziehlwert während der Nutzer dragged
const localValue = ref(toNumber(displayValue.value))
const isDragging = ref(false)

/**
 * Anzeigewert:
 * - Während des Ziehens: localValue (sofortige UI-Reaktion)
 * - Sonst: immer aktueller Status-Datenpunkt-Wert (reaktiv!)
 *
 * Durch das Computed wird displayValue immer angezeigt wenn isDragging=false,
 * auch wenn sich der Wert extern ändert (z.B. Schalter ausschalten).
 */
const shownValue = computed(() =>
  isDragging.value ? localValue.value : toNumber(displayValue.value)
)

// localValue mit Status synchron halten, damit Drag vom richtigen Wert startet
watch(displayValue, (v) => {
  if (!isDragging.value) {
    localValue.value = toNumber(v)
  }
})

// Sicherheits-Reset: falls pointerup ausserhalb des Elements endet,
// isDragging trotzdem zurücksetzen
function onWindowPointerUp() {
  if (isDragging.value) {
    isDragging.value = false
  }
}
onMounted(() => window.addEventListener('pointerup', onWindowPointerUp))
onUnmounted(() => window.removeEventListener('pointerup', onWindowPointerUp))

/** @input → Live-Vorschau während des Ziehens (kein Senden) */
function onInput(e: Event) {
  isDragging.value = true
  localValue.value = Number((e.target as HTMLInputElement).value)
}

/** @change → feuert beim Loslassen (Maus, Touch, Tastatur) → Wert senden */
function onChange(e: Event) {
  localValue.value = Number((e.target as HTMLInputElement).value)
  isDragging.value = false
  sendValue()
}

async function sendValue() {
  if (props.editorMode || !props.datapointId) return
  try {
    await datapoints.write(props.datapointId, localValue.value)
  } catch {
    // Fehler ignorieren — Nutzer sieht den Slider-Wert noch
  }
}
</script>

<template>
  <div class="flex flex-col justify-between h-full p-3 select-none">
    <span class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ label }}</span>
    <div class="flex items-baseline gap-1 my-1">
      <span class="text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ shownValue }}</span>
      <span v-if="unit" class="text-sm text-gray-400 dark:text-gray-400">{{ unit }}</span>
    </div>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="shownValue"
      :disabled="editorMode"
      class="w-full accent-blue-500 cursor-pointer disabled:cursor-default disabled:opacity-50"
      @input="onInput"
      @change="onChange"
    />
    <div class="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-0.5">
      <span>{{ min }}</span>
      <span>{{ max }}</span>
    </div>
  </div>
</template>
