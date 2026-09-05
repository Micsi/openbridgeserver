<script setup>
/**
 * Datenpunkt-Bindung mit Suche und Filter (Messlatte **E11**, Issue #170).
 *
 * Gesucht wird SERVERSEITIG (`GET /search/`), nicht in einer im Browser
 * gehaltenen Liste: eine Anlage hat Tausende Datenpunkte, und eine Palette, die
 * sie erst alle laedt, waere genau bei der Anlage unbrauchbar, fuer die sie
 * gebaut ist. Deshalb ruft jede Eingabe die Suche - mit einem Generationszaehler,
 * damit eine spaet zurueckkommende alte Antwort die neue nicht ueberschreibt.
 *
 * Geladen wird erst beim Oeffnen. Ein Bindungsformular zeigt bis zu fuenfzehn
 * dieser Waehler; wuerde jeder beim Mounten suchen, kostete ein Klick auf ein
 * Element fuenfzehn Anfragen fuer eine Liste, die niemand sehen will.
 *
 * Der Token steht nie in einer URL: die Suche laeuft ueber den Axios-Client, der
 * ihn in den `Authorization`-Kopf setzt.
 */
import { ref, computed, watch } from 'vue'
import { searchApi, systemApi } from '@/api/client'

const props = defineProps({
  /** Die gebundene Datenpunkt-Id (oder null). */
  modelValue: { type: String, default: null },
  /** Der Anzeigename der Bindung, wenn er bekannt ist. */
  datapointName: { type: String, default: '' },
  /** Eindeutiges Praefix fuer die Feld-Ids (ein Formular traegt viele Waehler). */
  idPrefix: { type: String, default: 'dp' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const query = ref('')
const datatype = ref('')
const items = ref([])
const datatypes = ref([])
const loading = ref(false)
let generation = 0

const searchId = computed(() => `${props.idPrefix}-search`)
const filterId = computed(() => `${props.idPrefix}-filter`)
const gebunden = computed(() => Boolean(props.modelValue))
const anzeige = computed(() => props.datapointName || props.modelValue || '')

async function suchen() {
  const meine = ++generation
  loading.value = true
  try {
    const params = { page: 0, size: 50, sort: 'name', order: 'asc' }
    if (query.value) params.q = query.value
    if (datatype.value) params.type = datatype.value
    const { data } = await searchApi.search(params)
    if (meine !== generation) return
    items.value = data?.items ?? []
  } catch {
    if (meine !== generation) return
    items.value = []
  } finally {
    if (meine === generation) loading.value = false
  }
}

async function oeffnen() {
  open.value = true
  if (datatypes.value.length === 0) {
    try {
      const { data } = await systemApi.datatypes()
      datatypes.value = (data ?? []).map((entry) => entry.name)
    } catch {
      datatypes.value = []
    }
  }
  await suchen()
}

function waehlen(item) {
  emit('update:modelValue', item.id)
  open.value = false
}

function loesen() {
  emit('update:modelValue', null)
}

watch([query, datatype], () => {
  if (open.value) void suchen()
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <button
        :id="`${idPrefix}-open`"
        type="button"
        class="dp-picker-open rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        @click="oeffnen"
      >
        {{ $t('visuEditor.binding.choose') }}
      </button>
      <span
        v-if="gebunden"
        class="dp-picker-value truncate text-sm text-slate-600 dark:text-slate-300"
      >{{ anzeige }}</span>
      <span
        v-else
        class="text-sm text-slate-400 dark:text-slate-500"
      >{{ $t('visuEditor.binding.unbound') }}</span>
      <button
        v-if="gebunden"
        type="button"
        class="dp-picker-clear text-sm text-slate-500 underline dark:text-slate-400"
        @click="loesen"
      >
        {{ $t('visuEditor.binding.clear') }}
      </button>
    </div>

    <div
      v-if="open"
      class="dp-picker flex flex-col gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-700"
    >
      <div class="flex flex-col gap-1">
        <label
          :for="searchId"
          class="text-xs text-slate-500 dark:text-slate-400"
        >{{ $t('visuEditor.binding.searchLabel') }}</label>
        <input
          :id="searchId"
          v-model="query"
          class="dp-picker-search rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
          type="search"
        >
      </div>
      <div class="flex flex-col gap-1">
        <label
          :for="filterId"
          class="text-xs text-slate-500 dark:text-slate-400"
        >{{ $t('visuEditor.binding.filterLabel') }}</label>
        <select
          :id="filterId"
          v-model="datatype"
          class="dp-picker-filter rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">
            {{ $t('visuEditor.binding.filterAll') }}
          </option>
          <option
            v-for="name in datatypes"
            :key="name"
            :value="name"
          >
            {{ name }}
          </option>
        </select>
      </div>

      <ul class="flex max-h-64 flex-col gap-1 overflow-y-auto">
        <li
          v-for="item in items"
          :key="item.id"
        >
          <button
            type="button"
            class="dp-picker-item w-full rounded-md px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
            @click="waehlen(item)"
          >
            <span class="font-medium text-slate-700 dark:text-slate-100">{{ item.name }}</span>
            <span class="ml-2 text-xs text-slate-400">{{ item.data_type }}</span>
          </button>
        </li>
      </ul>
      <p
        v-if="items.length === 0 && !loading"
        class="dp-picker-empty text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.binding.noHits') }}
      </p>
    </div>
  </div>
</template>
