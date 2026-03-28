<template>
  <div v-if="node" class="h-full flex flex-col bg-slate-900 border-l border-slate-700/60 w-72">

    <!-- Header -->
    <div class="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-slate-200">{{ nodeDef?.label ?? node.type }}</h3>
      <button @click="$emit('close')" class="btn-icon text-slate-500">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <!-- ── DataPoint nodes: tab UI ────────────────────────────────────── -->
    <template v-if="isDatapointNode">

      <!-- Tab bar -->
      <div class="flex border-b border-slate-700/60">
        <button v-for="tab in tabs" :key="tab.id"
          @click="activeTab = tab.id"
          :class="['tab-btn', activeTab === tab.id && 'tab-btn--active']">
          {{ tab.label }}
          <span v-if="tab.dot" class="tab-dot">•</span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">

        <!-- Verbindung -->
        <div v-show="activeTab === 'connection'" class="p-4 flex flex-col gap-3">
          <p class="text-xs text-slate-500">{{ nodeDef?.description }}</p>
          <div class="form-group">
            <label class="label">DataPoint</label>
            <input v-model="dpSearch" type="text" class="input text-sm" placeholder="Suchen…" @input="searchDps" />
            <div v-if="dpResults.length"
              class="mt-1 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              <button v-for="dp in dpResults" :key="dp.id"
                @click="selectDp(dp)"
                class="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-700 text-slate-200">
                {{ dp.name }}
                <span class="text-slate-500 ml-1">{{ dp.data_type }}</span>
              </button>
            </div>
            <div v-if="localData.datapoint_name" class="mt-1 text-xs text-teal-400">
              ✓ {{ localData.datapoint_name }}
            </div>
          </div>
        </div>

        <!-- Transformation -->
        <div v-show="activeTab === 'transform'" class="p-4 flex flex-col gap-3">
          <div class="section-label">Wert-Transformation</div>
          <div class="form-group">
            <label class="label">Formel <span class="text-slate-500 font-normal">— Variable: <code class="text-teal-400">x</code></span></label>
            <!-- Preset dropdown + formula input side by side -->
            <div class="flex gap-2">
              <select v-model="formulaPreset" @change="onPresetChange" class="input text-xs flex-1 min-w-0">
                <option value="">— Preset wählen —</option>
                <optgroup label="Multiplizieren">
                  <option v-for="p in MULTIPLY_PRESETS" :key="p.f" :value="p.f">{{ p.label }}</option>
                </optgroup>
                <optgroup label="Dividieren">
                  <option v-for="p in DIVIDE_PRESETS" :key="p.f" :value="p.f">{{ p.label }}</option>
                </optgroup>
                <optgroup label="Benutzerdefiniert">
                  <option value="__custom__">Eigene Formel …</option>
                </optgroup>
              </select>
              <input
                v-model="localData.value_formula"
                @input="onFormulaInput"
                @change="emitUpdate"
                class="input text-xs font-mono w-28 shrink-0"
                placeholder="x * 100" />
            </div>
            <p class="text-xs text-slate-500 mt-1">
              Verfügbar: <code class="text-slate-400">abs round min max sqrt floor ceil</code>
              und alle <code class="text-slate-400">math.*</code>-Funktionen.
              Leer = keine Transformation.
            </p>
          </div>
        </div>

        <!-- Filter -->
        <div v-show="activeTab === 'filter'" class="p-4 flex flex-col gap-4">

          <!-- Zeitlicher Filter -->
          <div>
            <div class="section-label">Zeitlicher Filter</div>
            <label class="label mt-2">Min. Zeitabstand zwischen zwei {{ isWrite ? 'Schreibvorgängen' : 'Auslösungen' }}</label>
            <div class="flex gap-2 mt-1">
              <input
                v-model="localData.throttle_value"
                @change="emitUpdate"
                type="number" min="0"
                class="input text-sm flex-1"
                :placeholder="isWrite ? 'z.B. 1' : 'z.B. 1'" />
              <select v-model="localData.throttle_unit" @change="emitUpdate" class="input text-sm w-20 shrink-0">
                <option value="ms">ms</option>
                <option value="s">s</option>
                <option value="min">min</option>
                <option value="h">h</option>
              </select>
            </div>
            <p class="text-xs text-slate-500 mt-1">
              {{ isWrite ? 'Schreibvorgänge' : 'Auslösungen' }} innerhalb des Intervalls werden verworfen.
            </p>
          </div>

          <!-- Wert-Filter -->
          <div>
            <div class="section-label">Wert-Filter</div>

            <!-- Checkbox: on_change -->
            <label class="flex items-start gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                :checked="boolVal(isWrite ? 'only_on_change' : 'trigger_on_change')"
                @change="e => { setBool(isWrite ? 'only_on_change' : 'trigger_on_change', e.target.checked); emitUpdate() }"
                class="mt-0.5 accent-teal-500" />
              <span class="text-xs text-slate-300 leading-snug">
                {{ isWrite
                  ? 'Nur schreiben wenn Wert sich geändert hat (kein Duplikat)'
                  : 'Nur auslösen wenn Wert sich geändert hat (kein Duplikat)' }}
              </span>
            </label>

            <!-- min_delta -->
            <label class="label mt-3">Nur {{ isWrite ? 'schreiben' : 'auslösen' }} bei Mindest-Abweichung</label>
            <div class="flex gap-2 mt-1">
              <div class="flex-1">
                <input
                  v-model="localData.min_delta"
                  @change="emitUpdate"
                  type="number" min="0" step="any"
                  class="input text-sm w-full"
                  placeholder="z.B. 0.5" />
                <p class="text-xs text-slate-600 mt-0.5">Absolut</p>
              </div>
              <div v-if="!isWrite" class="flex-1">
                <input
                  v-model="localData.min_delta_pct"
                  @change="emitUpdate"
                  type="number" min="0" step="any"
                  class="input text-sm w-full"
                  placeholder="z.B. 2" />
                <p class="text-xs text-slate-600 mt-0.5">Relativ (%)</p>
              </div>
            </div>
            <p class="text-xs text-slate-500 mt-1">
              Leer = inaktiv. {{ !isWrite ? 'Beide aktiv = beide müssen erfüllt sein. ' : '' }}Nur für numerische Werte.
            </p>
          </div>
        </div>

      </div><!-- /scroll area -->
    </template>

    <!-- ── All other node types: generic rendering ─────────────────────── -->
    <template v-else>
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <p v-if="nodeDef?.description" class="text-xs text-slate-500">{{ nodeDef.description }}</p>
        <template v-if="nodeDef?.config_schema">
          <div v-for="(schema, key) in configFields" :key="key" class="form-group">
            <label class="label">{{ schema.label ?? key }}</label>
            <textarea v-if="schema.type === 'string' && key === 'script'"
              v-model="localData[key]" rows="6"
              class="input text-xs font-mono resize-y" @change="emitUpdate" />
            <select v-else-if="schema.enum"
              v-model="localData[key]" class="input text-sm" @change="emitUpdate">
              <option v-for="opt in schema.enum" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <input v-else
              v-model="localData[key]"
              :type="schema.type === 'number' ? 'number' : 'text'"
              class="input text-sm" @change="emitUpdate" />
          </div>
        </template>
      </div>
    </template>

    <!-- Footer -->
    <div class="p-3 border-t border-slate-700/60">
      <button @click="emitUpdate" class="btn-primary w-full btn-sm">Übernehmen</button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { dpApi } from '@/api/client'

