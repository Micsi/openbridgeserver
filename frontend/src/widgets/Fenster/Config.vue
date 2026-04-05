<script setup lang="ts">
import { reactive, computed, watch } from 'vue'
import DataPointPicker from '@/components/DataPointPicker.vue'

const props = defineProps<{ modelValue: Record<string, unknown> }>()
const emit = defineEmits<{ (e: 'update:modelValue', val: Record<string, unknown>): void }>()

const cfg = reactive({
  label:           (props.modelValue.label           as string) ?? '',
  mode:            (props.modelValue.mode            as string) ?? 'fenster',
  dp_contact:      (props.modelValue.dp_contact      as string) ?? '',
  dp_tilt:         (props.modelValue.dp_tilt         as string) ?? '',
  dp_contact_left: (props.modelValue.dp_contact_left as string) ?? '',
  dp_tilt_left:    (props.modelValue.dp_tilt_left    as string) ?? '',
  dp_contact_right:(props.modelValue.dp_contact_right as string) ?? '',
  dp_tilt_right:   (props.modelValue.dp_tilt_right   as string) ?? '',
  dp_position:     (props.modelValue.dp_position     as string) ?? '',
})

const isSingleWing  = computed(() => cfg.mode === 'fenster')
const isDoubleWing  = computed(() => cfg.mode === 'fenster_2')
const isDoor        = computed(() => cfg.mode === 'tuere')
const isSlidingDoor = computed(() => cfg.mode === 'schiebetuer')
const isRoof        = computed(() => cfg.mode === 'dachfenster')

const showContact = computed(() => isSingleWing.value || isDoor.value || isSlidingDoor.value || isRoof.value)
const showTilt    = computed(() => isSingleWing.value || isRoof.value)
const showWings   = computed(() => isDoubleWing.value)
const showPosition = computed(() => isRoof.value)

watch(cfg, () => emit('update:modelValue', { ...cfg }), { deep: true })
</script>

<template>
  <div class="space-y-3">
    <!-- Beschriftung -->
    <div>
      <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Beschriftung</label>
      <input
        v-model="cfg.label"
        type="text"
        placeholder="z.B. Wohnzimmer Süd"
        class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
      />
    </div>

    <!-- Typ -->
    <div>
      <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Typ</label>
      <select
        v-model="cfg.mode"
        class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
      >
        <option value="fenster">Einflügelfenster</option>
        <option value="fenster_2">Zweiflügelfenster</option>
        <option value="tuere">Türe</option>
        <option value="schiebetuer">Schiebetüre</option>
        <option value="dachfenster">Dachfenster</option>
      </select>
    </div>

    <hr class="border-gray-200 dark:border-gray-700" />

    <!-- Single/Door/Sliding/Roof: main contact -->
    <template v-if="showContact">
      <p class="text-xs font-medium text-gray-600 dark:text-gray-400">Kontakt (BOOLEAN: true = offen)</p>
      <DataPointPicker
        v-model="cfg.dp_contact"
        label="Fensterkontakt / Türkontakt"
        :compatible-types="['BOOLEAN']"
      />
    </template>

    <!-- Tilt contact (single-wing, roof) -->
    <template v-if="showTilt">
      <DataPointPicker
        v-model="cfg.dp_tilt"
        label="Kippsensor (optional, BOOLEAN: true = gekippt)"
        :compatible-types="['BOOLEAN']"
      />
    </template>

    <!-- Double-wing contacts -->
    <template v-if="showWings">
      <p class="text-xs font-medium text-gray-600 dark:text-gray-400">Linker Flügel (BOOLEAN: true = offen)</p>
      <DataPointPicker
        v-model="cfg.dp_contact_left"
        label="Kontakt links"
        :compatible-types="['BOOLEAN']"
      />
      <DataPointPicker
        v-model="cfg.dp_tilt_left"
        label="Kippsensor links (optional)"
        :compatible-types="['BOOLEAN']"
      />

      <p class="text-xs font-medium text-gray-600 dark:text-gray-400">Rechter Flügel (BOOLEAN: true = offen)</p>
      <DataPointPicker
        v-model="cfg.dp_contact_right"
        label="Kontakt rechts"
        :compatible-types="['BOOLEAN']"
      />
      <DataPointPicker
        v-model="cfg.dp_tilt_right"
        label="Kippsensor rechts (optional)"
        :compatible-types="['BOOLEAN']"
      />
    </template>

    <!-- Roof window: position percentage -->
    <template v-if="showPosition">
      <hr class="border-gray-200 dark:border-gray-700" />
      <p class="text-xs font-medium text-gray-600 dark:text-gray-400">Öffnungsgrad (optional)</p>
      <DataPointPicker
        v-model="cfg.dp_position"
        label="Öffnung in % (0 = geschlossen, 100 = ganz offen)"
        :compatible-types="['FLOAT', 'INTEGER']"
      />
    </template>
  </div>
</template>
