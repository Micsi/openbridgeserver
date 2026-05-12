<template>
  <Modal v-model="openModel" title="CSV/TSV-Export" :soft-backdrop="true" max-width="lg">
    <div class="flex flex-col gap-4">
      <!-- Format -->
      <div class="form-group">
        <label class="label">Format</label>
        <div class="flex gap-4">
          <label class="inline-flex items-center gap-2">
            <input type="radio" value="csv" v-model="form.format" data-testid="export-format-csv" />
            <span>CSV (Komma)</span>
          </label>
          <label class="inline-flex items-center gap-2">
            <input type="radio" value="tsv" v-model="form.format" data-testid="export-format-tsv" />
            <span>TSV (Tab)</span>
          </label>
        </div>
        <p class="text-xs text-slate-500 mt-1">Dateiendung: <code class="font-mono">.{{ form.format }}</code></p>
      </div>

      <!-- Encoding -->
      <div class="form-group">
        <label class="label">Zeichenkodierung</label>
        <select v-model="form.encoding" class="input" data-testid="export-encoding">
          <option value="utf8">UTF-8</option>
          <option value="utf8-bom">UTF-8 mit BOM (für ältere Excel-Versionen)</option>
        </select>
      </div>

      <!-- Optional columns -->
      <div class="form-group">
        <label class="label">Zusätzliche Spalten</label>
        <div class="flex flex-col gap-1.5">
          <label class="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="form.include_unit" data-testid="export-include-unit" />
            <span><code class="font-mono">unit</code> — Einheit aus dem Datapoint</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="form.include_matched_set_ids" data-testid="export-include-matched" />
            <span><code class="font-mono">matched_set_ids</code> — IDs der Sets, die jede Zeile getroffen haben</span>
          </label>
        </div>
      </div>

      <p v-if="errorMsg" class="text-sm text-red-500" data-testid="export-error">{{ errorMsg }}</p>
    </div>

    <template #footer>
      <button class="btn-secondary" data-testid="btn-export-cancel" @click="openModel = false">Abbrechen</button>
      <button class="btn-primary" :disabled="busy" data-testid="btn-export-go" @click="onExport">
        <Spinner v-if="busy" size="sm" color="white" />
        Exportieren
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { ringbufferApi } from '@/api/client'
import Modal from '@/components/ui/Modal.vue'
import Spinner from '@/components/ui/Spinner.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  setIds: { type: Array, default: () => [] },
  time: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

const openModel = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const form = reactive({
  format: 'csv',
  encoding: 'utf8',
  include_unit: true,
  include_matched_set_ids: false,
})
const busy = ref(false)
const errorMsg = ref('')

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    errorMsg.value = ''
    try {
      const { data } = await ringbufferApi.getExportSettings()
      if (data) Object.assign(form, data)
    } catch {
      // fall back to defaults silently
    }
  },
  { immediate: true },
)

async function onExport() {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    // Persist settings in the background; failure doesn't block the export
    ringbufferApi.putExportSettings({ ...form }).catch(() => {})

    const body = {
      set_ids: props.setIds || [],
      time: props.time || null,
      format: form.format,
      encoding: form.encoding,
      include_unit: form.include_unit,
      include_matched_set_ids: form.include_matched_set_ids,
    }
    const resp = await ringbufferApi.exportMultiCsv(body)

    // Trigger browser download
    const blob = resp.data instanceof Blob ? resp.data : new Blob([resp.data])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Extract filename from Content-Disposition if present
    const cd = resp.headers?.['content-disposition'] || ''
    const match = cd.match(/filename="([^"]+)"/)
    a.download = match ? match[1] : `ringbuffer_export.${form.format}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    openModel.value = false
  } catch (err) {
    errorMsg.value = err?.response?.data?.detail || err?.message || 'Export fehlgeschlagen'
  } finally {
    busy.value = false
  }
}
</script>
