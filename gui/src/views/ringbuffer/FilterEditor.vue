<template>
  <Modal
    :model-value="modelValue"
    :soft-backdrop="softModal"
    :title="setId ? 'Filterset bearbeiten' : 'Neues Filterset'"
    max-width="2xl"
    @update:model-value="onModalToggle"
  >
    <div class="flex flex-col gap-5">
      <!-- Set-Metadaten -->
      <section class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Name</label>
          <input
            v-model="form.name"
            class="input"
            data-testid="filter-editor-name"
            placeholder="z. B. Heizung"
            @input="markDirty"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Beschreibung</label>
          <input
            v-model="form.description"
            class="input"
            data-testid="filter-editor-description"
            placeholder="Optionale Beschreibung"
            @input="markDirty"
          />
        </div>
      </section>

      <section class="flex flex-wrap items-center gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Farbe</label>
          <div class="flex items-center gap-1.5" data-testid="filter-editor-color-palette">
            <button
              v-for="color in COLOR_PALETTE"
              :key="color"
              type="button"
              :data-testid="`filter-editor-color-${color}`"
              :data-color="color"
              class="w-6 h-6 rounded-full border-2 transition"
              :class="form.color === color ? 'border-slate-900 dark:border-white' : 'border-transparent hover:border-slate-400'"
              :style="{ backgroundColor: color }"
              :title="color"
              @click="onPickColor(color)"
            />
          </div>
        </div>
        <label class="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            v-model="form.is_active"
            data-testid="filter-editor-active"
            @change="markDirty"
          />
          Set aktiv
        </label>
      </section>

      <!-- Hierarchy combobox with per-chip ⊞ expand -->
      <section class="flex flex-col gap-1">
        <label class="text-xs text-slate-500">Hierarchy-Knoten</label>
        <HierarchyCombobox
          :model-value="hierarchyIds"
          data-testid="filter-editor-hierarchy"
          @update:model-value="onHierarchyChange"
        >
          <template #chip="{ item, index, remove }">
            <span class="truncate">{{ chipLabel(item) }}</span>
            <button
              type="button"
              :data-testid="`hierarchy-expand-${index}`"
              class="ml-1 text-blue-700/80 hover:text-emerald-600 dark:text-blue-300/80 dark:hover:text-emerald-300"
              title="Knoten auflösen: DPs als Chips materialisieren"
              :disabled="expanding"
              @click.stop="expandHierarchyChip(item, index)"
            >
              ⊞
            </button>
            <button
              type="button"
              :data-testid="`hierarchy-remove-${index}`"
              class="ml-0.5 text-blue-700/70 hover:text-red-500 dark:text-blue-300/70 dark:hover:text-red-400"
              @click.stop="remove"
              tabindex="-1"
              aria-label="Entfernen"
            >
              ×
            </button>
          </template>
        </HierarchyCombobox>
        <p class="text-xs text-slate-500">Live-Filter — auch zukünftige Objekte unter diesen Knoten.</p>
      </section>

      <section class="flex flex-col gap-1">
        <label class="text-xs text-slate-500">Datenpunkte</label>
        <DpCombobox
          :multi="true"
          :model-value="form.datapoints"
          data-testid="filter-editor-dps"
          @update:model-value="onDpsChange"
        />
        <p class="text-xs text-slate-500">Feste Auswahl.</p>
      </section>

      <section class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Tags</label>
          <TagCombobox
            :model-value="form.tags"
            data-testid="filter-editor-tags"
            @update:model-value="onTagsChange"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Adapter</label>
          <AdapterCombobox
            :model-value="form.adapters"
            data-testid="filter-editor-adapters"
            @update:model-value="onAdaptersChange"
          />
        </div>
      </section>

      <section class="flex flex-col gap-1">
        <label class="text-xs text-slate-500">Volltextsuche (q)</label>
        <input
          v-model="form.q"
          class="input"
          data-testid="filter-editor-q"
          placeholder="z. B. Temperatur"
          @input="markDirty"
        />
      </section>

      <!-- Wertfilter -->
      <section class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex flex-col gap-2">
        <h4 class="text-sm font-semibold">Wertfilter</h4>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-500">Datentyp</label>
            <select
              v-model="form.valueDataType"
              class="input"
              data-testid="filter-editor-value-type"
              @change="onValueTypeChange"
            >
              <option value="number">Nummer</option>
              <option value="string">String</option>
              <option value="bool">Bool</option>
              <option value="regex">Regex</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-500">Operator</label>
            <select
              v-model="form.valueOperator"
              class="input"
              data-testid="filter-editor-value-operator"
              @change="markDirty"
            >
              <option value="">(kein)</option>
              <option v-for="op in operatorsFor(form.valueDataType)" :key="op" :value="op">{{ op }}</option>
            </select>
          </div>
          <template v-if="form.valueOperator === 'between'">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-slate-500">Untergrenze</label>
              <input
                v-model="form.valueLower"
                class="input"
                data-testid="filter-editor-value-lower"
                placeholder="0"
                @input="markDirty"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-slate-500">Obergrenze</label>
              <input
                v-model="form.valueUpper"
                class="input"
                data-testid="filter-editor-value-upper"
                placeholder="100"
                @input="markDirty"
              />
            </div>
          </template>
          <template v-else-if="form.valueOperator === 'regex' || form.valueDataType === 'regex'">
            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-xs text-slate-500">Pattern</label>
              <input
                v-model="form.valuePattern"
                class="input"
                data-testid="filter-editor-value-pattern"
                placeholder="^temp"
                @input="markDirty"
              />
            </div>
          </template>
          <template v-else-if="form.valueOperator">
            <div class="flex flex-col gap-1 md:col-span-2">
              <label class="text-xs text-slate-500">Wert</label>
              <input
                v-model="form.valueInput"
                class="input"
                data-testid="filter-editor-value-input"
                placeholder="42"
                @input="markDirty"
              />
            </div>
          </template>
        </div>
        <label
          v-if="form.valueOperator === 'regex' || form.valueDataType === 'regex'"
          class="inline-flex items-center gap-2 text-xs text-slate-500"
        >
          <input
            type="checkbox"
            v-model="form.valueIgnoreCase"
            data-testid="filter-editor-value-ignore-case"
            @change="markDirty"
          />
          Regex ignore case
        </label>
      </section>

      <p v-if="errorMsg" data-testid="filter-editor-error" class="text-sm text-red-500">{{ errorMsg }}</p>
    </div>

    <template #footer>
      <p class="text-xs mr-auto self-center" data-testid="filter-editor-semantics-hint"
         :class="filterIsEmpty ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'">
        <span v-if="filterIsEmpty" data-testid="filter-editor-empty-hint">
          ⚠ Mindestens ein Filterkriterium konfigurieren — sonst kann das Set nicht gespeichert werden.
        </span>
        <span v-else>
          Innerhalb des Sets: Hierarchy OR DP, alle anderen Kriterien AND-verknüpft.
        </span>
      </p>
      <button class="btn-secondary btn-sm" data-testid="filter-editor-cancel" @click="onCancel">Verwerfen</button>
      <button
        class="btn-primary btn-sm"
        :disabled="saving || filterIsEmpty"
        data-testid="filter-editor-save-topbar"
        @click="onSave(true)"
      >
        Speichern &amp; in Topleiste
      </button>
    </template>
  </Modal>

  <ConfirmDialog
    v-model="confirmOpen"
    title="Ungespeicherte Änderungen"
    message="Editor wirklich schliessen und alle Änderungen verwerfen?"
    confirm-label="Verwerfen"
    @confirm="confirmDiscard"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ringbufferApi, searchApi, hierarchyApi } from '@/api/client'
