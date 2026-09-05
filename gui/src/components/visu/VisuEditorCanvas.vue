<script setup>
/**
 * Der WYSIWYG-Canvas des V2-Editors (M5 C2, Issue #169).
 *
 * BEIDE PARADIGMEN, je Seite waehlbar - das ist die Owner-Vorgabe, und die
 * Design-Invariante aus CONTRIBUTING-visu-m5.md §1.1 steht genau dafuer:
 * Pixel-Autorenschaft ist ein ANGEBOT, kein Zwang.
 *
 *  - **Pixel-Modus** (E1/E4/E8): Elemente liegen auf Koordinaten, das Ziehen
 *    rastet an einer einstellbaren Rasterweite ein, Ausrichtlinien erscheinen
 *    bei Kantendeckung, „Verteilen" und „Gleiche Groesse" raeumen auf, die
 *    Z-Ordnung ist die Reihenfolge der Widget-Liste, und ein Element laesst sich
 *    sperren oder ausblenden.
 *  - **Responsiver Modus** (E2/E17): dieselbe Seite ohne jede Koordinate. Nur
 *    die REIHENFOLGE zaehlt, sie wird per Drag gesetzt und sofort gespeichert;
 *    Koordinatenfelder gibt es dann gar nicht. Die Breakpoints stehen in den
 *    Seiteneigenschaften.
 *
 * WANN GESPEICHERT WIRD - und warum unterschiedlich:
 *  - Im RESPONSIVEN Modus sichert das Fallenlassen sofort. Die Reihenfolge ist
 *    der Boden des Modells (§2.1), sie hat kein zweites Zuhause, und der
 *    belegte Champion dieser Zeile (Home Assistant, §1.1 E2) speichert eine
 *    umsortierte Karte ebenfalls beim Loslassen. E2 verlangt genau das: das
 *    Order-Array ist vor und nach einem Neuladen identisch, ohne dass jemand
 *    „Speichern" gedrueckt haette.
 *  - Im PIXEL-Modus ist das Verschieben Teil einer Bearbeitung und wird mit
 *    „Speichern" uebernommen - so wie bei den Champions dieser Zeilen (Grafana,
 *    ioBroker vis-2, §1.1 E1/E4/E8). Jeder Zug einzeln auf den Server zu
 *    schreiben waere nicht nur geschwaetzig, es naehme dem spaeteren Undo-Stapel
 *    (Teil C5, E7) den Boden.
 *  - Die SEITENEIGENSCHAFTEN (Modus, Rasterweite, Breakpoints) gehoeren
 *    ebenfalls dem „Speichern": ein Blick in den anderen Modus soll die Seite
 *    nicht umschreiben.
 *
 * WAS DIESER CANVAS NICHT IST: ein Renderer. Gezeichnet wird hier nur das
 * Autoren-Gitter (Kasten, Name, Anfasser); wie die Seite AUSSIEHT, zeigt
 * ausschliesslich die Vorschau aus Teil C4 - dieselbe Visu, derselbe SkinHost
 * (Messlatte E3). Der Canvas liefert dafuer den Entwurf ueber `draft` nach oben.
 *
 * EINHEITEN: eine Autoreneinheit ist ein CSS-Pixel (Edomi-Semantik; der Vertrag
 * nennt die Zahlen in `WidgetPosition` ausdruecklich opak). Ein Element wird
 * also so gross gezeichnet, wie es im Modell steht - auch wenn das klein ist.
 *
 * DIE MARKE `.editor-guide` ist die AusrichtEBENE, nicht die einzelne Linie: der
 * Harness spricht sie mit einer strikten Erwartung an (`toBeVisible()`), und die
 * verlangt genau ein Element. Die einzelnen Linien darin tragen
 * `.editor-guide-line`.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { visuApi } from '@/api/visu'
import {
  DEFAULT_GRID,
  GUIDE_TOLERANCE,
  bringToFront,
  distributeHorizontally,
  guidesFor,
  matchSize,
  moveItem,
  sendToBack,
  snapBox,
} from '@/utils/visuEditorLayout'
import {
  LAYOUT_MODES,
  LAYOUT_PIXEL,
  LAYOUT_RESPONSIVE,
  formatBreakpoints,
  parseBreakpoints,
  readPageSettings,
  skinForMode,
  toPreviewDraft,
  widgetFlags,
  withWidgetFlags,
  writePageSettings,
} from '@/utils/visuEditorPage'

const props = defineProps({
  /** Die Seite, die bearbeitet wird. Ohne sie gibt es keinen Canvas. */
  pageId: { type: String, default: null },
})
const emit = defineEmits(['draft', 'preview-width'])

