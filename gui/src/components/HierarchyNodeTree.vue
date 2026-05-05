<template>
  <ul class="flex flex-col gap-0.5">
    <li v-for="(node, index) in nodes" :key="node.id" class="flex flex-col">
      <div
        :style="{ paddingLeft: `${depth * 16}px` }"
        class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 group hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
        :data-testid="`node-${node.id}`">

        <!-- expand toggle -->
        <button v-if="node.children?.length"
          @click="toggleExpand(node.id)"
          class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0">
          <svg class="w-3.5 h-3.5 transition-transform" :class="expanded.has(node.id) ? 'rotate-90' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
        </button>
        <span v-else class="w-3.5 shrink-0" />

        <!-- node icon + name -->
        <svg class="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7h18M3 12h12M3 17h8"/>
        </svg>
        <span class="text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{{ node.name }}</span>
        <span v-if="node.description" class="text-xs text-slate-400 hidden lg:block truncate max-w-24">{{ node.description }}</span>

        <!-- ── Objekte-Pill (immer sichtbar) ── -->
        <button
          @click="emit('manage-links', node)"
          class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors shrink-0"
          :data-testid="`btn-links-${node.id}`"
          title="Objekte verknüpfen">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
          </svg>
          Objekte
        </button>

        <!-- ── Reihenfolge ↑↓ (hover) ── -->
        <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            @click="emit('reorder', { node, siblings: nodes, index, direction: 'up' })"
            :disabled="index === 0"
            class="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 disabled:cursor-not-allowed"
            title="Nach oben">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
            </svg>
          </button>
          <button
            @click="emit('reorder', { node, siblings: nodes, index, direction: 'down' })"
            :disabled="index === nodes.length - 1"
            class="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 disabled:cursor-not-allowed"
            title="Nach unten">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
        </div>

        <!-- ── weitere Aktionen (hover) ── -->
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button @click="emit('add-child', node)" class="btn-secondary btn-xs" :data-testid="`btn-add-child-${node.id}`" title="Unterknoten hinzufügen">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
          </button>
          <button @click="emit('edit', node)" class="btn-secondary btn-xs" :data-testid="`btn-edit-node-${node.id}`" title="Umbenennen">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 13l6.293-6.293a1 1 0 011.414 0l1.586 1.586a1 1 0 010 1.414L12 16H9v-3z"/>
            </svg>
          </button>
          <button @click="emit('delete', node)" class="btn-danger btn-xs" :data-testid="`btn-delete-node-${node.id}`" title="Löschen">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a1 1 0 011-1h4a1 1 0 011 1m-7 0h8"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Recursive children -->
      <HierarchyNodeTree
        v-if="node.children?.length && expanded.has(node.id)"
        :nodes="node.children"
        :tree-id="treeId"
        :depth="depth + 1"
        :selected-node="selectedNode"
        @add-child="emit('add-child', $event)"
        @edit="emit('edit', $event)"
        @delete="emit('delete', $event)"
        @manage-links="emit('manage-links', $event)"
        @reorder="emit('reorder', $event)"
      />
    </li>
  </ul>
</template>

<script setup>
import { reactive } from 'vue'

const props = defineProps({
  nodes:        { type: Array,  default: () => [] },
  treeId:       { type: String, required: true },
  depth:        { type: Number, default: 0 },
  selectedNode: { type: String, default: null },
})

const emit = defineEmits(['add-child', 'edit', 'delete', 'manage-links', 'reorder'])

const expanded = reactive(new Set())

function toggleExpand(nodeId) {
  if (expanded.has(nodeId)) {
    expanded.delete(nodeId)
  } else {
    expanded.add(nodeId)
  }
}
</script>