import Modal from '@/components/ui/Modal.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import HierarchyCombobox from '@/components/ui/HierarchyCombobox.vue'
import DpCombobox from '@/components/ui/DpCombobox.vue'
import TagCombobox from '@/components/ui/TagCombobox.vue'
import AdapterCombobox from '@/components/ui/AdapterCombobox.vue'
import { isEmptyFilter } from '@/composables/useClientSideMatch'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  setId: { type: String, default: null },
  softModal: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const COLOR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#84cc16', // lime
  '#94a3b8', // slate
]
const DEFAULT_COLOR = COLOR_PALETTE[0]

const OPERATOR_OPTIONS = {
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'],
  string: ['eq', 'ne', 'contains', 'regex'],
  bool: ['eq', 'ne'],
  regex: ['regex'],
}

function makeEmptyForm() {
  return {
    name: '',
    description: '',
    color: DEFAULT_COLOR,
    is_active: true,
    hierarchy_nodes: [], // {tree_id, node_id, include_descendants}
    datapoints: [],
    tags: [],
    adapters: [],
    q: '',
    valueDataType: 'number',
    valueOperator: '',
    valueInput: '',
    valueLower: '',
    valueUpper: '',
    valuePattern: '',
    valueIgnoreCase: false,
  }
}

const form = reactive(makeEmptyForm())