/** Die Widget-Liste IST das Modell: ihre Reihenfolge ist Z-Ordnung und Fluss. */
const widgets = ref([])
/** Der Rest der `PageConfig` (grid_cols, includes, popup ...) - unveraendert durchgereicht. */
const base = ref(null)
const nodeName = ref('')
const nodeKind = ref('normal')
/** Die Seiteneigenschaften, wie der Autor sie gerade eingestellt hat. */
const settings = reactive({ mode: LAYOUT_PIXEL, grid: DEFAULT_GRID })
/**
 * Dieselben Eigenschaften, wie sie GESPEICHERT sind.
 *
 * Der Unterschied ist Absicht: eine Struktur-Aenderung am Canvas (Reihenfolge,
 * Lage, Z-Ordnung, Marken) wird sofort gesichert - sie muss ein Neuladen
 * ueberleben (E2). Die SEITENEIGENSCHAFTEN (Modus, Rasterweite, Breakpoints)
 * gehoeren dagegen dem „Speichern": ein Blick in den anderen Modus soll die
 * Seite nicht umschreiben. Ohne diese Trennung wuerde jede Ansichts-Entscheidung
 * heimlich mitgespeichert, und eine Seite haette nach einem Ausprobieren einen
 * anderen Modus, als der Autor je gewaehlt hat.
 */
const storedSettings = reactive({ mode: LAYOUT_PIXEL, grid: DEFAULT_GRID, breakpoints: [] })
const breakpointText = ref('')
const previewWidth = ref('')
const selectedIds = ref([])
const guides = ref([])
const loaded = ref(false)
const errorKey = ref(null)
const saved = ref(false)

const isPixel = computed(() => settings.mode !== LAYOUT_RESPONSIVE)
const breakpointList = computed(() => parseBreakpoints(breakpointText.value))
const selected = computed(() => widgets.value.find((w) => w.id === selectedIds.value[0]) ?? null)
const selectedFlags = computed(() => widgetFlags(selected.value))
const activeSkin = computed(() => skinForMode(settings.mode))

/** Die eingestellten (noch nicht zwingend gespeicherten) Seiteneigenschaften. */
function pendingSettings() {
  return { mode: settings.mode, grid: settings.grid, breakpoints: breakpointList.value }
}

/** Die Seite mit einem bestimmten Satz Seiteneigenschaften. */
function configWith(pageSettings) {
  return writePageSettings({ ...(base.value || {}), widgets: widgets.value }, pageSettings)
}

/** Was die VORSCHAU zeigt: immer der eingestellte Stand, nie der gespeicherte. */
function currentConfig() {
  return configWith(pendingSettings())
}

/* ------------------------------------------------------------------ laden */

async function load() {
  if (!props.pageId) return
  errorKey.value = null
  try {
    const [node, page] = await Promise.all([
      visuApi.getNode(props.pageId),
      visuApi.getPage(props.pageId),
    ])
    nodeName.value = node?.data?.name ?? ''
    nodeKind.value = node?.data?.kind ?? 'normal'
    const config = page?.data ?? {}
    base.value = config
    widgets.value = (config.widgets ?? []).map((w) => ({ ...w }))
    const stored = readPageSettings(config)
    settings.mode = stored.mode
    settings.grid = stored.grid
    Object.assign(storedSettings, stored)
    breakpointText.value = formatBreakpoints(stored.breakpoints)
    selectedIds.value = []
    loaded.value = true
  } catch {
    errorKey.value = 'load'
  }
}