const props = defineProps({
  node:      { type: Object, default: null },
  nodeTypes: { type: Array,  default: () => [] },
})
const emit = defineEmits(['update', 'close'])

// ── State ──────────────────────────────────────────────────────────────────
const localData  = ref({})
const dpSearch   = ref('')
const dpResults  = ref([])
const activeTab  = ref('connection')

// ── Presets ────────────────────────────────────────────────────────────────
const MULTIPLY_PRESETS = [
  { f: 'x * 86400',  label: '× 86.400 (Tage → Sekunden)'    },
  { f: 'x * 3600',   label: '× 3.600 (Stunden → Sekunden)'  },
  { f: 'x * 1440',   label: '× 1.440 (Tage → Minuten)'      },
  { f: 'x * 1000',   label: '× 1.000'                        },
  { f: 'x * 100',    label: '× 100'                          },
  { f: 'x * 60',     label: '× 60 (Minuten → Sekunden)'      },
  { f: 'x * 10',     label: '× 10'                           },
]
const DIVIDE_PRESETS = [
  { f: 'round(x / 10, 1)',    label: '÷ 10 (Festkomma)'              },
  { f: 'x / 60',              label: '÷ 60 (Sekunden → Minuten)'     },
  { f: 'round(x / 100, 2)',   label: '÷ 100 (Festkomma)'             },
  { f: 'round(x / 1000, 3)',  label: '÷ 1.000 (Festkomma)'           },
  { f: 'x / 1440',            label: '÷ 1.440 (Minuten → Tage)'      },
  { f: 'x / 3600',            label: '÷ 3.600 (Sekunden → Stunden)'  },
  { f: 'x / 86400',           label: '÷ 86.400 (Sekunden → Tage)'    },
]
const ALL_PRESETS = [...MULTIPLY_PRESETS, ...DIVIDE_PRESETS]

