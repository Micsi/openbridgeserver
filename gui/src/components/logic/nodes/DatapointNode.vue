<template>
  <div class="gn-wrap" @mouseenter="hovered = true" @mouseleave="hovered = false">

    <!-- Input handles (write node) -->
    <template v-if="isWrite">
      <Handle type="target" id="value"   :position="Position.Left" class="gn-handle" :style="{ top: '55%' }" />
      <Handle type="target" id="trigger" :position="Position.Left" class="gn-handle" :style="{ top: '72%' }" />
    </template>

    <div class="gn-card" style="min-width:160px;">
      <div class="gn-header">
        <span class="gn-label">{{ isWrite ? 'DP Schreiben' : 'DP Lesen' }}</span>
        <button v-show="hovered" class="gn-delete" @click.stop="remove" title="Block löschen">✕</button>
      </div>
      <div style="padding: 6px 10px 4px;">
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">DataPoint</div>
        <div class="dp-name" :class="data.datapoint_name ? 'active' : 'empty'">
          {{ data.datapoint_name || '— nicht gewählt —' }}
        </div>
      </div>
      <div style="padding: 0 10px 6px; display:flex; justify-content: space-between;">
        <div v-if="isWrite" style="display:flex;flex-direction:column;gap:2px;">
          <span class="port-lbl">Wert</span>
          <span class="port-lbl">Trigger</span>
        </div>
        <div v-else style="display:flex;flex-direction:column;gap:2px;margin-left:auto;">
          <span class="port-lbl" style="text-align:right;">Wert</span>
          <span class="port-lbl" style="text-align:right;">Geändert</span>
        </div>
      </div>
    </div>

    <!-- Output handles (read node) -->
    <template v-if="!isWrite">
      <Handle type="source" id="value"   :position="Position.Right" class="gn-handle gn-handle-out" :style="{ top: '55%' }" />
      <Handle type="source" id="changed" :position="Position.Right" class="gn-handle gn-handle-out" :style="{ top: '72%' }" />
    </template>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'

const props = defineProps({
  id:   { type: String, required: true },
  type: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
})

const isWrite = computed(() => props.type === 'datapoint_write')
const hovered = ref(false)
const { removeNodes } = useVueFlow()
function remove() { removeNodes([props.id]) }
</script>

<style scoped>
.gn-wrap  { position: relative; }
.gn-card  { background:#1e293b; border:1px solid #334155; border-top:3px solid #0f766e; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.4); }
.gn-header{ display:flex; align-items:center; justify-content:space-between; padding:5px 10px; background:rgba(15,118,110,.15); }
.gn-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#f1f5f9; }
.gn-delete{ font-size:11px; color:#64748b; background:none; border:none; cursor:pointer; padding:0 2px; line-height:1; transition:color .15s; }
.gn-delete:hover { color:#f87171; }
.dp-name  { font-size:11px; font-weight:500; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dp-name.active { color:#5eead4; }
.dp-name.empty  { color:#334155; font-style:italic; }
.port-lbl { font-size:9px; color:#64748b; }
.gn-handle     { width:10px!important; height:10px!important; background:#94a3b8!important; border:2px solid #1e293b!important; border-radius:50%; }
.gn-handle-out { background:#60a5fa!important; }
</style>
