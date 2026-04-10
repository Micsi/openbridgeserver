<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Chart, LineController, LineElement, PointElement, LinearScale, Filler, Tooltip } from 'chart.js'
import { history } from '@/api/client'
import { useIcons } from '@/composables/useIcons'
import { useDatapointsStore } from '@/stores/datapoints'
import type { DataPointValue } from '@/types'

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip)

type CondFn = 'eq' | 'lt' | 'lte' | 'gt' | 'gte'
type DisplayMode = 'value' | 'history' | 'icon_only'

interface Rule {
  fn: CondFn | 'default'
  threshold: string
  icon: string
  color: string
  output_type: 'value' | 'text'
  calculation: string
  prefix: string
  text: string
  decimals: number
  postfix: string
}

const props = defineProps<{
  config: Record<string, unknown>
  datapointId: string | null
  value: DataPointValue | null
  editorMode: boolean
  w?: number
  h?: number
}>()

const dpStore = useDatapointsStore()
const { getSvg, isSvgIcon, svgIconName } = useIcons()

// ── Config ─────────────────────────────────────────────────────────────────────

const mode          = computed<DisplayMode>(() => (props.config.mode as DisplayMode | undefined) ?? 'value')
const widgetLabel   = computed(() => (props.config.label as string | undefined) ?? '')
const rules         = computed<Rule[]>(() => (props.config.rules as Rule[] | undefined) ?? [])
const historyHours  = computed(() => (props.config.history_hours as number | undefined) ?? 24)
const secondaryDpId = computed(() => (props.config.secondary_dp_id as string | undefined) ?? '')
const secLabel      = computed(() => (props.config.secondary_label as string | undefined) ?? '')
const secDecimals   = computed(() => (props.config.secondary_decimals as number | undefined) ?? 1)

// ── Rule evaluation ────────────────────────────────────────────────────────────

const rawValue = computed(() => props.value?.v ?? null)

function testRule(fn: CondFn | 'default', threshold: string, v: unknown): boolean {
  if (fn === 'default') return true
  const tNum = parseFloat(threshold)
  const vNum = typeof v === 'number' ? v : parseFloat(String(v))
  if (!isNaN(vNum) && !isNaN(tNum)) {
    switch (fn) {
      case 'eq':  return vNum === tNum
      case 'lt':  return vNum < tNum
      case 'lte': return vNum <= tNum
      case 'gt':  return vNum > tNum
      case 'gte': return vNum >= tNum
    }
  }
  return fn === 'eq' && String(v) === threshold
}

const activeRule = computed<Rule | null>(() => {
  const v = rawValue.value
  for (const r of rules.value) {
    if (r.fn === 'default') continue
    if (v !== null && testRule(r.fn, r.threshold, v)) return r
  }
  return rules.value.find(r => r.fn === 'default') ?? null
})

// ── Icon ───────────────────────────────────────────────────────────────────────

const activeIcon  = computed(() => activeRule.value?.icon ?? '')
const activeColor = computed(() => activeRule.value?.color ?? '#6b7280')
const svgContent  = ref('')

watch(
  activeIcon,
  async (icon) => {
    if (!isSvgIcon(icon)) { svgContent.value = ''; return }
    svgContent.value = await getSvg(svgIconName(icon))
  },
  { immediate: true },
)

// ── Display value ──────────────────────────────────────────────────────────────

function applyCalc(v: number, calc: string): number {
  const expr = `${v} ${calc.trim()}`
  if (!/^[\d.\s+\-*/%()e]+$/i.test(expr)) return v
  try {
    // eslint-disable-next-line no-new-func
    return Number(Function(`"use strict"; return (${expr})`)())
  } catch { return v }
}

interface DisplayParts { prefix: string; value: string; postfix: string }

const mainDisplay = computed<DisplayParts>(() => {
  if (props.editorMode) return { prefix: '', value: '—', postfix: '' }
  if (rawValue.value === null) return { prefix: '', value: '…', postfix: '' }
  const rule = activeRule.value
  if (!rule) {
    const v = rawValue.value
    if (typeof v === 'boolean') return { prefix: '', value: v ? 'EIN' : 'AUS', postfix: '' }
    if (typeof v === 'number') return { prefix: '', value: v.toFixed(1), postfix: props.value?.u ?? '' }
    return { prefix: '', value: String(v ?? '—'), postfix: '' }
  }
  if (rule.output_type === 'text') {
    return { prefix: rule.prefix, value: rule.text || '—', postfix: rule.postfix }
  }
  let v: unknown = rawValue.value
  if (typeof v === 'number' && rule.calculation) v = applyCalc(v, rule.calculation)
  const formatted = typeof v === 'number' ? (v as number).toFixed(rule.decimals ?? 1) : String(v ?? '—')
  return { prefix: rule.prefix, value: formatted, postfix: rule.postfix || (props.value?.u ?? '') }
})