/* --------------------------------------------------------------- speichern */

/**
 * Speichern.
 *
 * `withSettings` unterscheidet die beiden Anlaesse: die Schaltflaeche
 * „Speichern" uebernimmt AUCH die Seiteneigenschaften, jede Struktur-Aenderung
 * am Canvas nur die Widgets - und laesst Modus, Rasterweite und Breakpoints so,
 * wie sie gespeichert sind.
 */
async function persist(withSettings = false) {
  if (!props.pageId) return
  const pageSettings = withSettings ? pendingSettings() : { ...storedSettings }
  saved.value = false
  try {
    await visuApi.savePage(props.pageId, configWith(pageSettings))
    if (withSettings) Object.assign(storedSettings, pageSettings)
    errorKey.value = null
    saved.value = true
  } catch {
    saved.value = false
    errorKey.value = 'save'
  }
}

/* ---------------------------------------------------------------- auswahl */

function isSelected(id) {
  return selectedIds.value.includes(id)
}

function select(id, additive = false) {
  if (additive) {
    selectedIds.value = isSelected(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id]
    return
  }
  selectedIds.value = [id]
}

/** Die Auswahl in der Reihenfolge der Seite - „zuerst gewaehlt" ist reproduzierbar. */
const selectionInPageOrder = computed(() =>
  widgets.value.filter((w) => selectedIds.value.includes(w.id)).map((w) => w.id),
)

/* ------------------------------------------------------------------ aendern */

function patchWidget(id, patch) {
  widgets.value = widgets.value.map((w) => (w.id === id ? { ...w, ...patch } : w))
}

function setCoordinate(key, value) {
  if (!selected.value) return
  const n = Number(value)
  patchWidget(selected.value.id, { [key]: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 })
}

function setFlag(key, value) {
  if (!selected.value) return
  const id = selected.value.id
  widgets.value = widgets.value.map((w) => (w.id === id ? withWidgetFlags(w, { [key]: value }) : w))
}

/**
 * Der Modus ist JE SEITE waehlbar (Owner-Vorgabe). Er wird hier nur eingestellt,
 * nicht gespeichert - dafuer ist „Speichern" da (s. {@link persist}).
 */
function setMode(mode) {
  if (!LAYOUT_MODES.includes(mode)) return
  settings.mode = mode
  guides.value = []
}

function toFront() {
  if (!selected.value) return
  widgets.value = bringToFront(widgets.value, selected.value.id)
}

function toBack() {
  if (!selected.value) return
  widgets.value = sendToBack(widgets.value, selected.value.id)
}

function distribute() {
  const next = distributeHorizontally(widgets.value, selectionInPageOrder.value)
  if (!next) return
  widgets.value = widgets.value.map((w) => (next[w.id] === undefined ? w : { ...w, x: next[w.id] }))
}

function equalSize() {
  const next = matchSize(widgets.value, selectionInPageOrder.value)
  if (!next) return
  widgets.value = widgets.value.map((w) => (next[w.id] === undefined ? w : { ...w, ...next[w.id] }))
}

/* --------------------------------------------------------------------- drag */

let drag = null

function onElementMouseDown(widget, ev) {
  if (ev.button !== undefined && ev.button !== 0) return
  drag = null
  select(widget.id, ev.shiftKey === true)
  if (!isPixel.value) {
    drag = { kind: 'order', id: widget.id }
    return
  }
  if (widgetFlags(widget).locked) return
  drag = {
    kind: 'move',
    id: widget.id,
    startX: ev.clientX,
    startY: ev.clientY,
    origin: { x: widget.x, y: widget.y },
    moved: false,
  }
}

