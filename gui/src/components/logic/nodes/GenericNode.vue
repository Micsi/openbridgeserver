<template>
  <div class="gn-wrap" @mouseenter="hovered = true" @mouseleave="hovered = false">

    <!-- Input handles (LEFT) -->
    <Handle
      v-for="(inp, i) in def.inputs" :key="'in-' + inp.id"
      type="target"
      :id="inp.id"
      :position="Position.Left"
      :style="{ top: hPos(i, def.inputs.length) }"
      class="gn-handle"
    />

    <!-- Node body -->
    <div class="gn-card" :style="{ '--accent': def.color }">
      <div class="gn-header">
        <span class="gn-label">{{ data.label || def.label }}</span>
        <button v-show="hovered" class="gn-delete" @click.stop="remove" title="Block löschen">✕</button>
      </div>

      <!-- Config summary line -->
      <div v-if="summary" class="gn-summary">{{ summary }}</div>

      <!-- Port labels -->
      <div v-if="def.inputs.length || def.outputs.length" class="gn-ports">
        <div class="gn-port-col">
          <span v-for="inp in def.inputs" :key="inp.id" class="gn-port-label text-left">{{ inp.label }}</span>
        </div>
        <div class="gn-port-col items-end">
          <span v-for="out in def.outputs" :key="out.id" class="gn-port-label text-right">{{ out.label }}</span>
        </div>
      </div>
    </div>

    <!-- Output handles (RIGHT) -->
    <Handle
      v-for="(out, i) in def.outputs" :key="'out-' + out.id"
      type="source"
      :id="out.id"
      :position="Position.Right"
      :style="{ top: hPos(i, def.outputs.length) }"
      class="gn-handle gn-handle-out"
    />

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'

// ── Props (Vue Flow passes id, type, data to every custom node) ────────────
const props = defineProps({
  id:   { type: String,  required: true },
  type: { type: String,  required: true },
  data: { type: Object,  default: () => ({}) },
})

// ── Handle / style definitions by node type ────────────────────────────────
const NODE_DEFS = {
  // Logic
  and:         { label: 'AND',        color: '#1d4ed8', inputs: [{id:'a',label:'A'},{id:'b',label:'B'}],      outputs: [{id:'out',label:'Out'}] },
  or:          { label: 'OR',         color: '#1d4ed8', inputs: [{id:'a',label:'A'},{id:'b',label:'B'}],      outputs: [{id:'out',label:'Out'}] },
  not:         { label: 'NOT',        color: '#1d4ed8', inputs: [{id:'in',label:'In'}],                       outputs: [{id:'out',label:'Out'}] },
  xor:         { label: 'XOR',        color: '#1d4ed8', inputs: [{id:'a',label:'A'},{id:'b',label:'B'}],      outputs: [{id:'out',label:'Out'}] },
  compare:     { label: 'Vergleich',  color: '#1d4ed8', inputs: [{id:'a',label:'A'},{id:'b',label:'B'}],      outputs: [{id:'out',label:'Ergebnis'}] },
  hysteresis:  { label: 'Hysterese',  color: '#1d4ed8', inputs: [{id:'value',label:'Wert'}],                  outputs: [{id:'out',label:'Out'}] },
  // Math
  math_formula:{ label: 'Formel',     color: '#7c3aed', inputs: [{id:'a',label:'a'},{id:'b',label:'b'},{id:'c',label:'c'}], outputs: [{id:'result',label:'Ergebnis'}] },
  math_map:    { label: 'Skalieren',  color: '#7c3aed', inputs: [{id:'value',label:'Wert'}],                  outputs: [{id:'result',label:'Ergebnis'}] },
  // Timer
  timer_delay: { label: 'Verzögerung',color: '#b45309', inputs: [{id:'trigger',label:'Trigger'}],             outputs: [{id:'trigger',label:'Trigger'}] },
  timer_pulse: { label: 'Impuls',     color: '#b45309', inputs: [{id:'trigger',label:'Trigger'}],             outputs: [{id:'out',label:'Out'}] },
  timer_cron:  { label: 'Zeitplan',   color: '#b45309', inputs: [],                                           outputs: [{id:'trigger',label:'Trigger'}] },
  // MCP
  mcp_tool:    { label: 'MCP Tool',   color: '#0e7490', inputs: [{id:'trigger',label:'Trigger'},{id:'input',label:'Input'}], outputs: [{id:'result',label:'Ergebnis'},{id:'done',label:'Fertig'}] },
}

const def = computed(() => NODE_DEFS[props.type] ?? {
  label: props.type,
  color: '#475569',
  inputs: [],
  outputs: [],
})

// ── Config summary ─────────────────────────────────────────────────────────
const summary = computed(() => {
  const d = props.data
  if (props.type === 'compare')      return `A ${d.operator ?? '>'} B`
  if (props.type === 'hysteresis')   return `ON ≥ ${d.threshold_on ?? 25} / OFF ≤ ${d.threshold_off ?? 20}`
  if (props.type === 'math_formula') return d.formula ?? 'a + b'
  if (props.type === 'math_map')     return `[${d.in_min ?? 0}–${d.in_max ?? 100}] → [${d.out_min ?? 0}–${d.out_max ?? 1}]`
  if (props.type === 'timer_delay')  return `${d.delay_s ?? 1} s`
  if (props.type === 'timer_pulse')  return `${d.duration_s ?? 1} s`
  if (props.type === 'timer_cron')   return d.cron ?? '0 7 * * *'
  if (props.type === 'mcp_tool')     return d.tool_name ?? '—'
  return null
})

// ── Handle vertical position ───────────────────────────────────────────────
function hPos(index, total) {
  if (total === 1) return '50%'
  const step = 100 / (total + 1)
  return `${step * (index + 1)}%`
}

// ── Delete ─────────────────────────────────────────────────────────────────
const { removeNodes } = useVueFlow()
const hovered = ref(false)
function remove() { removeNodes([props.id]) }
</script>

<style scoped>
.gn-wrap    { position: relative; }

.gn-card {
  min-width: 130px;
  background: #1e293b;
  border: 1px solid #334155;
  border-top: 3px solid var(--accent, #475569);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,.4);
}

.gn-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.gn-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #f1f5f9;
}

.gn-delete {
  font-size: 11px;
  color: #64748b;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color .15s;
}
.gn-delete:hover { color: #f87171; }

.gn-summary {
  font-size: 10px;
  color: #94a3b8;
  padding: 2px 10px 4px;
  border-bottom: 1px solid #1e293b;
  font-family: ui-monospace, monospace;
}

.gn-ports {
  display: flex;
  justify-content: space-between;
  padding: 3px 10px 5px;
}
.gn-port-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gn-port-label {
  font-size: 9px;
  color: #64748b;
}

.gn-handle {
  width: 10px !important;
  height: 10px !important;
  background: #94a3b8 !important;
  border: 2px solid #1e293b !important;
  border-radius: 50%;
}
.gn-handle-out {
  background: #60a5fa !important;
}
</style>
