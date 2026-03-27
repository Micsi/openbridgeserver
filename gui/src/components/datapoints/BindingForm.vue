<template>
  <form @submit.prevent="submit" class="flex flex-col gap-4">
    <div class="grid grid-cols-2 gap-4">
      <div class="form-group">
        <label class="label">Adapter-Instanz *</label>
        <!-- Bearbeiten: Instanz-Name read-only anzeigen -->
        <div v-if="props.initial" class="input bg-slate-800/50 text-slate-400 cursor-not-allowed">
          {{ currentInstanceName }}
        </div>
        <!-- Neu: Instanz aus Liste wählen -->
        <select v-else v-model="form.adapter_instance_id" class="input" required>
          <option value="">Instanz wählen …</option>
          <optgroup v-for="group in groupedInstances" :key="group.type" :label="group.type">
            <option v-for="inst in group.items" :key="inst.id" :value="inst.id">
              {{ inst.name }}
            </option>
          </optgroup>
        </select>
      </div>
      <div class="form-group">
        <label class="label">Direction *</label>
        <select v-model="form.direction" class="input">
          <option value="SOURCE">SOURCE — Adapter → System</option>
          <option value="DEST">DEST — System → Adapter</option>
          <option value="BOTH">BOTH — beidseitig</option>
        </select>
      </div>
    </div>

    <!-- Binding config (JSON editor) -->
    <div class="form-group">
      <label class="label">
        Binding Config (JSON)
        <button type="button" v-if="schema" @click="showSchema = !showSchema" class="ml-2 text-xs text-blue-400 hover:underline">
          {{ showSchema ? 'Schema ausblenden' : 'Schema anzeigen' }}
        </button>
      </label>
      <div v-if="showSchema && schema" class="mb-2 p-3 bg-surface-700 rounded-lg text-xs font-mono text-slate-400 max-h-40 overflow-y-auto">
        <pre>{{ JSON.stringify(schema?.properties ?? {}, null, 2) }}</pre>
      </div>
      <textarea v-model="configJson" class="input font-mono text-sm resize-none h-32" placeholder='{"group_address": "1/2/3", "dpt": "DPT9"}' />
    </div>

    <div class="flex items-center gap-2">
      <input type="checkbox" id="enabled" v-model="form.enabled" class="w-4 h-4 rounded" />
      <label for="enabled" class="text-sm text-slate-300">Aktiviert</label>
    </div>

    <div v-if="error" class="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{{ error }}</div>

    <div class="flex justify-end gap-3 pt-2">
      <button type="button" @click="$emit('cancel')" class="btn-secondary">Abbrechen</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" size="sm" color="white" />
        Speichern
      </button>
    </div>
  </form>
</template>

<script setup>
import { ref, reactive, watch, computed, onMounted } from 'vue'
import { dpApi, adapterApi } from '@/api/client'
import Spinner from '@/components/ui/Spinner.vue'

const props = defineProps({
  dpId:    { type: String, required: true },
  initial: { type: Object, default: null },
})
const emit = defineEmits(['save', 'cancel'])

const saving     = ref(false)
const error      = ref(null)
const showSchema = ref(false)
const schema     = ref(null)
const allInstances = ref([])   // [{ id, adapter_type, name }]
const configJson = ref('{}')

const form = reactive({
  adapter_instance_id: '',
  direction:           'SOURCE',
  config:              {},
  enabled:             true,
})

// Instanzen nach Typ gruppiert (für Optgroup)
const groupedInstances = computed(() => {
  const groups = {}
  for (const inst of allInstances.value) {
    if (!groups[inst.adapter_type]) groups[inst.adapter_type] = []
    groups[inst.adapter_type].push(inst)
  }
  return Object.entries(groups).map(([type, items]) => ({ type, items }))
})

// Name der aktuellen Instanz (beim Bearbeiten)
const currentInstanceName = computed(() => {
  if (!props.initial) return ''
  if (props.initial.instance_name) return `${props.initial.instance_name} (${props.initial.adapter_type})`
  return props.initial.adapter_type
})

// Init beim Bearbeiten
watch(() => props.initial, val => {
  if (val) {
    form.adapter_instance_id = val.adapter_instance_id ?? ''
    form.direction           = val.direction
    form.enabled             = val.enabled
    configJson.value         = JSON.stringify(val.config, null, 2)
  }
}, { immediate: true })

// Schema laden wenn Instanz gewählt
watch(() => form.adapter_instance_id, async (instanceId) => {
  if (!instanceId) { schema.value = null; return }
  const inst = allInstances.value.find(i => i.id === instanceId)
  if (!inst) return
  try {
    const { data } = await adapterApi.bindingSchema(inst.adapter_type)
    schema.value = data
  } catch { schema.value = null }
})

onMounted(async () => {
  try {
    const { data } = await adapterApi.listInstances()
    allInstances.value = data
  } catch {}
})

async function submit() {
  error.value  = null
  saving.value = true
  try {
    let cfg
    try { cfg = JSON.parse(configJson.value) } catch {
      error.value = 'Ungültiges JSON in Binding Config'; saving.value = false; return
    }
    if (props.initial) {
      await dpApi.updateBinding(props.dpId, props.initial.id, {
        direction: form.direction, config: cfg, enabled: form.enabled,
      })
    } else {
      if (!form.adapter_instance_id) {
        error.value = 'Bitte eine Adapter-Instanz wählen'; saving.value = false; return
      }
      await dpApi.createBinding(props.dpId, {
        adapter_instance_id: form.adapter_instance_id,
        direction: form.direction, config: cfg, enabled: form.enabled,
      })
    }
    emit('save')
  } catch (e) {
    error.value = e.response?.data?.detail ?? 'Fehler beim Speichern'
  } finally {
    saving.value = false
  }
}
</script>