function onWindowMouseMove(ev) {
  if (!drag) return
  if (drag.kind === 'move') {
    patchWidget(drag.id, snapBox(drag.origin, ev.clientX - drag.startX, ev.clientY - drag.startY, settings.grid))
    guides.value = guidesFor(widgets.value, drag.id, GUIDE_TOLERANCE)
    drag.moved = true
    return
  }
  // Responsiver Modus: das Element unter dem Zeiger sagt, wohin es einsortiert
  // wird. Kein HTML5-Drag - der Harness fuehrt echte Mausereignisse.
  const host = ev.target && ev.target.closest ? ev.target.closest('[data-el]') : null
  const overId = host ? host.getAttribute('data-el') : null
  if (!overId || overId === drag.id) return
  const from = widgets.value.findIndex((w) => w.id === drag.id)
  const to = widgets.value.findIndex((w) => w.id === overId)
  if (from < 0 || to < 0) return
  widgets.value = moveItem(widgets.value, from, to)
  // SOFORT speichern, nicht erst beim Loslassen: die neue Reihenfolge muss ein
  // Neuladen ueberleben (E2), und ein Reload direkt nach dem Loslassen wuerde
  // eine noch laufende Anfrage abbrechen.
  persist()
}

function onWindowMouseUp() {
  if (!drag) return
  drag = null
  guides.value = []
}

/* ----------------------------------------------------------------- tastatur */

const NUDGE = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

function onWindowKeyDown(ev) {
  if (!loaded.value) return
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'a' || ev.key === 'A')) {
    ev.preventDefault()
    selectedIds.value = widgets.value.map((w) => w.id)
    return
  }
  const step = NUDGE[ev.key]
  if (!step || !isPixel.value || selectedIds.value.length === 0) return
  let moved = false
  widgets.value = widgets.value.map((w) => {
    if (!selectedIds.value.includes(w.id) || widgetFlags(w).locked) return w
    moved = true
    return { ...w, x: Math.max(0, w.x + step[0]), y: Math.max(0, w.y + step[1]) }
  })
  if (!moved) return
  ev.preventDefault()
}

/* ------------------------------------------------------------------ vorschau */

function setPreviewWidth(value) {
  previewWidth.value = value
  const n = Number(value)
  emit('preview-width', value !== '' && Number.isFinite(n) ? n : null)
}

/** Jede Aenderung geht sofort als Entwurf nach oben - gespeichert wird dabei nichts. */
watch(
  () => (props.pageId ? currentConfig() : null),
  (config) => {
    emit(
      'draft',
      config
        ? toPreviewDraft({
            pageId: props.pageId,
            name: nodeName.value,
            kind: nodeKind.value,
            pageConfig: config,
          })
        : null,
    )
  },
  { deep: true },
)

watch(() => props.pageId, load)

onMounted(() => {
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup', onWindowMouseUp)
  window.addEventListener('keydown', onWindowKeyDown)
  load()
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('keydown', onWindowKeyDown)
})

function elementStyle(widget) {
  if (!isPixel.value) return null
  return {
    position: 'absolute',
    left: `${widget.x}px`,
    top: `${widget.y}px`,
    width: `${Math.max(1, widget.w)}px`,
    height: `${Math.max(1, widget.h)}px`,
  }
}

function guideStyle(guide) {
  return guide.axis === 'x'
    ? { position: 'absolute', left: `${guide.at}px`, top: '0', width: '1px', height: '100%' }
    : { position: 'absolute', top: `${guide.at}px`, left: '0', height: '1px', width: '100%' }
}
</script>