// ── Secondary value ────────────────────────────────────────────────────────────

const secondaryDisplay = computed(() => {
  if (!secondaryDpId.value || props.editorMode) return ''
  const dp = dpStore.getValue(secondaryDpId.value)
  if (dp === null) return '…'
  const v = typeof dp.v === 'number' ? dp.v : parseFloat(String(dp.v))
  const formatted = isNaN(v) ? String(dp.v ?? '—') : v.toFixed(secDecimals.value)
  const unit = dp.u ?? ''
  return [secLabel.value, formatted, unit].filter(Boolean).join('\u202F')
})

// ── History chart ──────────────────────────────────────────────────────────────

const canvasEl      = ref<HTMLCanvasElement | null>(null)
const modalOpen     = ref(false)
const modalCanvasEl = ref<HTMLCanvasElement | null>(null)
let miniChart:  Chart | null = null
let modalChart: Chart | null = null
let histUnit = ''

function fmtMs(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function makeDataset(color: string) {
  return {
    data: [] as { x: number; y: number }[],
    borderColor: color,
    backgroundColor: `${color}22`,
    borderWidth: 1.5,
    pointRadius: 0,
    fill: true,
    tension: 0.3,
  }
}

async function fetchPoints() {
  if (!props.datapointId || props.editorMode) return []
  const now  = new Date()
  const from = new Date(now.getTime() - historyHours.value * 3_600_000).toISOString()
  const data = await history.query(props.datapointId, from, now.toISOString())
  histUnit = data[0]?.u ?? ''
  return data.map(d => ({ x: new Date(d.ts).getTime(), y: Number(d.v) }))
}

async function updateMiniChart() {
  if (mode.value !== 'history' || !miniChart) return
  const pts = await fetchPoints()
  miniChart.data.datasets[0].data = pts
  miniChart.update()
}

onMounted(() => {
  if (mode.value !== 'history' || !canvasEl.value) return
  miniChart = new Chart(canvasEl.value, {
    type: 'line',
    data: { datasets: [makeDataset(activeColor.value)] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { type: 'linear', ticks: { display: false }, grid: { color: '#1f293766' } },
        y: { ticks: { display: false }, grid: { color: '#1f293766' } },
      },
    },
  })
  updateMiniChart()
})

watch(() => [props.datapointId, historyHours.value], updateMiniChart)

watch(modalOpen, async (open) => {
  if (!open) { modalChart?.destroy(); modalChart = null; return }
  await new Promise<void>(r => setTimeout(r, 50))
  if (!modalCanvasEl.value) return
  const pts = await fetchPoints()
  modalChart = new Chart(modalCanvasEl.value, {
    type: 'line',
    data: { datasets: [{ ...makeDataset(activeColor.value), data: pts }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: (items: any[]) => items[0]?.parsed.x != null ? fmtMs(items[0].parsed.x) : '',
            label: (ctx: any) => histUnit ? `${ctx.parsed.y} ${histUnit}` : String(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          ticks: { color: '#6b7280', maxTicksLimit: 6, maxRotation: 0, callback: (ms: any) => fmtMs(Number(ms)) },
          grid: { color: '#1f2937' },
        },
        y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
      },
    },
  })
})

onUnmounted(() => { miniChart?.destroy(); modalChart?.destroy() })

const quality = computed(() => props.value?.q ?? null)
</script>

