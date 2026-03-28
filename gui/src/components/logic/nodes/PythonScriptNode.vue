<template>
  <div class="gn-wrap" @mouseenter="hovered = true" @mouseleave="hovered = false">

    <Handle type="target" id="a" :position="Position.Left" class="gn-handle" :style="{ top: '35%' }" />
    <Handle type="target" id="b" :position="Position.Left" class="gn-handle" :style="{ top: '52%' }" />
    <Handle type="target" id="c" :position="Position.Left" class="gn-handle" :style="{ top: '69%' }" />

    <div class="gn-card" style="min-width:180px;">
      <div class="gn-header">
        <span class="gn-label">Python Script</span>
        <button v-show="hovered" class="gn-delete" @click.stop="remove" title="Block löschen">✕</button>
      </div>
      <div style="padding:6px 10px 8px;">
        <pre class="script-preview">{{ shortScript }}</pre>
      </div>
      <div style="padding:0 10px 5px;display:flex;justify-content:space-between;">
        <div style="display:flex;flex-direction:column;gap:2px;">
          <span class="port-lbl">a</span>
          <span class="port-lbl">b</span>
          <span class="port-lbl">c</span>
        </div>
        <span class="port-lbl" style="align-self:center;">Ergebnis</span>
      </div>
    </div>

    <Handle type="source" id="result" :position="Position.Right" class="gn-handle gn-handle-out" :style="{ top: '52%' }" />

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

const shortScript = computed(() => {
  const s = props.data.script || '# script'
  return s.length > 80 ? s.slice(0, 77) + '…' : s
})

const hovered = ref(false)
const { removeNodes } = useVueFlow()
function remove() { removeNodes([props.id]) }
</script>

<style scoped>
.gn-wrap       { position: relative; }
.gn-card       { background:#1e293b; border:1px solid #334155; border-top:3px solid #be185d; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.4); }
.gn-header     { display:flex; align-items:center; justify-content:space-between; padding:5px 10px; background:rgba(190,24,93,.15); }
.gn-label      { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#f1f5f9; }
.gn-delete     { font-size:11px; color:#64748b; background:none; border:none; cursor:pointer; padding:0 2px; line-height:1; transition:color .15s; }
.gn-delete:hover { color:#f87171; }
.script-preview{ font-size:10px; color:#f9a8d4; font-family:ui-monospace,monospace; white-space:pre-wrap; max-height:55px; overflow:hidden; margin:0; }
.port-lbl      { font-size:9px; color:#64748b; }
.gn-handle     { width:10px!important; height:10px!important; background:#94a3b8!important; border:2px solid #1e293b!important; border-radius:50%; }
.gn-handle-out { background:#60a5fa!important; }
</style>
