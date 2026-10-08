<template>
  <div class="relative" data-testid="dp-picker">
    <button
      ref="triggerRef"
      type="button"
      class="input flex w-full min-w-0 items-center gap-2 text-left"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-label="selectedRow ? undefined : effectivePlaceholder"
      data-testid="dp-picker-trigger"
      @click="openPanel"
      @keydown.down.prevent="openPanel"
    >
      <DpPathRow v-if="selectedRow" :row="selectedRow" />
      <span v-else class="flex-1 truncate text-slate-400">{{ effectivePlaceholder }}</span>
    </button>

    <Modal :model-value="open" :title="$t('datapoints.picker.title')" max-width="3xl" @update:model-value="closePanel">
      <div class="flex flex-col gap-3" data-testid="dp-picker-panel">
        <input
          ref="searchRef"
          v-model="query"
          type="search"
          role="combobox"
          class="input w-full"
          autocomplete="off"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="listId"
          :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
          :aria-label="$t('datapoints.picker.searchLabel')"
          :placeholder="$t('datapoints.picker.searchPlaceholder')"
          data-testid="dp-picker-search"
          @input="onQueryInput"
          @keydown.down.prevent="moveActive(1)"
          @keydown.up.prevent="moveActive(-1)"
          @keydown.home.prevent="setActive(0)"
          @keydown.end.prevent="setActive(rows.length - 1)"
          @keydown.enter.prevent="selectActive"
          @keydown.escape.prevent.stop="closePanel"
        />

        <div role="tablist" :aria-label="$t('datapoints.picker.lenses')" class="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          <button
            v-for="(item, i) in lenses"
            :id="tabId(item.key)"
            :key="item.key"
            :ref="(el) => (tabRefs[i] = el)"
            type="button"
            role="tab"
            :aria-selected="lens === item.key ? 'true' : 'false'"
            :aria-controls="tabPanelId"
            :tabindex="lens === item.key ? 0 : -1"
            :data-testid="`dp-picker-lens-${item.key}`"
            :class="[
              '-mb-px border-b-2 px-3 py-1.5 text-sm',
              lens === item.key
                ? 'border-blue-500 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
            ]"
            @click="setLens(item.key)"
            @keydown.right.prevent="moveLens(i, 1)"
            @keydown.left.prevent="moveLens(i, -1)"
          >{{ item.label }}</button>
        </div>

        <div :id="tabPanelId" role="tabpanel" :aria-labelledby="tabId(lens)" class="flex flex-col gap-2">
          <div v-if="lens !== 'functions'" class="flex flex-col gap-1">
            <label :for="treeSelectId" class="text-xs text-slate-500">{{ $t('datapoints.picker.treeLabel') }}</label>
            <select
              v-if="trees.length"
              :id="treeSelectId"
              :value="treeId"
              class="input"
              data-testid="dp-picker-tree"
              @change="onTreeChange($event.target.value)"
            >
              <option v-for="tree in trees" :key="tree.id" :value="tree.id">{{ tree.name }}</option>
            </select>
            <p v-else class="text-xs text-slate-500" data-testid="dp-picker-no-trees">{{ $t('datapoints.picker.noTrees') }}</p>
          </div>

          <div v-if="lens === 'hierarchy' && treeId" class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">{{ $t('datapoints.picker.nodesLabel') }}</span>
            <HierarchyCombobox
              :model-value="nodeIds"
              :tree-id="treeId"
              data-testid="dp-picker-nodes"
              @update:model-value="onNodesChange"
            />
          </div>

          <div v-if="lens === 'functions'" class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">{{ $t('datapoints.picker.functionsLabel') }}</span>
            <p v-if="functionsState === 'loading'" class="text-xs text-slate-500" data-testid="dp-picker-functions-loading">{{ $t('common.loading') }}</p>
            <p v-else-if="functionsState === 'error'" role="alert" class="text-xs text-red-600" data-testid="dp-picker-functions-error">
              {{ $t('datapoints.picker.functionsLoadError') }}
              <button type="button" class="ml-1 underline" @click="loadFunctions(true)">{{ $t('datapoints.picker.retry') }}</button>
            </p>
            <p v-else-if="!functions.length" class="text-xs text-slate-500" data-testid="dp-picker-no-functions">{{ $t('datapoints.picker.noFunctions') }}</p>
            <Combobox
              v-else
              :model-value="functionIds"
              :multi="true"
              :placeholder="$t('datapoints.picker.functionsPlaceholder')"
              :fetch-suggestions="functionSuggestions"
              :display-items="functions"
              :empty-text="$t('datapoints.picker.noFunctionMatch')"
              :debounce-ms="0"
              data-testid="dp-picker-functions"
              @update:model-value="onFunctionsChange"
            >
              <template #item="{ item }">
                <PathLabel :segments="item.path" />
                <span class="shrink-0 text-xs text-slate-500">{{ $t('datapoints.picker.functionCount', { n: item.count }) }}</span>
              </template>
              <template #chip="{ item }">
                <span class="truncate" :title="item.label">{{ item.label }}</span>
              </template>
            </Combobox>
          </div>

          <div v-if="lens === 'devices'" class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">{{ $t('datapoints.picker.devicesLabel') }}</span>
            <KnxDeviceCombobox :model-value="devicePas" data-testid="dp-picker-devices" @update:model-value="onDevicesChange" />
          </div>

          <div class="flex items-start gap-2">
            <input
              :id="linkedId"
              type="checkbox"
              role="switch"
              class="mt-0.5"
              :checked="linkedOnly && deviceData === true"
              :disabled="deviceData !== true"
              :aria-describedby="linkedHintId"
              data-testid="dp-picker-linked"
              @change="onLinkedChange($event.target.checked)"
            />
            <div class="flex flex-col">
              <label :for="linkedId" class="text-sm">{{ $t('datapoints.picker.linkedOnly') }}</label>
              <span :id="linkedHintId" class="text-xs text-slate-500" data-testid="dp-picker-linked-hint">{{ linkedHint }}</span>
            </div>
          </div>
        </div>

        <p class="sr-only" aria-live="polite" data-testid="dp-picker-status">{{ statusText }}</p>

        <div v-if="error" role="alert" class="text-sm text-red-600" data-testid="dp-picker-error">
          {{ $t('datapoints.picker.loadError') }}
          <button type="button" class="ml-1 underline" data-testid="dp-picker-retry" @click="reload">{{ $t('datapoints.picker.retry') }}</button>
        </div>
        <p v-else-if="prompt" class="text-sm text-slate-500" data-testid="dp-picker-prompt">{{ prompt }}</p>
        <p v-else-if="loading && !rows.length" class="text-sm text-slate-500" data-testid="dp-picker-loading">{{ $t('common.loading') }}</p>
        <p v-else-if="!rows.length" class="text-sm text-slate-500" data-testid="dp-picker-empty">{{ $t('datapoints.picker.empty') }}</p>

        <ul
          v-show="rows.length && !error && !prompt"
          :id="listId"
          role="listbox"
          :aria-label="$t('datapoints.picker.results')"
          class="max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700"
          data-testid="dp-picker-list"
        >
          <li
            v-for="(row, i) in rows"
            :id="optionId(i)"
            :key="row.datapoint.id"
            role="option"
            :aria-selected="row.datapoint.id === modelValue ? 'true' : 'false'"
            :data-testid="`dp-picker-option-${i}`"
            :class="[
              'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
              i === activeIndex ? 'bg-blue-600/20 text-slate-800 dark:text-slate-100' : 'text-slate-600 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-slate-700/50',
            ]"
            @mousedown.prevent
            @mouseenter="activeIndex = i"
            @click="choose(row)"
          >
            <DpPathRow :row="row" />
          </li>
        </ul>

        <div v-if="rows.length && !error && !prompt" class="flex items-center justify-between text-xs text-slate-500">
          <span data-testid="dp-picker-count">{{ $t('datapoints.picker.count', { shown: rows.length, total }) }}</span>
          <button
            v-if="rows.length < total"
            type="button"
            class="btn-secondary btn-sm"
            :disabled="loading"
            data-testid="dp-picker-more"
            @click="loadMore"
          >{{ loading ? $t('common.loading') : $t('datapoints.picker.loadMore') }}</button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script setup>
