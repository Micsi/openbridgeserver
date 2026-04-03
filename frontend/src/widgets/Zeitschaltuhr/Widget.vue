<script setup lang="ts">
import { computed } from 'vue'
import { useDatapointsStore } from '@/stores/datapoints'
import type { DataPointValue } from '@/types'

const props = defineProps<{
  config: Record<string, unknown>
  datapointId: string | null
  value: DataPointValue | null
  statusValue: DataPointValue | null
  editorMode: boolean
}>()

const dpStore = useDatapointsStore()

const label          = computed(() => (props.config.label        as string  | undefined) ?? '—')
const cfgDatapointId = computed(() => (props.config.datapoint_id as string  | undefined) ?? '')
const bindingEnabled = computed(() => (props.config.binding_enabled as boolean | undefined))
const hasBinding     = computed(() => !!(props.config.binding_id as string | undefined))

/** Live-Wert aus dem Datenpunkt-Store (wird via getExtraDatapointIds abonniert) */
const liveValue = computed((): DataPointValue | null => {
  if (props.editorMode || !cfgDatapointId.value) return null
  return dpStore.getValue(cfgDatapointId.value)
})

function resolveBool(v: DataPointValue | null): boolean | null {
  if (v === null) return null
  const raw = v.v
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number')  return raw !== 0
  if (typeof raw === 'string')  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on'
  return null
}

const outputActive = computed(() => resolveBool(liveValue.value))
const quality      = computed(() => liveValue.value?.q ?? null)

/** Klick öffnet die Datenpunkt-Detailansicht im Admin-Frontend */
function openAdmin() {
  if (props.editorMode || !cfgDatapointId.value) return
  window.open(`/datapoints/${cfgDatapointId.value}`, '_blank')
}
</script>

<template>
  <div
    class="flex flex-col h-full p-3 select-none gap-1.5"
    :class="!editorMode && cfgDatapointId ? 'cursor-pointer' : 'cursor-default'"
    @click="openAdmin"
  >
    <!-- Kopfzeile: Icon + Beschriftung + Qualitätsindikator -->
    <div class="flex items-center gap-1.5 min-w-0">
      <span class="text-sm leading-none flex-shrink-0">🕐</span>
      <span class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ label }}</span>
      <span
        v-if="quality === 'bad'"
        class="ml-auto w-2 h-2 rounded-full bg-red-500 flex-shrink-0"
        title="Qualität: schlecht"
      />
      <span
        v-else-if="quality === 'uncertain'"
        class="ml-auto w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0"
        title="Qualität: undefiniert"
      />
    </div>

    <!-- Ausgang: AKTIV / INAKTIV -->
    <div class="flex items-center gap-2 mt-1">
      <span
        class="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-semibold leading-none"
        :class="outputActive === null
          ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
          : outputActive
            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'"
      >
        {{ outputActive === null ? (editorMode ? '—' : '…') : outputActive ? 'AKTIV' : 'INAKTIV' }}
      </span>
    </div>

    <!-- Aktivierungsstatus der Verknüpfung (nur wenn Verknüpfung gewählt) -->
    <div v-if="hasBinding" class="flex items-center gap-1.5 mt-auto">
      <span
        class="w-1.5 h-1.5 rounded-full flex-shrink-0"
        :class="bindingEnabled ? 'bg-blue-400' : 'bg-gray-400 dark:bg-gray-600'"
      />
      <span class="text-xs text-gray-400 dark:text-gray-500">
        {{ bindingEnabled ? 'ZSU aktiviert' : 'ZSU deaktiviert' }}
      </span>
    </div>
  </div>
</template>
