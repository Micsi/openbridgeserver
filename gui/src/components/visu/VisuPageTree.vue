<script setup>
/**
 * Der Seitenbaum des V2-Editors (M5 C1, Issue #168).
 *
 * Anlegen, auswaehlen, umordnen, verschieben, loeschen. Umbenannt wird eine
 * Seite ueber das Feld „Name" in den Seiteneigenschaften und dasselbe
 * „Speichern" wie jede andere Eigenschaft - es gibt bewusst keinen zweiten
 * Schreibweg fuer denselben Wert.
 *
 * Geloescht wird erst nach einer Rueckfrage MIT NAMEN: `DELETE /visu/nodes/{id}`
 * nimmt den ganzen Teilbaum mit (ON DELETE CASCADE), das ist nichts, was ein
 * Fehlklick auf einem Pfeil-Nachbarn ausloesen darf.
 */
import { computed, ref } from 'vue'

import { useVisuEditorStore } from '@/stores/visuEditor'
import { buildTree } from '@/utils/visuPageTree'
import VisuPageTreeNode from '@/components/visu/VisuPageTreeNode.vue'

const store = useVisuEditorStore()
const roots = computed(() => buildTree(store.nodes))
const pendingDelete = ref(null)

async function confirmDelete() {
  const node = pendingDelete.value
  pendingDelete.value = null
  if (node) await store.remove(node.id)
}
</script>

<template>
  <div class="visu-page-tree flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {{ $t('visuEditor.tree.title') }}
      </h2>
      <button
        type="button"
        data-testid="visu-tree-new-page"
        class="btn-secondary text-xs"
        @click="store.newPage()"
      >
        {{ $t('visuEditor.tree.newPage') }}
      </button>
      <button
        type="button"
        data-testid="visu-tree-new-folder"
        class="btn-secondary text-xs"
        @click="store.newFolder()"
      >
        {{ $t('visuEditor.tree.newFolder') }}
      </button>
    </div>

    <p
      v-if="store.loadError"
      data-testid="visu-tree-error"
      class="text-sm text-rose-600 dark:text-rose-400"
    >
      {{ $t('visuEditor.loadError') }}
    </p>

    <p
      v-else-if="roots.length === 0"
      data-testid="visu-tree-empty"
      class="text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('visuEditor.tree.empty') }}
    </p>

    <ul
      v-else
      role="tree"
      class="flex flex-col"
    >
      <VisuPageTreeNode
        v-for="node in roots"
        :key="node.id"
        :node="node"
        @ask-delete="pendingDelete = $event"
      />
    </ul>

    <div
      v-if="pendingDelete"
      data-testid="visu-tree-delete-dialog"
      role="alertdialog"
      class="rounded border border-rose-300 dark:border-rose-700 p-2 text-sm"
    >
      <p class="font-semibold">
        {{ $t('visuEditor.tree.confirmTitle') }}
      </p>
      <p>{{ $t('visuEditor.tree.confirmText', { name: pendingDelete.name }) }}</p>
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="visu-tree-delete-confirm"
          class="btn-danger text-xs"
          @click="confirmDelete"
        >
          {{ $t('visuEditor.tree.confirmDelete') }}
        </button>
        <button
          type="button"
          data-testid="visu-tree-delete-cancel"
          class="btn-secondary text-xs"
          @click="pendingDelete = null"
        >
          {{ $t('visuEditor.tree.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>