<template>
  <!-- ── VALUE MODE ─────────────────────────────────────────────────────────── -->
  <div v-if="mode === 'value'" class="flex flex-col h-full p-3 select-none">
    <span v-if="widgetLabel" class="text-xs text-gray-500 dark:text-gray-400 truncate mb-1">{{ widgetLabel }}</span>

    <div class="flex items-center gap-3 flex-1 min-h-0">
      <!-- Icon circle -->
      <div
        v-if="activeIcon"
        class="shrink-0 w-12 h-12 rounded-full border-2 flex items-center justify-center"
        :style="{ borderColor: activeColor }"
      >
        <span v-if="!isSvgIcon(activeIcon)" class="text-2xl leading-none select-none">{{ activeIcon }}</span>
        <span
          v-else-if="svgContent"
          class="w-6 h-6 flex items-center justify-center brightness-0 dark:invert [&>svg]:w-full [&>svg]:h-full"
          v-html="svgContent"
        />
      </div>

      <!-- Value block -->
      <div class="flex flex-col justify-center min-w-0">
        <div class="flex items-baseline gap-1 flex-wrap">
          <span v-if="mainDisplay.prefix" class="text-xs text-gray-400 dark:text-gray-500">{{ mainDisplay.prefix }}</span>
          <span
            class="text-2xl font-semibold tabular-nums leading-none"
            :style="activeRule ? { color: activeColor } : {}"
            data-testid="widget-value"
          >{{ mainDisplay.value }}</span>
          <span v-if="mainDisplay.postfix" class="text-sm text-gray-400 dark:text-gray-400">{{ mainDisplay.postfix }}</span>
        </div>
        <span v-if="secondaryDisplay" class="text-xs text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums truncate">
          {{ secondaryDisplay }}
        </span>
      </div>
    </div>

    <!-- Quality indicator -->
    <div class="flex justify-end mt-1">
      <span v-if="quality === 'bad'" class="w-2 h-2 rounded-full bg-red-500" title="Qualität: schlecht" />
      <span v-else-if="quality === 'uncertain'" class="w-2 h-2 rounded-full bg-yellow-400" title="Qualität: undefiniert" />
    </div>
  </div>

  <!-- ── HISTORY MODE ───────────────────────────────────────────────────────── -->
  <div v-else-if="mode === 'history'" class="flex flex-col h-full p-2 select-none">
    <!-- Top row: icon + label + current value -->
    <div class="flex items-center gap-2 shrink-0 mb-1">
      <div
        v-if="activeIcon"
        class="shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center"
        :style="{ borderColor: activeColor }"
      >
        <span v-if="!isSvgIcon(activeIcon)" class="text-base leading-none select-none">{{ activeIcon }}</span>
        <span
          v-else-if="svgContent"
          class="w-4 h-4 flex items-center justify-center brightness-0 dark:invert [&>svg]:w-full [&>svg]:h-full"
          v-html="svgContent"
        />
      </div>
      <span v-if="widgetLabel" class="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">{{ widgetLabel }}</span>
      <span
        class="text-sm font-semibold tabular-nums shrink-0 ml-auto"
        :style="activeRule ? { color: activeColor } : {}"
        data-testid="widget-value"
      >
        <template v-if="mainDisplay.prefix">{{ mainDisplay.prefix }}&nbsp;</template>{{ mainDisplay.value }}<template v-if="mainDisplay.postfix">&nbsp;{{ mainDisplay.postfix }}</template>
      </span>
    </div>

    <!-- Mini chart (clickable) -->
    <div
      class="flex-1 min-h-0 cursor-pointer rounded overflow-hidden"
      :title="editorMode ? '' : 'Klicken für Vollansicht'"
      @click="!editorMode && (modalOpen = true)"
    >
      <canvas v-if="!editorMode" ref="canvasEl" class="w-full h-full" />
      <div v-else class="flex items-center justify-center h-full text-gray-600 text-xs">
        Verlauf ({{ historyHours }}h)
      </div>
    </div>
  </div>

  <!-- ── ICON ONLY MODE ────────────────────────────────────────────────────── -->
  <div v-else class="flex flex-col items-center justify-center h-full p-3 select-none gap-2">
    <div
      v-if="activeIcon"
      class="rounded-full border-2 flex items-center justify-center"
      style="width: 56px; height: 56px;"
      :style="{ borderColor: activeColor }"
    >
      <span v-if="!isSvgIcon(activeIcon)" class="text-3xl leading-none select-none">{{ activeIcon }}</span>
      <span
        v-else-if="svgContent"
        class="w-8 h-8 flex items-center justify-center brightness-0 dark:invert [&>svg]:w-full [&>svg]:h-full"
        v-html="svgContent"
      />
    </div>
    <span
      v-if="widgetLabel"
      class="text-xs text-gray-500 dark:text-gray-400 text-center leading-tight"
    >{{ widgetLabel }}</span>
    <span
      class="text-sm font-medium tabular-nums"
      :style="activeRule ? { color: activeColor } : {}"
      data-testid="widget-value"
    >
      <template v-if="mainDisplay.prefix">{{ mainDisplay.prefix }}&nbsp;</template>{{ mainDisplay.value }}<template v-if="mainDisplay.postfix">&nbsp;{{ mainDisplay.postfix }}</template>
    </span>
  </div>

  <!-- ── MODAL (history) ───────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="modalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      @click.self="modalOpen = false"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-4 w-[90vw] max-w-2xl h-[60vh] flex flex-col">
        <div class="flex items-center justify-between mb-3 shrink-0">
          <div class="flex items-center gap-2">
            <div
              v-if="activeIcon"
              class="w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0"
              :style="{ borderColor: activeColor }"
            >
              <span v-if="!isSvgIcon(activeIcon)" class="text-base leading-none select-none">{{ activeIcon }}</span>
              <span
                v-else-if="svgContent"
                class="w-4 h-4 flex items-center justify-center brightness-0 dark:invert [&>svg]:w-full [&>svg]:h-full"
                v-html="svgContent"
              />
            </div>
            <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ widgetLabel || 'Verlauf' }}</span>
          </div>
          <button
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
            @click="modalOpen = false"
          >✕</button>
        </div>
        <div class="flex-1 min-h-0">
          <canvas ref="modalCanvasEl" class="w-full h-full" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