// Disable Save when the filter has no populated criteria — matches backend
// validation (POST/PUT /filtersets reject empty FilterCriteria with 422).
const filterIsEmpty = computed(() =>
  isEmptyFilter({
    hierarchy_nodes: form.hierarchy_nodes,
    datapoints: form.datapoints,
    tags: form.tags,
    adapters: form.adapters,
    q: form.q,
    value_filter: form.valueOperator ? { operator: form.valueOperator } : null,
  }),
)
const errorMsg = ref('')
const saving = ref(false)
const dirty = ref(false)
const confirmOpen = ref(false)
const expanding = ref(false)
const loadedSet = ref(null)
// Cache hierarchy node descendants by `${tree_id}:${node_id}` so we can
// resolve descendants client-side without needing a dedicated backend route.
const hierarchyTreeCache = new Map() // tree_id -> array of {id, parent_id}

function operatorsFor(dataType) {
  return OPERATOR_OPTIONS[dataType] || OPERATOR_OPTIONS.number
}

function markDirty() {
  dirty.value = true
}

const hierarchyIds = computed(() =>
  form.hierarchy_nodes.map((n) => `${n.tree_id}:${n.node_id}`),
)

function chipLabel(item) {
  if (item?.path && Array.isArray(item.path)) return item.path.join(' › ')
  return item?.label ?? item?.name ?? String(item?.id ?? '')
}

function parseCompositeId(compositeId) {
  const idx = String(compositeId).indexOf(':')
  if (idx <= 0) return null
  return { tree_id: compositeId.slice(0, idx), node_id: compositeId.slice(idx + 1) }
}

function onHierarchyChange(ids) {
  const next = []
  for (const id of ids || []) {
    const parsed = parseCompositeId(id)
    if (!parsed) continue
    const existing = form.hierarchy_nodes.find(
      (n) => n.tree_id === parsed.tree_id && n.node_id === parsed.node_id,
    )
    next.push(
      existing || {
        tree_id: parsed.tree_id,
        node_id: parsed.node_id,
        include_descendants: true,
      },
    )
  }
  form.hierarchy_nodes = next
  markDirty()
}

function onDpsChange(ids) {
  form.datapoints = Array.isArray(ids) ? [...ids] : []
  markDirty()
}

function onTagsChange(ids) {
  form.tags = Array.isArray(ids) ? [...ids] : []
  markDirty()
}

function onAdaptersChange(ids) {
  form.adapters = Array.isArray(ids) ? [...ids] : []
  markDirty()
}

function onPickColor(color) {
  form.color = color
  markDirty()
}

function onValueTypeChange() {
  // Reset operator when switching type because the operator set changes.
  form.valueOperator = ''
  form.valueInput = ''
  form.valueLower = ''
  form.valueUpper = ''
  form.valuePattern = ''
  markDirty()
}

function parseLiteral(raw, dataType) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (dataType === 'number') {
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }
  if (dataType === 'bool') {
    const lower = text.toLowerCase()
    if (lower === 'true' || lower === '1') return true
    if (lower === 'false' || lower === '0') return false
    return null
  }
  return text
}

function buildValueFilter() {
  if (!form.valueOperator) {
    if (form.valueDataType === 'regex' && form.valuePattern.trim()) {
      return {
        operator: 'regex',
        pattern: form.valuePattern.trim(),
        ignore_case: Boolean(form.valueIgnoreCase),
      }
    }
    return null
  }
  if (form.valueOperator === 'between') {
    const lower = parseLiteral(form.valueLower, form.valueDataType)
    const upper = parseLiteral(form.valueUpper, form.valueDataType)
    if (lower === null && upper === null) return null
    return { operator: 'between', lower, upper }
  }
  if (form.valueOperator === 'regex') {
    const pattern = form.valuePattern.trim()
    if (!pattern) return null
    return { operator: 'regex', pattern, ignore_case: Boolean(form.valueIgnoreCase) }
  }
  const value = parseLiteral(form.valueInput, form.valueDataType)
  if (value === null) return null
  return { operator: form.valueOperator, value }
}