// Datapoint picker with three lenses (#1266): the hierarchy trees, the ETS
// functions and the KNX devices narrow GET /api/v1/search; every line comes
// from datapointPathRows(), and the field shows the line that was picked. The
// lenses reuse the KNX monitor's filter building blocks (HierarchyCombobox,
// KnxDeviceCombobox, Combobox).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Combobox from '@/components/ui/Combobox.vue'
import DpPathRow from '@/components/ui/DpPathRow.vue'
import HierarchyCombobox from '@/components/ui/HierarchyCombobox.vue'
import KnxDeviceCombobox from '@/components/ui/KnxDeviceCombobox.vue'
import Modal from '@/components/ui/Modal.vue'
import PathLabel from '@/components/ui/PathLabel.vue'
import { hierarchyApi, searchApi } from '@/api/client'
import { useKnxProjectStore } from '@/stores/knxProject'
import {
  datapointPathRows,
  datapointRowText,
  isKnxFunctionTree,
  knxFunctionsOf,
  parseHierarchyCompositeId,
} from '@/utils/hierarchyDisplay'

const props = defineProps({
  // The chosen datapoint's id, '' for none.
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: null },
  pageSize: { type: Number, default: 50 },
  debounceMs: { type: Number, default: 250 },
})
const emit = defineEmits(['update:modelValue', 'select'])

