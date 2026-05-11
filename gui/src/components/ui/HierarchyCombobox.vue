<template>
  <Combobox
    :model-value="modelValue"
    :multi="true"
    :placeholder="placeholder"
    :fetch-suggestions="fetchSuggestions"
    :display-items="displayItems"
    empty-text="Keine Knoten gefunden"
    @update:modelValue="onUpdate"
  >
    <!-- Dropdown item: two-line (tree above path) -->
    <template #item="{ item }">
      <div class="flex flex-col min-w-0 flex-1">
        <span class="text-[10px] uppercase tracking-wide text-slate-400">{{ item.tree_name }}</span>
        <PathLabel :segments="item.path" />
      </div>
      <span v-if="item.is_leaf === false" class="text-xs text-slate-500 shrink-0">Knoten</span>
    </template>

    <!-- Chip: full path -->
    <template #chip="{ item, remove }">
      <PathLabel :segments="item.path" />
      <button
        type="button"
        class="ml-0.5 text-blue-700/70 hover:text-red-500 dark:text-blue-300/70 dark:hover:text-red-400 shrink-0"
        @click.stop="remove"
        tabindex="-1"
        aria-label="Entfernen"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </template>
  </Combobox>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import Combobox from '@/components/ui/Combobox.vue'
import PathLabel from '@/components/ui/PathLabel.vue'
import { hierarchyApi } from '@/api/client'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Knoten suchen …' },
})
const emit = defineEmits(['update:modelValue'])

/** All known nodes, fully built with path + tree info. */
const nodes = ref([])
const treesById = ref({})

function buildPathsForTree(tree, rawNodes) {
  const byId = new Map(rawNodes.map((n) => [n.id, n]))
  const cache = new Map()
  function pathOf(node) {
    if (cache.has(node.id)) return cache.get(node.id)
    const segs = []
    let cursor = node
    let guard = 0
    while (cursor && guard < 64) {
      segs.unshift(cursor.name)
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null
      guard++
    }
    cache.set(node.id, segs)
    return segs
  }
  const childIds = new Set(rawNodes.filter((n) => n.parent_id).map((n) => n.parent_id))
  return rawNodes.map((n) => ({
    id: `${tree.id}:${n.id}`,
    tree_id: tree.id,
    tree_name: tree.name,
    node_id: n.id,
    path: pathOf(n),
    is_leaf: !childIds.has(n.id),
    label: pathOf(n).join(' › '),
  }))
}

async function load() {
  try {
    const { data: trees } = await hierarchyApi.listTrees()
    if (!Array.isArray(trees)) return
    treesById.value = Object.fromEntries(trees.map((t) => [t.id, t]))
    const allNodes = []
    await Promise.all(
      trees.map(async (tree) => {
        try {
          const { data: tn } = await hierarchyApi.getTreeNodes(tree.id)
          if (Array.isArray(tn)) allNodes.push(...buildPathsForTree(tree, tn))
        } catch {
          /* swallow per-tree errors */
        }
      }),
    )
    nodes.value = allNodes
  } catch {
    nodes.value = []
  }
}

onMounted(load)

const displayItems = computed(() => nodes.value)

async function fetchSuggestions(q) {
  if (!nodes.value.length) await load()
  const needle = (q || '').toLowerCase().trim()
  if (!needle) return nodes.value
  return nodes.value.filter((n) =>
    n.path.some((seg) => seg.toLowerCase().includes(needle)) ||
    (n.tree_name || '').toLowerCase().includes(needle),
  )
}

function onUpdate(val) {
  emit('update:modelValue', Array.isArray(val) ? val : [])
}
</script>