function buildPayload() {
  return {
    name: form.name.trim(),
    description: form.description || '',
    dsl_version: 2,
    is_active: Boolean(form.is_active),
    color: form.color || DEFAULT_COLOR,
    topbar_active: loadedSet.value?.topbar_active ?? false,
    topbar_order: loadedSet.value?.topbar_order ?? 0,
    filter: {
      hierarchy_nodes: form.hierarchy_nodes.map((n) => ({
        tree_id: String(n.tree_id),
        node_id: String(n.node_id),
        include_descendants: n.include_descendants !== false,
      })),
      datapoints: [...form.datapoints],
      tags: [...form.tags],
      adapters: [...form.adapters],
      q: form.q ? form.q.trim() : null,
      value_filter: buildValueFilter(),
    },
  }
}

function hydrateForm(payload) {
  loadedSet.value = payload
  Object.assign(form, makeEmptyForm())
  if (!payload) {
    dirty.value = false
    return
  }
  form.name = payload.name || ''
  form.description = payload.description || ''
  form.color = payload.color || DEFAULT_COLOR
  form.is_active = Boolean(payload.is_active)

  const flt = payload.filter || {}
  form.hierarchy_nodes = Array.isArray(flt.hierarchy_nodes)
    ? flt.hierarchy_nodes.map((n) => ({
        tree_id: String(n.tree_id),
        node_id: String(n.node_id),
        include_descendants: n.include_descendants !== false,
      }))
    : []
  form.datapoints = Array.isArray(flt.datapoints) ? [...flt.datapoints] : []
  form.tags = Array.isArray(flt.tags) ? [...flt.tags] : []
  form.adapters = Array.isArray(flt.adapters) ? [...flt.adapters] : []
  form.q = flt.q || ''

  const vf = flt.value_filter
  if (vf?.operator) {
    if (vf.operator === 'regex') {
      form.valueDataType = 'regex'
      form.valueOperator = 'regex'
      form.valuePattern = String(vf.pattern || '')
      form.valueIgnoreCase = Boolean(vf.ignore_case)
    } else if (vf.operator === 'between') {
      form.valueDataType = 'number'
      form.valueOperator = 'between'
      form.valueLower = vf.lower == null ? '' : String(vf.lower)
      form.valueUpper = vf.upper == null ? '' : String(vf.upper)
    } else {
      const raw = vf.value
      if (typeof raw === 'boolean') form.valueDataType = 'bool'
      else if (typeof raw === 'number') form.valueDataType = 'number'
      else form.valueDataType = 'string'
      form.valueOperator = vf.operator
      form.valueInput = raw == null ? '' : String(raw)
    }
  }

  dirty.value = false
}

async function loadSet(id) {
  errorMsg.value = ''
  try {
    const { data } = await ringbufferApi.getFilterset(id)
    hydrateForm(data)
  } catch (err) {
    errorMsg.value = err?.response?.data?.detail || err?.message || 'Filterset konnte nicht geladen werden'
  }
}

async function loadHierarchyTree(treeId) {
  if (hierarchyTreeCache.has(treeId)) return hierarchyTreeCache.get(treeId)
  try {
    const { data } = await hierarchyApi.getTreeNodes(treeId)
    const nodes = Array.isArray(data) ? data : []
    hierarchyTreeCache.set(treeId, nodes)
    return nodes
  } catch {
    hierarchyTreeCache.set(treeId, [])
    return []
  }
}

function collectDescendants(nodes, rootId) {
  const byParent = new Map()
  for (const n of nodes) {
    const key = n.parent_id == null ? null : String(n.parent_id)
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(String(n.id))
  }
  const out = [String(rootId)]
  const stack = [String(rootId)]
  while (stack.length) {
    const cur = stack.pop()
    const children = byParent.get(cur) || []
    for (const child of children) {
      if (!out.includes(child)) {
        out.push(child)
        stack.push(child)
      }
    }
  }
  return out
}