const { t } = useI18n()
const knxProject = useKnxProjectStore()

const TREE_STORAGE_KEY = 'obs.dpPicker.treeId'
const ALL_PAGES_SIZE = 500
const base = `dp-picker-${Math.random().toString(36).slice(2, 10)}`
const listId = `${base}-list`
const tabPanelId = `${base}-panel`
const treeSelectId = `${base}-tree`
const linkedId = `${base}-linked`
const linkedHintId = `${base}-linked-hint`
const optionId = (i) => `${base}-option-${i}`
const tabId = (key) => `${base}-tab-${key}`

const triggerRef = ref(null)
const searchRef = ref(null)
const tabRefs = ref([])
const open = ref(false)
const lens = ref('hierarchy')
const query = ref('')
const trees = ref([])
const treeId = ref('')
const nodeIds = ref([])
const functionIds = ref([])
const devicePas = ref([])
const linkedOnly = ref(false)
const deviceData = ref(null)
const functions = ref([])
const functionsState = ref('idle')
const items = ref([])
const total = ref(0)
const page = ref(0)
const loading = ref(false)
const error = ref(false)
const activeIndex = ref(-1)
const selectedRow = ref(null)
let request = 0
let debounceTimer = null

const effectivePlaceholder = computed(() => props.placeholder ?? t('datapoints.picker.placeholder'))

const lenses = computed(() => [
  { key: 'hierarchy', label: t('datapoints.picker.lensHierarchy') },
  { key: 'functions', label: t('datapoints.picker.lensFunctions') },
  { key: 'devices', label: t('datapoints.picker.lensDevices') },
])

const functionTreeIds = computed(() => trees.value.filter(isKnxFunctionTree).map((tree) => tree.id))

// The tree the lines take their paths from: the function's tree in the function
// lens, the chosen tree otherwise.
const displayTreeId = computed(() => {
  if (lens.value !== 'functions') return treeId.value || null
  const chosen = functions.value.find((fn) => fn.id === functionIds.value[0])
  return chosen?.tree_id ?? functionTreeIds.value[0] ?? null
})

