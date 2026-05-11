<template>
  <Combobox
    :model-value="modelValue"
    :multi="true"
    :placeholder="placeholder"
    :fetch-suggestions="fetchSuggestions"
    :display-items="displayItems"
    empty-text="Keine Adapter gefunden"
    @update:modelValue="onUpdate"
  />
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import Combobox from '@/components/ui/Combobox.vue'
import { adapterApi } from '@/api/client'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Adapter wählen …' },
})
const emit = defineEmits(['update:modelValue'])

const types = ref([])

async function load() {
  try {
    const { data } = await adapterApi.list()
    const arr = Array.isArray(data) ? data : []
    types.value = arr.filter((a) => !a.hidden).map((a) => ({
      id: a.adapter_type,
      label: a.label ?? a.adapter_type,
    }))
  } catch {
    types.value = []
  }
}

onMounted(() => {
  load()
})

const displayItems = computed(() => types.value)

async function fetchSuggestions(q) {
  if (!types.value.length) await load()
  const needle = (q || '').toLowerCase()
  if (!needle) return types.value
  return types.value.filter(
    (t) =>
      t.id.toLowerCase().includes(needle) ||
      (t.label || '').toLowerCase().includes(needle),
  )
}

function onUpdate(val) {
  emit('update:modelValue', Array.isArray(val) ? val : [])
}
</script>
