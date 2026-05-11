<template>
  <Combobox
    :model-value="modelValue"
    :multi="false"
    :placeholder="placeholder"
    :fetch-suggestions="fetchSuggestions"
    :display-items="displayItems"
    empty-text="Keine Objekte gefunden"
    @update:modelValue="onUpdate"
    @select="onSelect"
  >
    <template #item="{ item, active, selected }">
      <span class="flex-1 min-w-0 truncate">{{ item.name }}</span>
      <span class="text-xs text-slate-500 shrink-0">{{ item.data_type }}</span>
      <span v-if="item.unit" class="text-xs text-slate-600 shrink-0">{{ item.unit }}</span>
      <span v-if="selected" class="text-xs text-blue-500 shrink-0">·</span>
      <span v-if="active" class="sr-only">aktiv</span>
    </template>
  </Combobox>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Combobox from '@/components/ui/Combobox.vue'
import { searchApi } from '@/api/client'

const props = defineProps({
  modelValue: { type: String, default: '' },   // selected DP id
  displayName: { type: String, default: '' },  // shown in the input when an item is selected
  placeholder: { type: String, default: 'Name, UUID, Konfiguration …' },
})
const emit = defineEmits(['update:modelValue', 'select'])

// We track the most-recently-selected item so multi-mode chip rendering
// (also used as the single-mode "remembered label") has a label available.
const lastItem = ref(props.displayName ? { id: props.modelValue, label: props.displayName, name: props.displayName } : null)

watch(
  () => [props.modelValue, props.displayName],
  ([id, name]) => {
    if (id && name) lastItem.value = { id, label: name, name }
    if (!id) lastItem.value = null
  },
)

const displayItems = computed(() =>
  lastItem.value
    ? [{ id: lastItem.value.id, label: lastItem.value.label ?? lastItem.value.name }]
    : [],
)

async function fetchSuggestions(q) {
  try {
    const { data } = await searchApi.search({ q: q || '', size: 50 })
    const items = data.items ?? data ?? []
    // Normalize to {id, label, ...rest} so generic Combobox can render the chip/item.
    return items.map((it) => ({ ...it, label: it.name }))
  } catch {
    return []
  }
}

function onUpdate(val) {
  emit('update:modelValue', typeof val === 'string' ? val : '')
}

function onSelect(item) {
  if (item) lastItem.value = { id: item.id, label: item.name, name: item.name }
  emit('select', item)
}
</script>