async function expandHierarchyChip(item, index) {
  if (expanding.value) return
  // The combobox's chip-slot passes us the resolved `item` (composite id +
  // path). Map back to our authoritative state via the index.
  const node = form.hierarchy_nodes[index]
  if (!node) return
  expanding.value = true
  errorMsg.value = ''
  try {
    const nodes = await loadHierarchyTree(node.tree_id)
    const nodeIds = collectDescendants(nodes, node.node_id)
    const { data } = await searchApi.search({
      node_id: nodeIds.join(','),
      size: 500,
    })
    const items = Array.isArray(data?.items) ? data.items : []
    const newDpIds = items.map((it) => String(it.id))
    const merged = Array.from(new Set([...form.datapoints, ...newDpIds]))
    form.datapoints = merged
    // Drop the expanded hierarchy chip.
    form.hierarchy_nodes = form.hierarchy_nodes.filter((n, i) => i !== index)
    markDirty()
  } catch (err) {
    errorMsg.value = err?.response?.data?.detail || err?.message || 'Knoten konnten nicht aufgelöst werden'
  } finally {
    expanding.value = false
  }
  // suppress unused-arg warning while still documenting the slot contract
  void item
}

async function onSave(addToTopbar) {
  errorMsg.value = ''
  if (!form.name.trim()) {
    errorMsg.value = 'Name ist erforderlich'
    return
  }
  saving.value = true
  try {
    const payload = buildPayload()
    let savedId
    if (props.setId) {
      const { data } = await ringbufferApi.updateFilterset(props.setId, payload)
      savedId = data?.id ?? props.setId
    } else {
      const { data } = await ringbufferApi.createFilterset(payload)
      savedId = data?.id
    }
    if (addToTopbar && savedId) {
      try {
        await ringbufferApi.patchFiltersetTopbar(savedId, { topbar_active: true })
      } catch (err) {
        // Surface but don't block emit — the set itself was saved.
        errorMsg.value = err?.response?.data?.detail || err?.message || 'Topbar-Update fehlgeschlagen'
      }
    }
    dirty.value = false
    emit('saved', { id: savedId, topbar: Boolean(addToTopbar) })
    emit('update:modelValue', false)
  } catch (err) {
    errorMsg.value = err?.response?.data?.detail || err?.message || 'Speichern fehlgeschlagen'
  } finally {
    saving.value = false
  }
}

function onCancel() {
  if (dirty.value) {
    confirmOpen.value = true
    return
  }
  emit('update:modelValue', false)
}

function confirmDiscard() {
  dirty.value = false
  emit('update:modelValue', false)
}

function onModalToggle(open) {
  if (open) return
  onCancel()
}

// Keyboard semantics inside the editor:
//   - Enter outside a text-field → "Speichern & in Topleiste"
//   - ESC inside a text-field → blur the field (so combobox dropdowns
//     close, then focus leaves the input). The modal stays open; the
//     next ESC closes it.
//   - ESC outside any text-field → handled by Modal itself, which routes
//     through onModalToggle → onCancel and respects the dirty-confirm flow.
function onKeyDown(event) {
  if (!props.modelValue) return
  // Don't interfere while the discard-confirm dialog is open — that
  // dialog owns the keyboard.
  if (confirmOpen.value) return
  const target = event.target
  const tag = target?.tagName?.toUpperCase?.() || ''
  const inEditable =
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable)

  if (event.key === 'Escape') {
    if (inEditable && typeof target.blur === 'function') {
      // Field-internal ESC handlers (e.g. combobox closing its dropdown)
      // already ran during the bubble phase; we just remove focus so the
      // next ESC closes the modal. Modal.vue skips ESC when target is
      // editable, so the modal stays open here.
      target.blur()
    }
    return
  }

  if (event.key === 'Enter') {
    // Native fields keep their own Enter behaviour (combobox option-select,
    // <select> value cycling, button activation, form submit on <input>).
    if (inEditable || tag === 'BUTTON') return
    if (filterIsEmpty.value || saving.value) return
    event.preventDefault()
    void onSave(true)
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown)
})

watch(
  () => [props.modelValue, props.setId],
  async ([open, id]) => {
    if (!open) return
    if (id) {
      await loadSet(id)
    } else {
      hydrateForm(null)
    }
  },
  { immediate: true },
)
</script>
