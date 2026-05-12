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
      <button @click="showConfig = true" class="btn-secondary btn-sm" data-testid="btn-open-monitor-config">⚙ Konfigurieren</button>
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

    <!-- Sticky filter topbar (#435) — drag/toggle/remove set chips, time-filter slot reserved for #432 wiring -->
    <div class="sticky top-0 z-20 -mx-5 px-5 py-2 bg-surface-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/60">
      <TopbarFilterChips
        ref="topbarChipsRef"
        data-testid="ringbuffer-topbar-chips"
        @edit-set="onEditSet"
        @new-set="onNewSet"
      />
    </div>

    <!-- Soft-modal filter editor (#436) — replaces the stub from #435 -->
    <FilterEditor
      v-model="showFilterEditor"
      :set-id="editorTargetId"
      @saved="onFilterEditorSaved"
    />

    <div class="card p-4 flex flex-col gap-3">
      <div class="flex flex-wrap gap-2 items-center">
        <select v-model="selectedFiltersetId" class="input min-w-56" @change="onFiltersetSelect" data-testid="select-filterset">
          <option value="">Ad-hoc / kein gespeichertes Set</option>
          <option v-for="fs in filtersets" :key="fs.id" :value="fs.id">
            {{ fs.is_default ? '★ ' : '' }}{{ fs.name }}
          </option>
        </select>
        <button class="btn-secondary btn-sm" data-testid="btn-filterset-new" @click="startNewFilterset">Neu</button>
        <button class="btn-secondary btn-sm" @click="loadDefaultFilterset">Default laden</button>
        <button class="btn-secondary btn-sm" data-testid="btn-filterset-save" @click="saveFilterset">Speichern</button>
        <button class="btn-secondary btn-sm" data-testid="btn-filterset-apply" @click="applySelectedFilterset" :disabled="!filtersetDraft.id">Set anwenden</button>
        <button class="btn-secondary btn-sm" @click="cloneFilterset" :disabled="!filtersetDraft.id">Duplizieren</button>
        <button class="btn-secondary btn-sm" @click="setDefaultFilterset" :disabled="!filtersetDraft.id">Als Default</button>
        <button class="btn-secondary btn-sm" @click="deleteFilterset" :disabled="!filtersetDraft.id">Löschen</button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Set-Name</label>
          <input v-model="filtersetDraft.name" class="input" data-testid="input-filterset-name" placeholder="Mein Debug-Set" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Beschreibung</label>
          <input v-model="filtersetDraft.description" class="input" placeholder="Optionale Beschreibung" />
        </div>
      </div>

      <div class="flex items-center gap-4 text-sm">
        <label class="inline-flex items-center gap-2">
          <input type="checkbox" v-model="filtersetDraft.is_active" data-testid="filterset-active-checkbox" />
          Set aktiv
        </label>
        <label class="inline-flex items-center gap-2">
          <input type="checkbox" v-model="filtersetDraft.is_default" />
          Als Default markieren
        </label>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Basis-Query: Suche</label>
          <input v-model="filtersetDraft.baseQ" class="input" placeholder="Name/ID/Adapter" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Basis-Query: DataPoint IDs (CSV)</label>
          <input v-model="filtersetDraft.baseDatapointsText" class="input" data-testid="base-datapoints-input" placeholder="uuid1,uuid2" />
        </div>
      </div>

      <div class="flex items-center justify-between">
        <p class="text-xs text-slate-500">Gruppen werden per AND kombiniert; Listenfilter (z. B. Adapter) innerhalb einer Regel per OR.</p>
        <button class="btn-secondary btn-sm" data-testid="btn-filterset-add-group" @click="addGroup">+ Gruppe</button>
      </div>

      <div v-for="(group, gi) in filtersetDraft.groups" :key="group.localId" class="rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex flex-col gap-3" data-testid="filterset-group-card">
        <div class="flex flex-wrap gap-2 items-center">
          <input v-model="group.name" class="input flex-1 min-w-40" placeholder="Gruppenname" />
          <label class="inline-flex items-center gap-1 text-sm">
            <input type="checkbox" v-model="group.is_active" /> aktiv
          </label>
          <button class="btn-secondary btn-sm" @click="removeGroup(gi)" :disabled="filtersetDraft.groups.length <= 1">Entfernen</button>
          <button class="btn-secondary btn-sm" @click="addRule(gi)">+ Regel</button>
        </div>

        <div v-for="(rule, ri) in group.rules" :key="rule.localId" class="rounded-lg border border-slate-100 dark:border-slate-800 p-3 flex flex-col gap-2">
          <div class="flex flex-wrap gap-2 items-center">
            <input v-model="rule.name" class="input flex-1 min-w-40" placeholder="Regelname" />
            <label class="inline-flex items-center gap-1 text-sm">
              <input type="checkbox" v-model="rule.is_active" :data-testid="`rule-active-checkbox-${gi}-${ri}`" /> aktiv
            </label>
            <button class="btn-secondary btn-sm" :data-testid="`btn-open-prefilter-assistant-${gi}-${ri}`" @click="openPrefilterAssistant(gi, ri)">Vorfilter…</button>
            <button class="btn-secondary btn-sm" @click="removeRule(gi, ri)" :disabled="group.rules.length <= 1">Entfernen</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-slate-500">Adapter (CSV, OR)</label>
              <input v-model="rule.adaptersText" class="input" :data-testid="`rule-adapters-input-${gi}-${ri}`" placeholder="api,knx" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-slate-500">DataPoint IDs (CSV)</label>
              <input v-model="rule.datapointsText" class="input" :data-testid="`rule-datapoints-input-${gi}-${ri}`" placeholder="uuid1,uuid2" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-slate-500">Tags (CSV)</label>
              <input v-model="rule.tagsText" class="input" :data-testid="`rule-tags-input-${gi}-${ri}`" placeholder="heizung,licht" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-slate-500">Regel-Suche (q)</label>
              <input v-model="rule.q" class="input" placeholder="optionale Volltextsuche" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div class="flex flex-col gap-1 md:col-span-1">
              <label class="text-xs text-slate-500">Datentyp</label>
              <select v-model="rule.valueDataType" class="input">
                <option value="number">Nummer</option>
                <option value="string">String</option>
                <option value="bool">Bool</option>
              </select>
            </div>
            <div class="flex flex-col gap-1 md:col-span-1">
              <label class="text-xs text-slate-500">Operator</label>
              <select v-model="rule.valueOperator" class="input" :data-testid="`rule-operator-select-${gi}-${ri}`">
                <option value="">(kein Wertfilter)</option>
                <option v-for="op in operatorsFor(rule.valueDataType)" :key="op" :value="op">{{ op }}</option>
              </select>
            </div>
            <div class="flex flex-col gap-1 md:col-span-1" v-if="rule.valueOperator === 'between'">
              <label class="text-xs text-slate-500">Untergrenze</label>
              <input v-model="rule.valueLower" class="input" placeholder="0" />
            </div>
            <div class="flex flex-col gap-1 md:col-span-1" v-if="rule.valueOperator === 'between'">
              <label class="text-xs text-slate-500">Obergrenze</label>
              <input v-model="rule.valueUpper" class="input" placeholder="100" />
            </div>
            <div class="flex flex-col gap-1" :class="rule.valueOperator === 'between' ? 'md:col-span-2' : 'md:col-span-3'" v-else-if="rule.valueOperator === 'regex'">
              <label class="text-xs text-slate-500">Regex</label>
              <input v-model="rule.valuePattern" class="input" placeholder="^temp" />
            </div>
            <div class="flex flex-col gap-1" :class="rule.valueOperator === 'between' ? 'md:col-span-2' : 'md:col-span-3'" v-else>
              <label class="text-xs text-slate-500">Wert</label>
              <input v-model="rule.valueInput" class="input" :data-testid="`rule-value-input-${gi}-${ri}`" placeholder="42" :disabled="!rule.valueOperator" />
            </div>
          </div>

          <label v-if="rule.valueOperator === 'regex'" class="inline-flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" v-model="rule.valueIgnoreCase" />
            Regex ignore case
          </label>
        </div>
      </div>

      <p v-if="filtersetMsg" :class="filtersetMsg.ok ? 'text-emerald-500 text-sm' : 'text-red-500 text-sm'">{{ filtersetMsg.text }}</p>
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
              <td class="font-mono text-sm text-blue-500 dark:text-blue-300">{{ e.new_value }}<span v-if="e.unit" class="text-slate-500 ml-1 text-xs">{{ e.unit }}</span></td>
              <td class="font-mono text-sm text-slate-500">{{ e.old_value ?? '-' }}<span v-if="e.unit && e.old_value !== null && e.old_value !== undefined" class="text-slate-500 ml-1 text-xs">{{ e.unit }}</span></td>
              <td><Badge :variant="e.quality === 'good' ? 'success' : 'warning'" size="xs" dot>{{ qualityLabel(e.quality) }}</Badge></td>
              <td class="text-xs text-slate-500">{{ e.source_adapter ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="statsError" class="text-sm text-red-500">{{ statsError }}</div>

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
            <span class="font-medium text-slate-700 dark:text-slate-200" data-testid="rb-config-stats-total">{{ stats?.total ?? '-' }}</span>
          </div>
          <div class="text-xs text-slate-500 flex items-center justify-between">
            <span>Belegter Speicherplatz</span>
            <span class="font-medium text-slate-700 dark:text-slate-200" data-testid="rb-config-stats-file-size">{{ formatBytes(stats?.file_size_bytes ?? 0) }}</span>
          </div>
          <div class="text-xs text-slate-500 flex items-center justify-between">
            <span>Effektive Retention</span>
            <span class="font-medium text-slate-700 dark:text-slate-200" data-testid="rb-config-stats-retention">{{ formatRetention(stats?.max_age ?? null) }}</span>
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

    <Modal v-model="showPrefilterAssistant" title="Vorfilter-Assistent (#355)" max-width="md">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-500">Tags (CSV)</label>
          <input v-model="prefilter.tagsText" class="input" data-testid="prefilter-tags-input" placeholder="heizung,licht" />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-500">Hierarchiebaum</label>
            <select v-model="prefilter.treeId" class="input" @change="onPrefilterTreeChange">
              <option value="">(optional)</option>
              <option v-for="tree in prefilterTrees" :key="tree.id" :value="tree.id">{{ tree.name }}</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-500">Knoten</label>
            <select v-model="prefilter.nodeId" class="input" data-testid="prefilter-node-select">
              <option value="">(optional)</option>
              <option v-for="node in prefilterNodes" :key="node.id" :value="node.id">{{ node.path }}</option>
            </select>
          </div>
        </div>
        <p v-if="prefilterMsg" :class="prefilterMsg.ok ? 'text-emerald-500 text-sm' : 'text-red-500 text-sm'">{{ prefilterMsg.text }}</p>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="showPrefilterAssistant = false">Abbrechen</button>
          <button class="btn-primary" :disabled="prefilterBusy" data-testid="btn-apply-prefilter-suggestion" @click="applyPrefilterSuggestion">
            Vorschlag übernehmen
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ringbufferApi, searchApi, hierarchyApi } from '@/api/client'
import { useTz } from '@/composables/useTz'
import { useWebSocketStore } from '@/stores/websocket'
import Badge from '@/components/ui/Badge.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Modal from '@/components/ui/Modal.vue'
import TopbarFilterChips from '@/views/ringbuffer/TopbarFilterChips.vue'
import TopbarStats from '@/views/ringbuffer/TopbarStats.vue'
import FilterEditor from '@/views/ringbuffer/FilterEditor.vue'

const LIVE_BATCH_SIZE = 200
const LIVE_FLUSH_INTERVAL_MS = 60
const LIVE_QUEUE_MAX = 5000

const OPERATOR_OPTIONS = {
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'],
  string: ['eq', 'ne', 'contains', 'regex'],
  bool: ['eq', 'ne'],
}
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

const entries = ref([])
const stats = ref(null)
const loading = ref(false)
const listError = ref('')
const statsError = ref('')
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
const configSaving = ref(false)
const configMsg = ref(null)
const tableWrapRef = ref(null)
const paused = ref(false)
const liveQueue = ref([])

const filtersets = ref([])
const selectedFiltersetId = ref('')
const filtersetMsg = ref(null)
const activeFiltersetId = ref('')

const showPrefilterAssistant = ref(false)
const prefilterBusy = ref(false)
const prefilterMsg = ref(null)
const prefilterTrees = ref([])
const prefilterNodes = ref([])
const prefilterTarget = ref({ groupIndex: 0, ruleIndex: 0 })
const prefilter = reactive({
  tagsText: '',
  treeId: '',
  nodeId: '',
})

const filters = reactive({
  q: '',
  adapter: '',
  limit: '500',
  fromAbsolute: '',
  toAbsolute: '',
  fromRelativeSeconds: '',
  toRelativeSeconds: '',
})
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

const filtersetDraft = ref(newFiltersetDraft())

const wsConnected = computed(() => wsStore.connected)
const queuedCount = computed(() => liveQueue.value.length)
const limitNumber = computed(() => parseInt(filters.limit, 10) || 500)

let debounceTimer = null
let unregisterRb = null
let liveFlushTimer = null

function makeLocalId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

function splitCsv(raw) {
  return String(raw ?? '').split(',').map((v) => v.trim()).filter(Boolean)
}

function joinCsv(values) {
  return (values || []).map((v) => String(v).trim()).filter(Boolean).join(',')
}

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

function makeRuleDraft(name = 'Regel') {
  return {
    localId: makeLocalId(),
    id: null,
    name,
    is_active: true,
    q: '',
    adaptersText: '',
    datapointsText: '',
    tagsText: '',
    valueDataType: 'number',
    valueOperator: '',
    valueInput: '',
    valueLower: '',
    valueUpper: '',
    valuePattern: '',
    valueIgnoreCase: false,
  }
}

function makeGroupDraft(name = 'Gruppe') {
  return {
    localId: makeLocalId(),
    id: null,
    name,
    is_active: true,
    rules: [makeRuleDraft('Regel 1')],
  }
}

function newFiltersetDraft() {
  return {
    id: null,
    name: '',
    description: '',
    is_active: true,
    is_default: false,
    baseQ: '',
    baseDatapointsText: '',
    groups: [makeGroupDraft('Gruppe 1')],
  }
}

function operatorsFor(dataType) {
  return OPERATOR_OPTIONS[dataType] || OPERATOR_OPTIONS.number
}

function queryToDraftRule(query, idx) {
  const rule = makeRuleDraft(`Regel ${idx + 1}`)
  const filtersPart = query?.filters || {}
  rule.q = filtersPart.q || ''
  rule.adaptersText = joinCsv(filtersPart.adapters?.any_of || [])
  rule.datapointsText = joinCsv(filtersPart.datapoints?.ids || [])
  rule.tagsText = joinCsv(filtersPart.metadata?.tags_any_of || [])

  const valueFilter = (filtersPart.values || [])[0]
  if (valueFilter?.operator) {
    rule.valueOperator = valueFilter.operator
    if (['gt', 'gte', 'lt', 'lte', 'eq', 'ne'].includes(valueFilter.operator)) {
      rule.valueInput = String(valueFilter.value ?? '')
    } else if (valueFilter.operator === 'between') {
      rule.valueLower = String(valueFilter.lower ?? '')
      rule.valueUpper = String(valueFilter.upper ?? '')
    } else if (valueFilter.operator === 'regex') {
      rule.valuePattern = String(valueFilter.pattern ?? '')
      rule.valueIgnoreCase = Boolean(valueFilter.ignore_case)
    } else if (valueFilter.operator === 'contains') {
      rule.valueInput = String(valueFilter.value ?? '')
    }

    const rawValue = valueFilter.value
    if (typeof rawValue === 'boolean') rule.valueDataType = 'bool'
    else if (typeof rawValue === 'number' || valueFilter.operator === 'between') rule.valueDataType = 'number'
    else rule.valueDataType = 'string'
  }

  return rule
}

function hydrateFiltersetDraft(filterset) {
  const groups = (filterset.groups || []).map((group, gi) => ({
    localId: makeLocalId(),
    id: group.id,
    name: group.name,
    is_active: Boolean(group.is_active),
    rules: (group.rules || []).map((rule, ri) => {
      const draftRule = queryToDraftRule(rule.query, ri)
      draftRule.id = rule.id
      draftRule.name = rule.name
      draftRule.is_active = Boolean(rule.is_active)
      return draftRule
    }),
  }))

  filtersetDraft.value = {
    id: filterset.id,
    name: filterset.name,
    description: filterset.description || '',
    is_active: Boolean(filterset.is_active),
    is_default: Boolean(filterset.is_default),
    baseQ: filterset.query?.filters?.q || '',
    baseDatapointsText: joinCsv(filterset.query?.filters?.datapoints?.ids || []),
    groups: groups.length ? groups : [makeGroupDraft('Gruppe 1')],
  }
}

function buildRuleQuery(rule) {
  const filtersPart = {}

  const q = String(rule.q || '').trim()
  if (q) filtersPart.q = q

  const adapters = splitCsv(rule.adaptersText)
  if (adapters.length) filtersPart.adapters = { any_of: adapters }

  const datapoints = splitCsv(rule.datapointsText)
  if (datapoints.length) filtersPart.datapoints = { ids: datapoints }

  const tags = splitCsv(rule.tagsText)
  if (tags.length) filtersPart.metadata = { tags_any_of: tags }

  if (rule.valueOperator) {
    if (rule.valueOperator === 'between') {
      const lower = parseLiteral(rule.valueLower, rule.valueDataType)
      const upper = parseLiteral(rule.valueUpper, rule.valueDataType)
      if (lower !== null || upper !== null) {
        filtersPart.values = [{ operator: 'between', lower, upper }]
      }
    } else if (rule.valueOperator === 'regex') {
      const pattern = String(rule.valuePattern || '').trim()
      if (pattern) {
        filtersPart.values = [{ operator: 'regex', pattern, ignore_case: Boolean(rule.valueIgnoreCase) }]
      }
    } else {
      const value = parseLiteral(rule.valueInput, rule.valueDataType)
      if (value !== null) {
        filtersPart.values = [{ operator: rule.valueOperator, value }]
      }
    }
  }

  return {
    filters: filtersPart,
    sort: { field: 'ts', order: 'desc' },
    pagination: { limit: limitNumber.value, offset: 0 },
  }
}

function buildBaseQuery(draft) {
  const filtersPart = {}
  const q = String(draft.baseQ || '').trim()
  if (q) filtersPart.q = q
  const datapoints = splitCsv(draft.baseDatapointsText)
  if (datapoints.length) filtersPart.datapoints = { ids: datapoints }

  return {
    filters: filtersPart,
    sort: { field: 'ts', order: 'desc' },
    pagination: { limit: limitNumber.value, offset: 0 },
  }
}

function buildFiltersetPayload(draft) {
  return {
    name: draft.name.trim(),
    description: draft.description || '',
    dsl_version: 2,
    is_active: Boolean(draft.is_active),
    is_default: Boolean(draft.is_default),
    query: buildBaseQuery(draft),
    groups: draft.groups.map((group, gi) => ({
      name: group.name?.trim() || `Gruppe ${gi + 1}`,
      is_active: Boolean(group.is_active),
      group_order: gi,
      rules: group.rules.map((rule, ri) => ({
        name: rule.name?.trim() || `Regel ${ri + 1}`,
        is_active: Boolean(rule.is_active),
        rule_order: ri,
        query: buildRuleQuery(rule),
      })),
    })),
  }
}

function extractErrorMessage(error, fallback) {
  return error?.response?.data?.detail || error?.message || fallback
}

async function loadFiltersets() {
  try {
    const { data } = await ringbufferApi.listFiltersets()
    filtersets.value = Array.isArray(data) ? data : []
  } catch (error) {
    filtersets.value = []
    filtersetMsg.value = { ok: false, text: extractErrorMessage(error, 'Filtersets konnten nicht geladen werden') }
  }
}

function startNewFilterset() {
  selectedFiltersetId.value = ''
  filtersetDraft.value = newFiltersetDraft()
  filtersetMsg.value = null
}

function onFiltersetSelect() {
  const current = filtersets.value.find((fs) => fs.id === selectedFiltersetId.value)
  if (!current) {
    startNewFilterset()
    return
  }
  hydrateFiltersetDraft(current)
  filtersetMsg.value = null
}

async function loadDefaultFilterset() {
  filtersetMsg.value = null
  try {
    const { data } = await ringbufferApi.getDefaultFilterset()
    selectedFiltersetId.value = data.id
    hydrateFiltersetDraft(data)
  } catch (error) {
    filtersetMsg.value = { ok: false, text: extractErrorMessage(error, 'Kein Default-Set gefunden') }
  }
}

async function saveFilterset() {
  filtersetMsg.value = null

  if (!filtersetDraft.value.name.trim()) {
    filtersetMsg.value = { ok: false, text: 'Set-Name ist erforderlich' }
    return
  }

  const payload = buildFiltersetPayload(filtersetDraft.value)

  try {
    let saved
    if (filtersetDraft.value.id) {
      const { data } = await ringbufferApi.updateFilterset(filtersetDraft.value.id, payload)
      saved = data
    } else {
      const { data } = await ringbufferApi.createFilterset(payload)
      saved = data
    }

    await loadFiltersets()
    selectedFiltersetId.value = saved.id
    hydrateFiltersetDraft(saved)
    filtersetMsg.value = { ok: true, text: 'Filterset gespeichert' }
  } catch (error) {
    filtersetMsg.value = { ok: false, text: extractErrorMessage(error, 'Speichern fehlgeschlagen') }
  }
}

async function cloneFilterset() {
  filtersetMsg.value = null
  if (!filtersetDraft.value.id) return
  try {
    const cloneName = `${filtersetDraft.value.name || 'Filterset'} (Copy)`
    const { data } = await ringbufferApi.cloneFilterset(filtersetDraft.value.id, cloneName)
    await loadFiltersets()
    selectedFiltersetId.value = data.id
    hydrateFiltersetDraft(data)
    filtersetMsg.value = { ok: true, text: 'Filterset dupliziert' }
  } catch (error) {
    filtersetMsg.value = { ok: false, text: extractErrorMessage(error, 'Duplizieren fehlgeschlagen') }
  }
}

async function setDefaultFilterset() {
  filtersetMsg.value = null
  if (!filtersetDraft.value.id) return
  try {
    const { data } = await ringbufferApi.setDefaultFilterset(filtersetDraft.value.id)
    await loadFiltersets()
    selectedFiltersetId.value = data.id
    hydrateFiltersetDraft(data)
    filtersetMsg.value = { ok: true, text: 'Default gesetzt' }
  } catch (error) {
    filtersetMsg.value = { ok: false, text: extractErrorMessage(error, 'Default setzen fehlgeschlagen') }
  }
}

async function deleteFilterset() {
  filtersetMsg.value = null
  if (!filtersetDraft.value.id) return
  try {
    await ringbufferApi.deleteFilterset(filtersetDraft.value.id)
    await loadFiltersets()
    startNewFilterset()
    filtersetMsg.value = { ok: true, text: 'Filterset gelöscht' }
  } catch (error) {
    filtersetMsg.value = { ok: false, text: extractErrorMessage(error, 'Löschen fehlgeschlagen') }
  }
}

async function applySelectedFilterset() {
  filtersetMsg.value = null
  if (!filtersetDraft.value.id) {
    activeFiltersetId.value = ''
    await applyFilters()
    return
  }
  activeFiltersetId.value = filtersetDraft.value.id
  loading.value = true
  listError.value = ''
  liveQueue.value = []
  try {
    const { data } = await ringbufferApi.queryFilterset(filtersetDraft.value.id)
    entries.value = data
    await nextTick()
    if (!paused.value && tableWrapRef.value) tableWrapRef.value.scrollTop = 0
  } catch (error) {
    entries.value = []
    listError.value = extractErrorMessage(error, 'Filterset-Abfrage fehlgeschlagen')
  } finally {
    loading.value = false
  }
}

function addGroup() {
  filtersetDraft.value.groups.push(makeGroupDraft(`Gruppe ${filtersetDraft.value.groups.length + 1}`))
}

function removeGroup(groupIndex) {
  if (filtersetDraft.value.groups.length <= 1) return
  filtersetDraft.value.groups.splice(groupIndex, 1)
}

function addRule(groupIndex) {
  const group = filtersetDraft.value.groups[groupIndex]
  group.rules.push(makeRuleDraft(`Regel ${group.rules.length + 1}`))
}

function removeRule(groupIndex, ruleIndex) {
  const group = filtersetDraft.value.groups[groupIndex]
  if (group.rules.length <= 1) return
  group.rules.splice(ruleIndex, 1)
}

function flattenNodes(nodes, prefix = '') {
  const out = []
  for (const node of nodes || []) {
    const current = prefix ? `${prefix} / ${node.name}` : node.name
    out.push({ id: node.id, path: current })
    out.push(...flattenNodes(node.children || [], current))
  }
  return out
}

async function loadAllPrefilterNodes() {
  const all = []
  for (const tree of prefilterTrees.value) {
    try {
      const { data } = await hierarchyApi.getTreeNodes(tree.id)
      const flattened = flattenNodes(data, tree.name)
      all.push(...flattened)
    } catch {
      // ignore single-tree errors and continue with remaining trees
    }
  }
  prefilterNodes.value = all
}

async function openPrefilterAssistant(groupIndex, ruleIndex) {
  prefilterTarget.value = { groupIndex, ruleIndex }
  prefilterMsg.value = null
  prefilter.tagsText = filtersetDraft.value.groups[groupIndex].rules[ruleIndex].tagsText || ''
  prefilter.treeId = ''
  prefilter.nodeId = ''
  prefilterNodes.value = []

  if (!prefilterTrees.value.length) {
    try {
      const { data } = await hierarchyApi.listTrees()
      prefilterTrees.value = Array.isArray(data) ? data : []
    } catch {
      prefilterTrees.value = []
    }
  }
  await loadAllPrefilterNodes()

  showPrefilterAssistant.value = true
}

async function onPrefilterTreeChange() {
  prefilter.nodeId = ''
  prefilterNodes.value = []
  if (!prefilter.treeId) return
  try {
    const { data } = await hierarchyApi.getTreeNodes(prefilter.treeId)
    prefilterNodes.value = flattenNodes(data)
  } catch {
    prefilterNodes.value = []
  }
}

async function applyPrefilterSuggestion() {
  prefilterMsg.value = null
  prefilterBusy.value = true

  try {
    const params = { page: 0, size: 500, sort: 'name', order: 'asc' }
    const tags = splitCsv(prefilter.tagsText)
    if (tags.length) params.tag = tags.join(',')
    if (prefilter.nodeId) params.node_id = prefilter.nodeId

    const { data } = await searchApi.search(params)
    const items = Array.isArray(data?.items) ? data.items : []
    const ids = Array.from(new Set(items.map((item) => item.id)))

    const group = filtersetDraft.value.groups[prefilterTarget.value.groupIndex]
    const rule = group?.rules?.[prefilterTarget.value.ruleIndex]
    if (!rule) {
      throw new Error('Zielregel nicht gefunden')
    }

    const merged = Array.from(new Set([...splitCsv(rule.datapointsText), ...ids]))
    rule.datapointsText = joinCsv(merged)

    const mergedTags = Array.from(new Set([...splitCsv(rule.tagsText), ...tags]))
    rule.tagsText = joinCsv(mergedTags)

    showPrefilterAssistant.value = false
    prefilterMsg.value = null
  } catch (error) {
    prefilterMsg.value = { ok: false, text: extractErrorMessage(error, 'Vorschlag konnte nicht erzeugt werden') }
  } finally {
    prefilterBusy.value = false
  }
}

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
  if (activeFiltersetId.value) {
    // Keep an applied filterset result stable. Live pushes can be fetched
    // intentionally via "Set anwenden" or "Aktualisieren".
    return
  }
  enqueueLive(entry)
}

async function applyFilters() {
  activeFiltersetId.value = ''
  liveQueue.value = []
  await load()
}

onMounted(async () => {
  await Promise.all([load(), loadStats(), loadFiltersets()])
  if (stats.value) {
    hydrateConfigFormFromStats(stats.value)
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
    hydrateConfigFormFromStats(data)
  } catch (error) {
    statsError.value = extractErrorMessage(error, 'Statistiken konnten nicht geladen werden')
  }
}

async function saveConfig() {
  configSaving.value = true
  configMsg.value = null
  try {
    const payload = buildConfigPayload()
    const { data } = await ringbufferApi.config(payload)
    stats.value = data
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