const rows = computed(() =>
  datapointPathRows(items.value, { treeId: displayTreeId.value, groupAddressStyle: knxProject.groupAddressStyle }),
)

const prompt = computed(() => {
  if (lens.value === 'functions' && !functionIds.value.length) return functions.value.length ? t('datapoints.picker.chooseFunction') : ''
  if (lens.value === 'devices' && !devicePas.value.length) return t('datapoints.picker.chooseDevice')
  return ''
})

const linkedHint = computed(() =>
  deviceData.value === false ? t('datapoints.picker.linkedUnavailable') : t('datapoints.picker.linkedOnlyHint'),
)

const statusText = computed(() => {
  if (loading.value) return t('common.loading')
  if (error.value) return t('datapoints.picker.loadError')
  return t('datapoints.picker.count', { shown: rows.value.length, total: total.value })
})

function storedTreeId() {
  try {
    return window.localStorage.getItem(TREE_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function storeTreeId(id) {
  try {
    window.localStorage.setItem(TREE_STORAGE_KEY, id)
  } catch {
    /* per-viewer convenience only */
  }
}

let treesLoaded = null
function loadTrees() {
  if (!treesLoaded) {
    treesLoaded = hierarchyApi
      .listTrees()
      .then(({ data }) => {
        trees.value = data
      })
      .catch(() => {
        trees.value = []
      })
      .then(() => {
        const stored = storedTreeId()
        treeId.value = trees.value.some((tree) => tree.id === stored) ? stored : (trees.value[0]?.id ?? '')
      })
  }
  return treesLoaded
}

let deviceDataLoaded = null
function loadDeviceData() {
  if (!deviceDataLoaded) {
    deviceDataLoaded = searchApi
      .knxDeviceData()
      .then(({ data }) => {
        deviceData.value = data?.knx_device_data === true
      })
      .catch(() => {
        deviceData.value = false
      })
  }
  return deviceDataLoaded
}

async function searchAllPages(params) {
  const collected = []
  for (let n = 0; ; n++) {
    const { data } = await searchApi.search({ ...params, size: ALL_PAGES_SIZE, page: n })
    collected.push(...data.items)
    if (n + 1 >= data.pages) return collected
  }
}

async function loadFunctions(force = false) {
  if (!force && functionsState.value !== 'idle') return
  if (!functionTreeIds.value.length) {
    functions.value = []
    functionsState.value = 'done'
    return
  }
  functionsState.value = 'loading'
  try {
    const datapoints = await searchAllPages({ tree_id: functionTreeIds.value.join(',') })
    functions.value = knxFunctionsOf(datapoints, functionTreeIds.value)
    functionsState.value = 'done'
  } catch {
    functionsState.value = 'error'
  }
}

function searchParams() {
  const params = {}
  if (query.value.trim()) params.q = query.value.trim()
  if (linkedOnly.value && deviceData.value === true) params.knx_linked = true
  if (lens.value === 'hierarchy') {
    const nodes = nodeIds.value.map(parseHierarchyCompositeId).filter(Boolean).map((node) => node.node_id)
    if (nodes.length) params.node_id = nodes.join(',')
    else if (treeId.value) params.tree_id = treeId.value
  } else if (lens.value === 'functions') {
    params.node_id = functionIds.value.join(',')
  } else {
    params.device = devicePas.value.join(',')
  }
  return params
}

async function fetchPage(nextPage) {
  const mine = ++request
  if (prompt.value) {
    items.value = []
    total.value = 0
    activeIndex.value = -1
    loading.value = false
    error.value = false
    return
  }
  loading.value = true
  error.value = false
  try {
    const { data } = await searchApi.search({ ...searchParams(), size: props.pageSize, page: nextPage })
    if (mine !== request) return
    items.value = nextPage === 0 ? data.items : [...items.value, ...data.items]
    total.value = data.total
    page.value = nextPage
    if (nextPage === 0) activeIndex.value = items.value.length ? 0 : -1
  } catch {
    if (mine !== request) return
    error.value = true
    if (nextPage === 0) {
      items.value = []
      total.value = 0
    }
  } finally {
    if (mine === request) loading.value = false
  }
}

function reload() {
  clearTimeout(debounceTimer)
  return fetchPage(0)
}

function loadMore() {
  return fetchPage(page.value + 1)
}

function onQueryInput() {
  clearTimeout(debounceTimer)
  if (props.debounceMs <= 0) {
    reload()
    return
  }
  debounceTimer = setTimeout(reload, props.debounceMs)
}

async function setLens(key) {
  lens.value = key
  if (key === 'functions') await loadFunctions()
  await reload()
}

function moveLens(index, step) {
  const next = (index + step + lenses.value.length) % lenses.value.length
  setLens(lenses.value[next].key)
  nextTick(() => tabRefs.value[next]?.focus())
}

function onTreeChange(id) {
  treeId.value = id
  nodeIds.value = []
  storeTreeId(id)
  reload()
}

function onNodesChange(ids) {
  nodeIds.value = ids
  reload()
}

function onFunctionsChange(ids) {
  functionIds.value = ids
  reload()
}

function onDevicesChange(pas) {
  devicePas.value = pas
  reload()
}

function onLinkedChange(checked) {
  linkedOnly.value = checked
  reload()
}

async function functionSuggestions(text) {
  const needle = String(text || '').trim().toLowerCase()
  return needle ? functions.value.filter((fn) => fn.label.toLowerCase().includes(needle)) : functions.value
}

function setActive(index) {
  if (!rows.value.length) return
  activeIndex.value = Math.max(0, Math.min(index, rows.value.length - 1))
  nextTick(() => document.getElementById(optionId(activeIndex.value))?.scrollIntoView?.({ block: 'nearest' }))
}

function moveActive(step) {
  setActive(activeIndex.value + step)
}

function selectActive() {
  const row = rows.value[activeIndex.value]
  if (row) choose(row)
}

function choose(row) {
  selectedRow.value = row
  emit('update:modelValue', row.datapoint.id)
  emit('select', { id: row.datapoint.id, datapoint: row.datapoint, row, text: datapointRowText(row) })
  closePanel()
}

async function openPanel() {
  open.value = true
  loading.value = true
  await nextTick()
  searchRef.value?.focus()
  await Promise.all([loadTrees(), loadDeviceData()])
  if (lens.value === 'functions') await loadFunctions()
  await reload()
}

function closePanel() {
  open.value = false
  clearTimeout(debounceTimer)
  nextTick(() => triggerRef.value?.focus())
}

// A value set from outside (a stored configuration): show its line the way
// the list would, among the datapoints of the same name.
async function hydrate(id) {
  if (!id) {
    selectedRow.value = null
    return
  }
  if (selectedRow.value?.datapoint.id === id) return
  try {
    await loadTrees()
    const { data } = await searchApi.search({ q: id, size: 1 })
    const hit = data.items.find((item) => item.id === id)
    if (!hit) return
    let namesakes = []
    try {
      namesakes = (await searchAllPages({ q: hit.name })).filter((item) => item.name === hit.name && item.id !== id)
    } catch {
      /* the line without its namesakes */
    }
    if (props.modelValue !== id) return
    const lines = datapointPathRows([hit, ...namesakes], { treeId: treeId.value || null, groupAddressStyle: knxProject.groupAddressStyle })
    selectedRow.value = lines[0]
  } catch {
    /* keep the placeholder; picking again still works */
  }
}

watch(() => props.modelValue, (id) => hydrate(id))
onMounted(() => hydrate(props.modelValue))
onBeforeUnmount(() => clearTimeout(debounceTimer))

defineExpose({ open: openPanel })
</script>