// ── Computed ───────────────────────────────────────────────────────────────
const nodeDef = computed(() => props.nodeTypes.find(nt => nt.type === props.node?.type))

const isDatapointNode = computed(() =>
  props.node?.type === 'datapoint_read' || props.node?.type === 'datapoint_write'
)
const isWrite = computed(() => props.node?.type === 'datapoint_write')

const configFields = computed(() => {
  const schema = nodeDef.value?.config_schema ?? {}
  return Object.fromEntries(
    Object.entries(schema).filter(([k]) => !k.startsWith('datapoint_'))
  )
})

const formulaPreset = computed({
  get() {
    const f = localData.value.value_formula || ''
    if (!f) return ''
    return ALL_PRESETS.find(p => p.f === f)?.f ?? '__custom__'
  },
  set(v) { /* handled by onPresetChange */ void v },
})

const hasTransform = computed(() => !!(localData.value.value_formula || '').trim())
const hasFilter    = computed(() => {
  const d = localData.value
  return boolVal('trigger_on_change') || boolVal('only_on_change') ||
         !!(d.min_delta || d.min_delta_pct || d.throttle_value)
})

const tabs = computed(() => [
  { id: 'connection', label: 'Verbindung', dot: false },
  { id: 'transform',  label: 'Transformation', dot: hasTransform.value },
  { id: 'filter',     label: 'Filter',         dot: hasFilter.value    },
])

// ── Helpers ────────────────────────────────────────────────────────────────
function boolVal(key) {
  const v = localData.value[key]
  return v === true || v === 'true'
}
function setBool(key, val) {
  localData.value[key] = val  // store as native boolean
}

// ── Watchers ───────────────────────────────────────────────────────────────
watch(() => props.node, (n) => {
  if (n) {
    localData.value = { ...n.data }
    dpSearch.value  = n.data.datapoint_name || ''
    dpResults.value = []
    activeTab.value = 'connection'
  }
}, { immediate: true })

// ── Preset / formula handlers ──────────────────────────────────────────────
function onPresetChange(e) {
  const val = e.target.value
  if (val && val !== '__custom__') {
    localData.value.value_formula = val
    emitUpdate()
  }
}

function onFormulaInput() {
  // When user types manually, we don't need to do anything special —
  // formulaPreset computed will switch to '__custom__' automatically.
}

// ── DataPoint picker ───────────────────────────────────────────────────────
async function searchDps() {
  if (dpSearch.value.length < 1) { dpResults.value = []; return }
  try {
    const { data } = await dpApi.list(0, 20)
    dpResults.value = (data.items || data).filter(dp =>
      dp.name.toLowerCase().includes(dpSearch.value.toLowerCase())
    )
  } catch { dpResults.value = [] }
}

function selectDp(dp) {
  localData.value.datapoint_id   = dp.id
  localData.value.datapoint_name = dp.name
  dpSearch.value  = dp.name
  dpResults.value = []
  emitUpdate()
}

// ── Emit ───────────────────────────────────────────────────────────────────
function emitUpdate() {
  emit('update', { ...localData.value })
}
</script>

<style scoped>
.tab-btn {
  flex: 1;
  padding: 8px 4px 6px;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color .15s, border-color .15s;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.tab-btn:hover   { color: #94a3b8; }
.tab-btn--active { color: #e2e8f0; border-bottom-color: #14b8a6; }
.tab-dot { color: #14b8a6; font-size: 14px; line-height: 1; }

.section-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .09em;
  text-transform: uppercase;
  color: #14b8a6;
  margin-bottom: 4px;
}
.form-group { display: flex; flex-direction: column; gap: 4px; }
.label      { font-size: 11px; font-weight: 500; color: #94a3b8; }
</style>
