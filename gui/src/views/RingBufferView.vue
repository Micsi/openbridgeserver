<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start gap-3">
      <div class="flex-1">
        <h2 class="text-xl font-bold text-slate-800 dark:text-slate-100">Monitor</h2>
        <p class="text-sm text-slate-500 mt-0.5">Live Log</p>
        <p class="text-xs text-slate-500 mt-1" data-testid="ringbuffer-storage-mode-hint">
          Speicherverhalten: file-only mit festen serverseitigen Limits.
        </p>
      </div>
      <button @click="openConfigModal" class="btn-secondary btn-sm" data-testid="btn-open-monitor-config">⚙ Konfigurieren</button>
      <button @click="applyFilters" class="btn-secondary btn-sm" data-testid="btn-refresh-ringbuffer">↻ Aktualisieren</button>
      <button
        v-if="!paused"
        @click="pauseLive"
        class="btn-secondary btn-sm"
        data-testid="btn-live-pause"
      >
        ⏸ Pause
      </button>
      <button
        v-else
        @click="resumeLive"
        class="btn-secondary btn-sm"
        data-testid="btn-live-resume"
      >
        ▶ Resume
      </button>
      <span :class="['inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium',
        wsConnected ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400' : 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-500']"
        data-testid="status-badge">
        <span :class="['w-1.5 h-1.5 rounded-full', wsConnected ? 'bg-teal-400 animate-pulse' : 'bg-slate-600']" />
        {{ wsConnected ? 'Live' : 'Offline' }}
      </span>
      <span
        :class="['inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium',
          paused ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-blue-500/15 text-blue-600 dark:text-blue-400']"
        data-testid="live-mode-badge"
      >
        {{ paused ? `Pausiert (${queuedCount} wartend)` : 'Live' }}
      </span>
      <TopbarStats class="ml-auto" />
    </div>

    <!-- Sticky filter topbar (#435) — drag/toggle/remove set chips, TimeFilterPopover (#432) in the left slot. -->
    <div class="sticky top-0 z-20 -mx-5 px-5 py-2 bg-surface-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/60">
      <TopbarFilterChips
        ref="topbarChipsRef"
        data-testid="ringbuffer-topbar-chips"
        @edit-set="onEditSet"
        @new-set="onNewSet"
        @changed="onTopbarChanged"
      >
        <template #time-filter-slot>
          <TimeFilterPopover v-model="timeFilter" @update:modelValue="onTimeFilterChanged" />
        </template>
      </TopbarFilterChips>
    </div>

    <!-- Soft-modal filter editor (#436) — replaces the stub from #435 -->
    <FilterEditor
      v-model="showFilterEditor"
      :set-id="editorTargetId"
      @saved="onFilterEditorSaved"
    />

    <div class="card overflow-hidden">
      <div v-if="loading" class="flex justify-center py-12"><Spinner size="lg" /></div>
      <div v-else-if="listError" class="px-4 py-6 text-sm text-red-500" data-testid="ringbuffer-error">{{ listError }}</div>
      <div v-else-if="!entries.length" class="text-center text-slate-500 text-sm py-12" data-testid="ringbuffer-empty">Keine Einträge im Monitor</div>
      <div v-else class="table-wrap max-h-[60vh] overflow-y-auto" ref="tableWrapRef" data-testid="ringbuffer-table-wrap">
        <table class="table">
          <thead class="sticky top-0">
            <tr>
              <th>Zeitstempel</th>
              <th>Objekt</th>
              <th>Wert</th>
              <th>Vorheriger Wert</th>
              <th>Qualität</th>
              <th>Adapter</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(e, i) in entries"
              :key="i"
              data-testid="ringbuffer-entry"
              :data-dp="e.datapoint_id"
              :class="getRowStyle(e.matched_set_ids) ? 'ringbuffer-row-matched' : null"
              :style="getRowStyle(e.matched_set_ids)"
              :title="rowMatchTitle(e.matched_set_ids)"
            >
              <td class="font-mono text-xs text-slate-400 whitespace-nowrap">{{ fmtDateTime(e.ts) }}</td>
              <td class="text-sm">
                <RouterLink :to="`/datapoints/${e.datapoint_id}`" class="text-blue-400 hover:underline font-mono text-xs">
                  {{ e.name ?? e.datapoint_id?.slice(0, 8) }}
                </RouterLink>
              </td>
              <td class="font-mono text-sm text-blue-500 dark:text-blue-300">{{ e.new_value }}<span v-if="e.unit" class="text-slate-500 ml-1 text-xs">{{ e.unit }}</span></td>
              <td class="font-mono text-sm text-slate-500">{{ e.old_value ?? '-' }}<span v-if="e.unit && e.old_value !== null && e.old_value !== undefined" class="text-slate-500 ml-1 text-xs">{{ e.unit }}</span></td>
              <td><Badge :variant="e.quality === 'good' ? 'success' : 'warning'" size="xs" dot>{{ qualityLabel(e.quality) }}</Badge></td>
              <td class="text-xs text-slate-500">{{ e.source_adapter ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-model="showConfig" title="Monitor konfigurieren" max-width="md">
      <form @submit.prevent="saveConfig" class="flex flex-col gap-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-500">Speichermodell</label>
            <input class="input" :value="configForm.storage" disabled />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-500">Max. Einträge</label>
            <input v-model.number="configForm.max_entries" type="number" min="100" max="1000000" step="100" class="input" data-testid="rb-config-max-entries" />
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <input id="max-size-enabled" type="checkbox" v-model="configForm.maxSizeEnabled" />
            <label for="max-size-enabled" class="text-sm font-medium">Max. Speicherplatz auf Platte</label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <input
              v-model.trim="configForm.maxSizeValue"
              type="number"
              min="1"
              step="1"
              class="input"
              :disabled="!configForm.maxSizeEnabled"
              data-testid="rb-config-max-size-value"
              placeholder="z. B. 500"
            />
            <select
              v-model="configForm.maxSizeUnit"
              class="input"
              :disabled="!configForm.maxSizeEnabled"
              data-testid="rb-config-max-size-unit"
            >
              <option value="mb">MB</option>
              <option value="gb">GB</option>
            </select>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <input id="retention-enabled" type="checkbox" v-model="configForm.retentionEnabled" />
            <label for="retention-enabled" class="text-sm font-medium">Max. Retention</label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <input
              v-model.trim="configForm.retentionValue"
              type="number"
              min="0"
              step="1"
              class="input"
              :disabled="!configForm.retentionEnabled"
              data-testid="rb-config-retention-value"
              placeholder="z. B. 30"
            />
            <select
              v-model="configForm.retentionUnit"
              class="input"
              :disabled="!configForm.retentionEnabled"
              data-testid="rb-config-retention-unit"
            >
              <option value="days">Tage</option>
              <option value="months">Monate</option>
              <option value="years">Jahre</option>
            </select>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex flex-col gap-2">
          <h4 class="text-sm font-semibold">Ringbuffer Statistik</h4>
          <div class="text-xs text-slate-500 flex items-center justify-between">
            <span>Einträge</span>
            <span class="font-medium text-slate-700 dark:text-slate-200" data-testid="rb-config-stats-total">{{ configStats?.total ?? '-' }}</span>
          </div>
          <div class="text-xs text-slate-500 flex items-center justify-between">
            <span>Belegter Speicherplatz</span>
            <span class="font-medium text-slate-700 dark:text-slate-200" data-testid="rb-config-stats-file-size">{{ formatBytes(configStats?.file_size_bytes ?? 0) }}</span>
          </div>
          <div class="text-xs text-slate-500 flex items-center justify-between">
            <span>Effektive Retention</span>
            <span class="font-medium text-slate-700 dark:text-slate-200" data-testid="rb-config-stats-retention">{{ formatRetention(configStats?.max_age ?? null) }}</span>
          </div>
        </div>

        <div v-if="configMsg" :class="['p-3 rounded-lg text-sm', configMsg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400']">
          {{ configMsg.text }}
        </div>
        <div class="flex justify-end gap-3">
          <button type="button" @click="showConfig = false" class="btn-secondary">Schliessen</button>
          <button type="submit" class="btn-primary" :disabled="configSaving" data-testid="rb-config-save">
            <Spinner v-if="configSaving" size="sm" color="white" />
            Speichern
          </button>
        </div>
      </form>
    </Modal>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ringbufferApi } from '@/api/client'
import { useTz } from '@/composables/useTz'
import { useSetColors } from '@/composables/useSetColors'
import { useWebSocketStore } from '@/stores/websocket'
import Badge from '@/components/ui/Badge.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Modal from '@/components/ui/Modal.vue'
import TimeFilterPopover from '@/components/ui/TimeFilterPopover.vue'
import TopbarFilterChips from '@/views/ringbuffer/TopbarFilterChips.vue'
import TopbarStats from '@/views/ringbuffer/TopbarStats.vue'
import FilterEditor from '@/views/ringbuffer/FilterEditor.vue'

const LIVE_BATCH_SIZE = 200
const LIVE_FLUSH_INTERVAL_MS = 60
const LIVE_QUEUE_MAX = 5000
const DEFAULT_QUERY_LIMIT = 500

const SIZE_UNIT_FACTORS = {
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
}
const RETENTION_UNIT_SECONDS = {
  days: 24 * 60 * 60,
  months: 30 * 24 * 60 * 60,
  years: 365 * 24 * 60 * 60,
}

const { fmtDateTime } = useTz()
const wsStore = useWebSocketStore()
const { getRowStyle, setSets, sets: topbarSetsRef } = useSetColors()

function rowMatchTitle(matchedIds) {
  if (!Array.isArray(matchedIds) || matchedIds.length === 0) return null
  const names = []
  for (const id of matchedIds) {
    const set = topbarSetsRef.value.get(id)
    if (set?.name) names.push(set.name)
  }
  return names.length ? `Match: ${names.join(', ')}` : null
}

const entries = ref([])
const configStats = ref(null)
const loading = ref(false)
const listError = ref('')
const showConfig = ref(false)
const showFilterEditor = ref(false)
const editorTargetId = ref(null)
const topbarChipsRef = ref(null)

function onEditSet(id) {
  editorTargetId.value = id
  showFilterEditor.value = true
}

function onNewSet() {
  editorTargetId.value = null
  showFilterEditor.value = true
}

async function onFilterEditorSaved() {
  // Re-fetch filtersets so the topbar chips reflect any changes (rename,
  // color, topbar membership, etc.). Also refresh the local select-list.
  await loadFiltersets()
  topbarChipsRef.value?.reload?.()
}

async function onTopbarChanged() {
  // Topbar chip toggle / drag-reorder happened — refresh the local filterset
  // cache (which also feeds the row-colour map) and re-run the query so the
  // table reflects the new topbar set composition.
  await loadFiltersets()
  await load()
}

// TimeFilterPopover state (#432 / #438). null = no time filter active.
// Shape: { mode: 'range', from?: Date|{seconds,sign}, to?: Date|{seconds,sign} }
//      | { mode: 'point', point: Date|{seconds,sign}, span: {seconds,sign} }
const timeFilter = ref(null)

async function onTimeFilterChanged() {
  // Re-run the query when the user applies a new time filter.
  await load()
}

const configSaving = ref(false)
const configMsg = ref(null)
const tableWrapRef = ref(null)
const paused = ref(false)
const liveQueue = ref([])

const filtersets = ref([])

const configForm = reactive({
  storage: 'file',
  max_entries: 10000,
  maxSizeEnabled: false,
  maxSizeValue: '500',
  maxSizeUnit: 'mb',
  retentionEnabled: false,
  retentionValue: '30',
  retentionUnit: 'days',
})

const wsConnected = computed(() => wsStore.connected)
const queuedCount = computed(() => liveQueue.value.length)

let unregisterRb = null
let liveFlushTimer = null

function formatBytes(rawBytes) {
  const bytes = Number(rawBytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= SIZE_UNIT_FACTORS.gb) return `${(bytes / SIZE_UNIT_FACTORS.gb).toFixed(2)} GB`
  if (bytes >= SIZE_UNIT_FACTORS.mb) return `${(bytes / SIZE_UNIT_FACTORS.mb).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${Math.round(bytes)} B`
}

function formatRetention(rawSeconds) {
  const seconds = Number(rawSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return 'unbegrenzt'
  if (seconds % RETENTION_UNIT_SECONDS.years === 0) return `${seconds / RETENTION_UNIT_SECONDS.years} Jahre`
  if (seconds % RETENTION_UNIT_SECONDS.months === 0) return `${seconds / RETENTION_UNIT_SECONDS.months} Monate`
  if (seconds % RETENTION_UNIT_SECONDS.days === 0) return `${seconds / RETENTION_UNIT_SECONDS.days} Tage`
  return `${seconds} Sekunden`
}

function parseNonNegativeInteger(raw) {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function pickSizeUnit(bytes) {
  if (bytes % SIZE_UNIT_FACTORS.gb === 0) {
    return { value: String(bytes / SIZE_UNIT_FACTORS.gb), unit: 'gb' }
  }
  return { value: String(Math.max(1, Math.round(bytes / SIZE_UNIT_FACTORS.mb))), unit: 'mb' }
}

function pickRetentionUnit(seconds) {
  if (seconds % RETENTION_UNIT_SECONDS.years === 0) {
    return { value: String(seconds / RETENTION_UNIT_SECONDS.years), unit: 'years' }
  }
  if (seconds % RETENTION_UNIT_SECONDS.months === 0) {
    return { value: String(seconds / RETENTION_UNIT_SECONDS.months), unit: 'months' }
  }
  if (seconds % RETENTION_UNIT_SECONDS.days === 0) {
    return { value: String(seconds / RETENTION_UNIT_SECONDS.days), unit: 'days' }
  }
  return { value: String(Math.ceil(seconds / RETENTION_UNIT_SECONDS.days)), unit: 'days' }
}

function hydrateConfigFormFromStats(currentStats) {
  configForm.storage = 'file'
  configForm.max_entries = Number(currentStats?.max_entries ?? 10000)

  const maxFileSize = Number(currentStats?.max_file_size_bytes)
  if (Number.isFinite(maxFileSize) && maxFileSize > 0) {
    const picked = pickSizeUnit(maxFileSize)
    configForm.maxSizeEnabled = true
    configForm.maxSizeValue = picked.value
    configForm.maxSizeUnit = picked.unit
  } else {
    configForm.maxSizeEnabled = false
    configForm.maxSizeValue = '500'
    configForm.maxSizeUnit = 'mb'
  }

  const maxAge = Number(currentStats?.max_age)
  if (Number.isFinite(maxAge) && maxAge > 0) {
    const picked = pickRetentionUnit(maxAge)
    configForm.retentionEnabled = true
    configForm.retentionValue = picked.value
    configForm.retentionUnit = picked.unit
  } else {
    configForm.retentionEnabled = false
    configForm.retentionValue = '30'
    configForm.retentionUnit = 'days'
  }
}

function buildConfigPayload() {
  const maxEntries = Number(configForm.max_entries)
  if (!Number.isFinite(maxEntries) || maxEntries < 100) {
    throw new Error('Max. Einträge muss mindestens 100 sein')
  }

  const payload = {
    storage: 'file',
    max_entries: Math.round(maxEntries),
    max_file_size_bytes: null,
    max_age: null,
  }

  if (configForm.maxSizeEnabled) {
    const sizeValue = parseNonNegativeInteger(configForm.maxSizeValue)
    if (sizeValue === null || sizeValue <= 0) {
      throw new Error('Max. Speicherplatz muss grösser als 0 sein')
    }
    payload.max_file_size_bytes = sizeValue * SIZE_UNIT_FACTORS[configForm.maxSizeUnit]
  }

  if (configForm.retentionEnabled) {
    const retentionValue = parseNonNegativeInteger(configForm.retentionValue)
    if (retentionValue === null) {
      throw new Error('Retention muss eine gültige Zahl sein')
    }
    payload.max_age = retentionValue * RETENTION_UNIT_SECONDS[configForm.retentionUnit]
  }

  return payload
}

function extractErrorMessage(error, fallback) {
  return error?.response?.data?.detail || error?.message || fallback
}

async function loadFiltersets() {
  try {
    const { data } = await ringbufferApi.listFiltersets()
    filtersets.value = Array.isArray(data) ? data : []
    // Keep the row-colour cache in sync with the topbar state (#437).
    setSets(filtersets.value)
  } catch {
    filtersets.value = []
    setSets([])
  }
}

function enqueueLive(entry) {
  liveQueue.value.push(entry)
  if (liveQueue.value.length > LIVE_QUEUE_MAX) {
    liveQueue.value.splice(0, liveQueue.value.length - LIVE_QUEUE_MAX)
  }
  if (!paused.value) scheduleLiveFlush()
}

function scheduleLiveFlush() {
  if (paused.value || liveFlushTimer) return
  liveFlushTimer = setTimeout(() => {
    liveFlushTimer = null
    void flushLiveQueue()
  }, LIVE_FLUSH_INTERVAL_MS)
}

async function flushLiveQueue() {
  if (paused.value || !liveQueue.value.length) return
  const batch = liveQueue.value.splice(0, LIVE_BATCH_SIZE)
  if (batch.length) {
    entries.value = [...batch.reverse(), ...entries.value].slice(0, DEFAULT_QUERY_LIMIT)
    await nextTick()
    if (tableWrapRef.value) tableWrapRef.value.scrollTop = 0
  }
  if (liveQueue.value.length) scheduleLiveFlush()
}

function buildTimeFilter() {
  // Convert the TimeFilterPopover state (#432) into the backend time-filter
  // shape:
  //   { from?: iso, to?: iso,
  //     from_relative_seconds?: int, to_relative_seconds?: int }
  // Date bounds → ISO strings; relative durations → signed seconds.
  // Point mode (point ± span) collapses into an absolute (from, to) pair.
  const filter = timeFilter.value
  if (!filter) return null
  const time = {}

  function applyBound(bound, key, relKey) {
    if (!bound) return
    if (bound instanceof Date) {
      time[key] = bound.toISOString()
    } else if (Number.isFinite(bound.seconds)) {
      time[relKey] = (bound.sign === -1 ? -1 : 1) * bound.seconds
    }
  }

  if (filter.mode === 'point') {
    const point = filter.point instanceof Date
      ? filter.point
      : (Number.isFinite(filter.point?.seconds)
          ? new Date(Date.now() + (filter.point.sign === -1 ? -1 : 1) * filter.point.seconds * 1000)
          : null)
    const spanSeconds = Number.isFinite(filter.span?.seconds) ? filter.span.seconds : 0
    if (point && spanSeconds > 0) {
      time.from = new Date(point.getTime() - spanSeconds * 1000).toISOString()
      time.to = new Date(point.getTime() + spanSeconds * 1000).toISOString()
    } else if (point) {
      time.from = point.toISOString()
      time.to = point.toISOString()
    }
  } else {
    applyBound(filter.from, 'from', 'from_relative_seconds')
    applyBound(filter.to, 'to', 'to_relative_seconds')
  }

  return Object.keys(time).length ? time : null
}

function buildQueryV2() {
  const payload = {
    filters: {},
    sort: { field: 'ts', order: 'desc' },
    pagination: { limit: DEFAULT_QUERY_LIMIT, offset: 0 },
  }
  const time = buildTimeFilter()
  if (time) payload.filters.time = time
  return payload
}

function pauseLive() {
  paused.value = true
}

function resumeLive() {
  paused.value = false
  scheduleLiveFlush()
}

function onLiveEntry(entry) {
  // Live entries do not carry matched_set_ids yet — the backend WS push has
  // no knowledge of which topbar sets are active. Frontend-side matching is
  // out of scope here (planned in a follow-up). Show the row unmatched.
  enqueueLive({ ...entry, matched_set_ids: Array.isArray(entry?.matched_set_ids) ? entry.matched_set_ids : [] })
}

async function applyFilters() {
  liveQueue.value = []
  await load()
}

onMounted(async () => {
  // Load filtersets first so the topbar-colour cache is populated before
  // load() decides between queryV2 and queryMultiFiltersets (#437).
  // /stats is no longer fetched eagerly — TopbarStats owns its own fetch
  // and the config modal pulls fresh stats on demand via openConfigModal().
  await loadFiltersets()
  await load()
  unregisterRb = wsStore.onRingbufferEntry(onLiveEntry)
})

onUnmounted(() => {
  unregisterRb?.()
  clearTimeout(liveFlushTimer)
})

function activeTopbarSetIds() {
  // Walk the cached topbar-set map in ascending topbar_order. The order is
  // also what the chip strip displays, so the first-match-wins tie-break in
  // useSetColors() lines up with the visual order.
  return Array.from(topbarSetsRef.value.values())
    .sort((a, b) => (a.topbar_order ?? 0) - (b.topbar_order ?? 0))
    .map((s) => s.id)
}

async function load() {
  loading.value = true
  listError.value = ''
  try {
    const setIds = activeTopbarSetIds()
    let data
    if (setIds.length > 0) {
      // Multi-filterset OR-union query (#431); each entry carries
      // matched_set_ids so the table can colour-code rows by matched set.
      const body = { set_ids: setIds }
      const time = buildTimeFilter()
      if (time) body.time = time
      const resp = await ringbufferApi.queryMultiFiltersets(body)
      data = resp.data
    } else {
      // Default path — no topbar sets active, keep the single-query flow.
      const resp = await ringbufferApi.queryV2(buildQueryV2())
      data = resp.data
    }
    entries.value = data
    await nextTick()
    if (!paused.value && tableWrapRef.value) tableWrapRef.value.scrollTop = 0
  } catch (error) {
    entries.value = []
    listError.value = extractErrorMessage(error, 'Monitor-Abfrage fehlgeschlagen')
  } finally {
    loading.value = false
  }
}

async function loadStatsForConfig() {
  // On-demand /stats fetch invoked by openConfigModal — the config form
  // needs current limits/retention plus the "Belegter Speicherplatz" /
  // "Effektive Retention" read-outs in the modal.
  try {
    const { data } = await ringbufferApi.stats()
    configStats.value = data
    hydrateConfigFormFromStats(data)
  } catch {
    // Silent on failure; the modal still renders with the configForm
    // defaults and the user can save without read-back values.
  }
}

async function openConfigModal() {
  showConfig.value = true
  await loadStatsForConfig()
}

async function saveConfig() {
  configSaving.value = true
  configMsg.value = null
  try {
    const payload = buildConfigPayload()
    const { data } = await ringbufferApi.config(payload)
    configStats.value = data
    hydrateConfigFormFromStats(data)
    configMsg.value = { ok: true, text: 'Monitor-Konfiguration gespeichert' }
  } catch (error) {
    configMsg.value = { ok: false, text: extractErrorMessage(error, error?.message || 'Speichern fehlgeschlagen') }
  } finally {
    configSaving.value = false
  }
}

function qualityLabel(q) {
  return q === 'good' ? 'gut' : q === 'bad' ? 'schlecht' : q === 'uncertain' ? 'undefiniert' : q
}
</script>
