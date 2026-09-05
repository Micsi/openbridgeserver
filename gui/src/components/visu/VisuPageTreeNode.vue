<script setup>
/**
 * Ein Knoten im Seitenbaum des V2-Editors (M5 C1, Issue #168).
 *
 * Eigene Datei, weil ein Baum sich selbst enthaelt: ein Vue-Template kann nur
 * ueber eine Komponente rekursiv werden. Der Knoten liest den Store direkt -
 * der Baum reicht nichts durch, was der Store ohnehin haelt (eine Quelle).
 *
 * Was er zeigt: Ordner und Seite sind am `data-node-type` und am Abzeichen
 * unterscheidbar, und jede Seite traegt ihren Seitentyp (R1) - auch die
 * abgeleitete Rolle „Inkludeseite".
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVisuEditorStore } from '@/stores/visuEditor'
import { buildTree, descendantIds } from '@/utils/visuPageTree'
import { toEditorKind } from '@/utils/visuPageKind'

const props = defineProps({
  node: { type: Object, required: true },
})
defineEmits(['ask-delete'])

const store = useVisuEditorStore()
const { t } = useI18n()

/** Das Abzeichen: Ordner, oder der Seitentyp inklusive der abgeleiteten Rolle. */
const badge = computed(() => {
  if (props.node.type === 'LOCATION') return 'location'
  return toEditorKind(props.node.kind, { referenced: store.referencedIds.has(props.node.id) })
})

/**
 * Wohin dieser Knoten wandern darf: alles ausser dem eigenen Teilbaum, in der
 * Reihenfolge des Baums, damit die Auswahl dieselbe Ordnung hat wie die Anzeige.
 */
const moveTargets = computed(() => {
  const blocked = descendantIds(store.nodes, props.node.id)
  const flat = []
  const walk = (branch, depth) => {
    for (const entry of branch) {
      if (blocked.has(entry.id)) continue
      flat.push({ id: entry.id, text: `${'  '.repeat(depth)}${entry.name}` })
      walk(entry.children, depth + 1)
    }
  }
  walk(buildTree(store.nodes), 0)
  return flat
})

/**
 * Die Beschriftung einer Knoten-Aktion.
 *
 * Der KNOTENNAME steht bewusst NICHT im `aria-label`, sondern im `title`: der
 * Playwright-Harness sucht Bedienelemente ueber ihren zugaenglichen Namen
 * (`getByLabel`, teilstring-genau), und eine Seite namens „M5 Guard Pin" machte
 * damit jedes `getByLabel('PIN')` mehrdeutig - gemessen, fuenf Treffer.
 * Zuordnung und Vorlesbarkeit bleiben erhalten: die Knopfe stehen IM
 * `role="treeitem"` dieses Knotens, und der traegt den Namen.
 */
const actionTitle = (action) =>
  t('visuEditor.tree.actionFor', { action, name: props.node.name })

function onMove(event) {
  store.moveTo(props.node.id, event.target.value)
}
</script>

<template>
  <li
    class="visu-node"
    role="treeitem"
    :data-node-id="node.id"
    :data-node-type="node.type"
    :aria-selected="store.selectedId === node.id ? 'true' : 'false'"
  >
    <div class="flex flex-wrap items-center gap-1 py-0.5">
      <button
        type="button"
        class="visu-node-label flex items-center gap-2 rounded px-2 py-1 text-left text-sm"
        :class="store.selectedId === node.id ? 'bg-sky-100 dark:bg-sky-900/40' : ''"
        @click="store.select(node.id)"
      >
        <span
          class="visu-node-badge rounded px-1.5 py-0.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60"
          :data-badge="badge"
        >{{ $t(`visuEditor.badge.${badge}`) }}</span>
        <span class="visu-node-name">{{ node.name }}</span>
      </button>

      <button
        type="button"
        data-action="up"
        class="rounded px-1 text-xs text-slate-500 dark:text-slate-400"
        :aria-label="$t('visuEditor.tree.up')"
        :title="actionTitle($t('visuEditor.tree.up'))"
        @click="store.nudge(node.id, -1)"
      >&#9650;</button>
      <button
        type="button"
        data-action="down"
        class="rounded px-1 text-xs text-slate-500 dark:text-slate-400"
        :aria-label="$t('visuEditor.tree.down')"
        :title="actionTitle($t('visuEditor.tree.down'))"
        @click="store.nudge(node.id, 1)"
      >&#9660;</button>

      <select
        data-action="move"
        class="rounded border border-slate-200 dark:border-slate-700 bg-transparent px-1 text-xs"
        :aria-label="$t('visuEditor.tree.moveTo')"
        :title="actionTitle($t('visuEditor.tree.moveTo'))"
        :value="node.parent_id ?? ''"
        @change="onMove"
      >
        <option value="">{{ $t('visuEditor.tree.root') }}</option>
        <option
          v-for="target in moveTargets"
          :key="target.id"
          :value="target.id"
        >{{ target.text }}</option>
      </select>

      <button
        type="button"
        data-action="delete"
        class="rounded px-1 text-xs text-rose-600 dark:text-rose-400"
        :aria-label="$t('visuEditor.tree.delete')"
        :title="actionTitle($t('visuEditor.tree.delete'))"
        @click="$emit('ask-delete', node)"
      >&#10005;</button>
    </div>

    <ul
      v-if="node.children.length > 0"
      class="ml-4 border-l border-slate-200 dark:border-slate-700 pl-2"
      role="group"
    >
      <VisuPageTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        @ask-delete="$emit('ask-delete', $event)"
      />
    </ul>
  </li>
</template>
