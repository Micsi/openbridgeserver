<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-start gap-3">
      <div class="flex-1">
        <h2 class="text-xl font-bold text-slate-800 dark:text-slate-100">Monitor</h2>
        <p class="text-sm text-slate-500 mt-0.5">Live Log</p>
      </div>
      <button @click="showConfig = true" class="btn-secondary btn-sm">⚙ Konfigurieren</button>
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
    </div>

    <div v-if="stats" class="grid grid-cols-3 gap-3">
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-slate-800 dark:text-slate-100">{{ stats.total }}</div>
        <div class="text-xs text-slate-500 mt-1">Einträge</div>
      </div>
      <div class="card p-4 text-center">
        <div class="text-2xl font-bold text-slate-800 dark:text-slate-100">{{ stats.max_entries }}</div>
        <div class="text-xs text-slate-500 mt-1">Max. Kapazität</div>
      </div>
      <div class="card p-4 text-center">
        <Badge :variant="stats.storage === 'memory' ? 'info' : 'warning'" class="text-base">{{ stats.storage }}</Badge>
        <div class="text-xs text-slate-500 mt-2">Speicher</div>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-3">
        <input v-model="filters.q" type="text" class="input flex-1 min-w-40" placeholder="Suche nach Name/ID ..." @input="debouncedLoad" data-testid="input-filter" />
        <input v-model="filters.adapter" type="text" class="input w-36" placeholder="Adapter" @input="debouncedLoad" />
        <select v-model="filters.limit" class="input w-28" @change="applyFilters">
          <option value="100">100</option>
          <option value="500">500</option>
          <option value="1000">1000</option>
        </select>
      </div>
      <div class="flex flex-wrap gap-3 items-end">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Von (absolut)</label>
          <input v-model="filters.fromAbsolute" type="datetime-local" class="input w-56" data-testid="time-from-absolute" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Bis (absolut)</label>
          <input v-model="filters.toAbsolute" type="datetime-local" class="input w-56" data-testid="time-to-absolute" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Von relativ (Sek.)</label>
          <input v-model.trim="filters.fromRelativeSeconds" type="number" class="input w-44" placeholder="-60" data-testid="time-from-relative-seconds" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Bis relativ (Sek.)</label>
          <input v-model.trim="filters.toRelativeSeconds" type="number" class="input w-44" placeholder="-5" data-testid="time-to-relative-seconds" />
        </div>
        <button @click="applyFilters" class="btn-secondary btn-sm" data-testid="btn-apply-ringbuffer-filters">Filter anwenden</button>
        <button @click="clearTimeFilters" class="btn-secondary btn-sm">Zeitfilter leeren</button>
      </div>
    </div>

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
            <tr v-for="(e, i) in entries" :key="i" data-testid="ringbuffer-entry" :data-dp="e.datapoint_id">
              <td class="font-mono text-xs text-slate-400 whitespace-nowrap">{{ fmtDateTime(e.ts) }}</td>
              <td class="text-sm">
                <RouterLink :to="`/datapoints/${e.datapoint_id}`" class="text-blue-400 hover:underline font-mono text-xs">
                  {{ e.name ?? e.datapoint_id?.slice(0, 8) }}
                </RouterLink>
              </td>
              <td class="font-mono text-sm text-blue-500 dark:text-blue-300">{{ e.new_value }}</td>
              <td class="font-mono text-sm text-slate-500">{{ e.old_value ?? '-' }}</td>
              <td><Badge :variant="e.quality === 'good' ? 'success' : 'warning'" size="xs" dot>{{ qualityLabel(e.quality) }}</Badge></td>
              <td class="text-xs text-slate-500">{{ e.source_adapter ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="statsError" class="text-sm text-red-500">{{ statsError }}</div>

    <Modal v-model="showConfig" title="Monitor konfigurieren" max-width="sm">
      <form @submit.prevent="saveConfig" class="flex flex-col gap-4">
        <div class="form-group">
          <label class="label">Speicher</label>
          <select v-model="configForm.storage" class="input">
            <option value="memory">memory (RAM, kein Neustart-Persistenz)</option>
            <option value="disk">disk (SQLite, persistent)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="label">Max. Einträge</label>
          <input v-model.number="configForm.max_entries" type="number" class="input" min="100" max="1000000" step="1000" />
        </div>
        <div v-if="configMsg" :class="['p-3 rounded-lg text-sm', configMsg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400']">{{ configMsg.text }}</div>
        <div class="flex justify-end gap-3">
          <button type="button" @click="showConfig = false" class="btn-secondary">Schliessen</button>
          <button type="submit" class="btn-primary" :disabled="configSaving">
            <Spinner v-if="configSaving" size="sm" color="white" />
            Uebernehmen
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
import { useWebSocketStore } from '@/stores/websocket'
import Badge from '@/components/ui/Badge.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Modal from '@/components/ui/Modal.vue'

const LIVE_BATCH_SIZE = 200
const LIVE_FLUSH_INTERVAL_MS = 60
const LIVE_QUEUE_MAX = 5000

const { fmtDateTime } = useTz()
const wsStore = useWebSocketStore()

const entries = ref([])
const stats = ref(null)
const loading = ref(false)
const listError = ref('')
const statsError = ref('')
const showConfig = ref(false)
const configSaving = ref(false)
const configMsg = ref(null)
const tableWrapRef = ref(null)
const paused = ref(false)
const liveQueue = ref([])

const filters = reactive({
  q: '',
  adapter: '',
  limit: '500',
  fromAbsolute: '',
  toAbsolute: '',
  fromRelativeSeconds: '',
  toRelativeSeconds: '',
})
const configForm = reactive({ storage: 'memory', max_entries: 10000 })

const wsConnected = computed(() => wsStore.connected)
const queuedCount = computed(() => liveQueue.value.length)
const limitNumber = computed(() => parseInt(filters.limit, 10) || 500)

let debounceTimer = null
let unregisterRb = null
let liveFlushTimer = null

function debouncedLoad() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void applyFilters()
  }, 350)
}