<template>
  <section
    v-if="pageId"
    data-testid="visu-editor-canvas"
    class="flex flex-col gap-2"
  >
    <!--
      Die Werkzeugleiste steht bewusst in EINER Zeile, die waagerecht rollt,
      statt umzubrechen: sie steht ueber dem Canvas, und jede zusaetzliche Zeile
      schiebt die Zeichenflaeche nach unten. Auf einem schmalen Geraet
      (der M5-Harness faehrt 393x851) war der Canvas dadurch ausserhalb des
      sichtbaren Fensters, und ein Zeiger-Drag traf gar nichts mehr - gemessen.
      Die Beschriftungen haengen ueber `for`/`id` an ihren Bedienelementen und
      nicht durch Umschliessen: der zugaengliche Name eines umschlossenen
      `<select>` nimmt sonst die Texte SEINER OPTIONEN mit auf („Layout-Modus
      Pixel Responsiv"), und dann trifft eine Suche nach „X" die Modus-Auswahl.
    -->
    <div class="flex items-end gap-3 overflow-x-auto pb-1">
      <div class="flex shrink-0 flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
        <label for="editor-canvas-mode-select">{{ $t('visuEditor.canvas.mode') }}</label>
        <select
          id="editor-canvas-mode-select"
          class="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          :value="settings.mode"
          @change="setMode($event.target.value)"
        >
          <option :value="LAYOUT_PIXEL">{{ $t('visuEditor.canvas.modePixel') }}</option>
          <option :value="LAYOUT_RESPONSIVE">{{ $t('visuEditor.canvas.modeResponsive') }}</option>
        </select>
      </div>

      <div
        v-if="isPixel"
        class="flex shrink-0 flex-col gap-1 text-xs text-slate-500 dark:text-slate-400"
      >
        <label for="editor-canvas-grid">{{ $t('visuEditor.canvas.grid') }}</label>
        <input
          id="editor-canvas-grid"
          type="number"
          min="1"
          class="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          :value="settings.grid"
          @input="settings.grid = Math.max(1, Number($event.target.value) || 1)"
        >
      </div>

      <div class="flex shrink-0 flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
        <label for="editor-canvas-breakpoints">{{ $t('visuEditor.canvas.breakpoints') }}</label>
        <input
          id="editor-canvas-breakpoints"
          type="text"
          class="w-36 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          :value="breakpointText"
          @input="breakpointText = $event.target.value"
        >
      </div>

      <div class="flex shrink-0 flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
        <label for="editor-canvas-preview-width">{{ $t('visuEditor.canvas.previewWidth') }}</label>
        <select
          id="editor-canvas-preview-width"
          class="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          :value="previewWidth"
          @change="setPreviewWidth($event.target.value)"
        >
          <option value="">{{ $t('visuEditor.canvas.previewWidthAuto') }}</option>
          <option
            v-for="bp in breakpointList"
            :key="bp"
            :value="String(bp)"
          >
            {{ bp }}
          </option>
        </select>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="isPixel"
          type="button"
          class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          :disabled="selectedIds.length < 3"
          @click="distribute"
        >
          {{ $t('visuEditor.canvas.distribute') }}
        </button>
        <button
          v-if="isPixel"
          type="button"
          class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          :disabled="selectedIds.length < 2"
          @click="equalSize"
        >
          {{ $t('visuEditor.canvas.sameSize') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          :disabled="!selected"
          @click="toFront"
        >
          {{ $t('visuEditor.canvas.toFront') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          :disabled="!selected"
          @click="toBack"
        >
          {{ $t('visuEditor.canvas.toBack') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded bg-sky-600 px-2 py-1 text-sm whitespace-nowrap text-white"
          @click="persist(true)"
        >
          {{ $t('visuEditor.canvas.save') }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 text-xs">
      <span
        data-testid="editor-canvas-mode"
        class="text-slate-500 dark:text-slate-400"
      >
        {{
          $t('visuEditor.canvas.renderedAs', {
            mode: isPixel ? $t('visuEditor.canvas.modePixel') : $t('visuEditor.canvas.modeResponsive'),
            skin: activeSkin,
          })
        }}
      </span>
      <span
        v-if="saved"
        data-testid="editor-canvas-saved"
        class="text-emerald-600 dark:text-emerald-400"
      >
        {{ $t('visuEditor.canvas.saved') }}
      </span>
      <span
        v-if="errorKey"
        data-testid="editor-canvas-error"
        class="text-amber-600 dark:text-amber-400"
      >
        {{ errorKey === 'load' ? $t('visuEditor.canvas.loadError') : $t('visuEditor.canvas.saveError') }}
      </span>
    </div>

    <div class="flex flex-wrap gap-3">
      <div
        class="editor-canvas relative min-h-[280px] min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-900"
        :class="isPixel ? 'overflow-auto' : 'flex flex-col gap-2 p-2'"
      >
        <div
          v-for="widget in widgets"
          :key="widget.id"
          :data-el="widget.id"
          :data-x="widget.x"
          :data-y="widget.y"
          :data-w="widget.w"
          :data-h="widget.h"
          class="overflow-hidden border text-[10px] leading-none"
          :class="[
            isSelected(widget.id)
              ? 'is-selected border-sky-500 bg-sky-100 dark:bg-sky-900/40'
              : 'border-slate-400 bg-slate-100 dark:bg-slate-700',
            widgetFlags(widget).hidden ? 'opacity-40' : '',
            isPixel ? '' : 'cursor-move rounded px-2 py-3',
          ]"
          :style="elementStyle(widget)"
          @mousedown="onElementMouseDown(widget, $event)"
          @click="select(widget.id, $event.shiftKey === true)"
        >
          <span class="pointer-events-none block truncate">{{ widget.name }}</span>
          <span
            v-if="isSelected(widget.id) && isPixel"
            data-resize="se"
            class="absolute right-0 bottom-0 h-2 w-2 bg-sky-500"
          />
        </div>

        <div
          v-if="guides.length > 0"
          class="editor-guide pointer-events-none absolute inset-0"
        >
          <span
            v-for="guide in guides"
            :key="`${guide.axis}-${guide.at}`"
            class="editor-guide-line bg-fuchsia-500"
            :style="guideStyle(guide)"
          />
        </div>

        <p
          v-if="loaded && widgets.length === 0"
          class="p-4 text-sm text-slate-400"
        >
          {{ $t('visuEditor.canvas.empty') }}
        </p>
      </div>

      <div
        v-if="isPixel"
        class="flex w-40 shrink-0 flex-col gap-2"
      >
        <div class="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <label for="editor-canvas-x">X</label>
          <input
            id="editor-canvas-x"
            type="number"
            class="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            :disabled="!selected"
            :value="selected ? selected.x : ''"
            @input="setCoordinate('x', $event.target.value)"
          >
        </div>
        <div class="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <label for="editor-canvas-y">Y</label>
          <input
            id="editor-canvas-y"
            type="number"
            class="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            :disabled="!selected"
            :value="selected ? selected.y : ''"
            @input="setCoordinate('y', $event.target.value)"
          >
        </div>
        <div class="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <label for="editor-canvas-w">{{ $t('visuEditor.canvas.width') }}</label>
          <input
            id="editor-canvas-w"
            type="number"
            class="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            :disabled="!selected"
            :value="selected ? selected.w : ''"
            @input="setCoordinate('w', $event.target.value)"
          >
        </div>
        <div class="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <label for="editor-canvas-h">{{ $t('visuEditor.canvas.height') }}</label>
          <input
            id="editor-canvas-h"
            type="number"
            class="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            :disabled="!selected"
            :value="selected ? selected.h : ''"
            @input="setCoordinate('h', $event.target.value)"
          >
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
      <div class="flex items-center gap-2">
        <input
          id="editor-canvas-locked"
          type="checkbox"
          :disabled="!selected"
          :checked="selectedFlags.locked"
          @change="setFlag('locked', $event.target.checked)"
        >
        <label for="editor-canvas-locked">{{ $t('visuEditor.canvas.locked') }}</label>
      </div>
      <div class="flex items-center gap-2">
        <input
          id="editor-canvas-hidden"
          type="checkbox"
          :disabled="!selected"
          :checked="selectedFlags.hidden"
          @change="setFlag('hidden', $event.target.checked)"
        >
        <label for="editor-canvas-hidden">{{ $t('visuEditor.canvas.hidden') }}</label>
      </div>
    </div>
  </section>
</template>
