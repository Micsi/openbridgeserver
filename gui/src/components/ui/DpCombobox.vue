<template>
  <Combobox
    :model-value="modelValue"
    :multi="multi"
    :placeholder="effectivePlaceholder"
    :fetch-suggestions="fetchSuggestions"
    :display-items="displayItems"
    :empty-text="$t('datapoints.noObjectsFound')"
    @update:modelValue="onUpdate"
    @select="onSelect"
  >
    <template #item="{ item, active, selected }">
      <DpPathRow :row="item.row" />
      <span v-if="selected" class="text-xs text-blue-500 shrink-0">·</span>
      <span v-if="active" class="sr-only">{{ $t('common.active') }}</span>
    </template>
  </Combobox>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Combobox from '@/components/ui/Combobox.vue'
import DpPathRow from '@/components/ui/DpPathRow.vue'
import { searchApi } from '@/api/client'
import { useKnxProjectStore } from '@/stores/knxProject'
import { datapointPathRows, datapointRowText, preferredDatapointTreeId } from '@/utils/hierarchyDisplay'

const { t } = useI18n()

const props = defineProps({
  // Single-mode: string DP id. Multi-mode: array of DP ids.
  modelValue: { type: [String, Array], default: '' },
  // Display name shown in the input when an item is selected (single-mode only).
  displayName: { type: String, default: '' },
  placeholder: { type: String, default: null },
  // Set to true to allow multi-selection. The model value type changes to
  // string[] in that case; the FilterEditor (#36) needs this.
  multi: { type: Boolean, default: false },
  // Tree whose paths the lines show (#1266); empty: the tree most suggestions have a path in.
  treeId: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'select'])

const effectivePlaceholder = computed(() => props.placeholder ?? t('datapoints.searchPlaceholder'))

// Cache of DPs we've seen — by id — so chip rendering in multi-mode has a
// label even after the suggestion list closes. Single-mode also relies on
// this for the "remembered label" of the currently selected DP.
const knownItems = ref(new Map())

const knxProject = useKnxProjectStore()

function rememberItem(item) {
  if (!item || !item.id) return
  knownItems.value.set(item.id, { id: item.id, label: item.label, name: item.name })
}

// One path line per datapoint (#1266): the label of the input and of a chip is
// the text of the line it was picked from.
function withPathRows(items) {
  const treeId = props.treeId || preferredDatapointTreeId(items)
  const rows = datapointPathRows(items, { treeId, groupAddressStyle: knxProject.groupAddressStyle })
  return rows.map((row) => ({ ...row.datapoint, label: datapointRowText(row), row }))
}

// Seed from displayName + modelValue (single-mode) so the input/chip can
// show the label before the first fetch.
if (props.displayName && typeof props.modelValue === 'string' && props.modelValue) {
  rememberItem({ id: props.modelValue, name: props.displayName, label: props.displayName })
}

watch(
  () => [props.modelValue, props.displayName],
  ([val, name]) => {
    if (typeof val === 'string' && val && name) {
      rememberItem({ id: val, name, label: name })
    }
  },
)

async function hydrateUnknownIds(ids) {
  const unknown = (ids || []).filter((id) => id && !knownItems.value.has(id))
  if (unknown.length === 0) return
  await Promise.all(
    unknown.map(async (id) => {
      try {
        const { data } = await searchApi.search({ q: id, size: 1 })
        const items = data.items ?? data ?? []
        const hit = items.find((it) => it.id === id)
        if (hit) rememberItem(withPathRows([hit])[0])
      } catch {
        /* swallow */
      }
    }),
  )
}

// In multi-mode, fetch labels for every id in modelValue that we don't yet
// know. Triggered both at mount-time (for components mounted with pre-set
// chips) and on subsequent prop changes (so re-opening the FilterEditor on
// a hydrated set replaces the UUID-as-label fallback with the real name).
onMounted(() => {
  if (props.multi && Array.isArray(props.modelValue)) {
    void hydrateUnknownIds(props.modelValue)
  }
})

watch(
  () => (props.multi && Array.isArray(props.modelValue) ? [...props.modelValue] : null),
  (val) => {
    if (val) void hydrateUnknownIds(val)
  },
  { deep: false },
)

const displayItems = computed(() => Array.from(knownItems.value.values()))

async function fetchSuggestions(q) {
  try {
    const { data } = await searchApi.search({ q: q || '', size: 50 })
    const items = data.items ?? data ?? []
    // Normalize to {id, label, row, ...rest} so generic Combobox can render the chip/item.
    const normalized = withPathRows(items)
    for (const it of normalized) rememberItem(it)
    return normalized
  } catch {
    return []
  }
}

function onUpdate(val) {
  if (props.multi) {
    emit('update:modelValue', Array.isArray(val) ? val : [])
  } else {
    emit('update:modelValue', typeof val === 'string' ? val : '')
  }
}

function onSelect(item) {
  if (item) rememberItem(item)
  emit('select', item)
}
</script>