function parseRelativeSeconds(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function localToIso(raw) {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function computeEffectiveBoundary(absoluteIso, relativeSeconds, pickNewer) {
  const absolute = absoluteIso ? new Date(absoluteIso) : null
  const rel = Number.isInteger(relativeSeconds) ? new Date(Date.now() + relativeSeconds * 1000) : null
  if (absolute && rel) return pickNewer ? (absolute > rel ? absolute : rel) : (absolute < rel ? absolute : rel)
  return absolute || rel
}

function matchesActiveFilter(entry) {
  const q = filters.q.trim().toLowerCase()
  if (q) {
    const inName = entry.name?.toLowerCase().includes(q)
    const inId = entry.datapoint_id?.toLowerCase().includes(q)
    const inAdapter = entry.source_adapter?.toLowerCase().includes(q)
    if (!inName && !inId && !inAdapter) return false
  }

  const adapter = filters.adapter.trim()
  if (adapter && entry.source_adapter !== adapter) return false

  const fromAbsIso = localToIso(filters.fromAbsolute)
  const toAbsIso = localToIso(filters.toAbsolute)
  const fromRel = parseRelativeSeconds(filters.fromRelativeSeconds)
  const toRel = parseRelativeSeconds(filters.toRelativeSeconds)
  const fromBoundary = computeEffectiveBoundary(fromAbsIso, fromRel, true)
  const toBoundary = computeEffectiveBoundary(toAbsIso, toRel, false)

  if (fromBoundary || toBoundary) {
    const ts = new Date(entry.ts)
    if (Number.isNaN(ts.getTime())) return false
    if (fromBoundary && !(ts > fromBoundary)) return false
    if (toBoundary && !(ts < toBoundary)) return false
  }

  return true
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
  const batch = liveQueue.value.splice(0, LIVE_BATCH_SIZE).filter(matchesActiveFilter)
  if (batch.length) {
    entries.value = [...batch.reverse(), ...entries.value].slice(0, limitNumber.value)
    await nextTick()
    if (tableWrapRef.value) tableWrapRef.value.scrollTop = 0
  }
  if (liveQueue.value.length) scheduleLiveFlush()
}

function buildTimeFilter() {
  const time = {}
  const from = localToIso(filters.fromAbsolute)
  const to = localToIso(filters.toAbsolute)
  const fromRelativeSeconds = parseRelativeSeconds(filters.fromRelativeSeconds)
  const toRelativeSeconds = parseRelativeSeconds(filters.toRelativeSeconds)
  if (from) time.from = from
  if (to) time.to = to
  if (fromRelativeSeconds !== null) time.from_relative_seconds = fromRelativeSeconds
  if (toRelativeSeconds !== null) time.to_relative_seconds = toRelativeSeconds
  return Object.keys(time).length ? time : null
}

function buildQueryV2() {
  const payload = {
    filters: {},
    sort: { field: 'ts', order: 'desc' },
    pagination: { limit: limitNumber.value, offset: 0 },
  }
  const q = filters.q.trim()
  const adapter = filters.adapter.trim()
  const time = buildTimeFilter()
  if (q) payload.filters.q = q
  if (adapter) payload.filters.adapters = { any_of: [adapter] }
  if (time) payload.filters.time = time
  return payload
}

function clearTimeFilters() {
  filters.fromAbsolute = ''
  filters.toAbsolute = ''
  filters.fromRelativeSeconds = ''
  filters.toRelativeSeconds = ''
  void applyFilters()
}

function pauseLive() {
  paused.value = true
}

function resumeLive() {
  paused.value = false
  scheduleLiveFlush()
}

function onLiveEntry(entry) {
  enqueueLive(entry)
}

function extractErrorMessage(error, fallback) {
  return error?.response?.data?.detail || error?.message || fallback
}

async function applyFilters() {
  liveQueue.value = []
  await load()
}

onMounted(async () => {
  await Promise.all([load(), loadStats()])
  if (stats.value) {
    configForm.storage = stats.value.storage
    configForm.max_entries = stats.value.max_entries
  }
  unregisterRb = wsStore.onRingbufferEntry(onLiveEntry)
})

onUnmounted(() => {
  unregisterRb?.()
  clearTimeout(debounceTimer)
  clearTimeout(liveFlushTimer)
})

async function load() {
  loading.value = true
  listError.value = ''
  try {
    const { data } = await ringbufferApi.queryV2(buildQueryV2())
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

async function loadStats() {
  statsError.value = ''
  try {
    const { data } = await ringbufferApi.stats()
    stats.value = data
  } catch (error) {
    statsError.value = extractErrorMessage(error, 'Statistiken konnten nicht geladen werden')
  }
}

function qualityLabel(q) {
  return q === 'good' ? 'gut' : q === 'bad' ? 'schlecht' : q === 'uncertain' ? 'undefiniert' : q
}

async function saveConfig() {
  configSaving.value = true
  configMsg.value = null
  try {
    await ringbufferApi.config(configForm.storage, configForm.max_entries)
    configMsg.value = { ok: true, text: 'Konfiguration uebernommen' }
    await loadStats()
  } catch (e) {
    configMsg.value = { ok: false, text: e.response?.data?.detail ?? 'Fehler' }
  } finally {
    configSaving.value = false
  }
}
</script>
