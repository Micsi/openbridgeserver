<script setup>
/**
 * Der WYSIWYG-Canvas des V2-Editors (M5 C2, Issue #169).
 *
 * BEIDE PARADIGMEN, je Seite waehlbar - das ist die Owner-Vorgabe, und die
 * Design-Invariante aus CONTRIBUTING-visu-m5.md §1.1 steht genau dafuer:
 * Pixel-Autorenschaft ist ein ANGEBOT, kein Zwang.
 *
 *  - **Pixel-Modus** (E1/E4/E8): Elemente liegen auf Koordinaten, Ziehen und
 *    Groesserziehen rasten an einer einstellbaren Rasterweite ein, Ausrichtlinien
 *    erscheinen bei Kantendeckung, „Verteilen" und „Gleiche Groesse" raeumen auf,
 *    die Z-Ordnung ist die Reihenfolge der Widget-Liste, und ein Element laesst
 *    sich sperren oder ausblenden.
 *  - **Responsiver Modus** (E2/E17): dieselbe Seite, ohne dass eine Koordinate
 *    WIRKT. Nur die REIHENFOLGE zaehlt, sie wird per Drag gesetzt und sofort
 *    gespeichert; Koordinatenfelder gibt es dann gar nicht. Die Breakpoints
 *    stehen in den Seiteneigenschaften.
 *
 * DIE KOORDINATEN BLEIBEN DABEI STEHEN - das ist die Korrektur aus Runde 3.
 * §1.1 sagt „im responsiven Modus wirkt keine Koordinate", nicht „die Zahlen
 * muessen weg". Sie zu loeschen setzte die Regel zwar durch, brach aber R17: V1
 * (`frontend/`) liest DIESELBE Seite und erwartet vier `number`. Durchgesetzt
 * wird die Regel deshalb dort, wo aus Daten ein Bild wird - im Host, an
 * `layout_mode` (`pageHonoursPosition` in `apps/visu/src/core/obs/mapping.ts`).
 * Fuer diesen Canvas heisst das: der Moduswechsel nimmt nichts weg, und der
 * Rueckweg auf Pixel gibt genau die Lage zurueck, die der Autor gesetzt hat.
 *
 * DER MODUS UND DER SKIN SIND ZWEI DINGE. Der Modus sagt, WORIN die Seite
 * verfasst ist (Koordinaten oder nur Reihenfolge), der Skin, was davon
 * HONORIERT wird. Der
 * Editor leitet deshalb nicht mehr den Skin aus dem Modus ab (so stand es in
 * Runde 1 und kollidierte mit E19/C1), sondern zeigt umgekehrt JE SKIN, welcher
 * Modus gerendert wird - `renderedMode()` in `utils/visuEditorPage.js`. Gewaehlt
 * wird der Skin in den Seiteneigenschaften (Teil C1); dieser Canvas liest ihn.
 *
 * WANN GESPEICHERT WIRD - die ganze Regel, ohne Rest:
 *  - SOFORT gesichert wird genau EINE Groesse: die REIHENFOLGE, wenn sie im
 *    responsiven Modus per Drag gesetzt wird. Sie ist der Boden des Modells
 *    (§2.1), hat kein zweites Zuhause, und der belegte Champion dieser Zeile
 *    (Home Assistant, §1.1 E2) speichert eine umsortierte Karte ebenfalls beim
 *    Loslassen. E2 verlangt genau das: das Order-Array ist vor und nach einem
 *    Neuladen identisch, ohne dass jemand „Speichern" gedrueckt haette.
 *  - Dieses Sofort-Sichern schreibt AUSSCHLIESSLICH die Reihenfolge, und zwar auf
 *    den GESPEICHERTEN Stand. Kein ungespeicherter Nudge, keine ungespeicherte
 *    Marke, keine ungespeicherte Seiteneigenschaft faehrt mit. In Runde 1 tat es
 *    das: fuenf Pfeiltasten und ein Umsortieren spaeter stand `x=9` auf dem
 *    Server, obwohl niemand gespeichert hatte. Ein halb gespeicherter Zustand
 *    entsteht damit nicht mehr - was der Server nach einem Umsortieren haelt, ist
 *    exakt der zuletzt gespeicherte Stand mit neuer Reihenfolge.
 *  - ALLES ANDERE gehoert „Speichern": Lage, Groesse, Z-Ordnung ueber die
 *    Schaltflaechen, die Marken „gesperrt"/„ausgeblendet", Modus, Rasterweite und
 *    Breakpoints. Im Pixel-Modus ist das Verschieben Teil einer Bearbeitung (so
 *    wie bei Grafana und ioBroker vis-2, §1.1 E1/E4/E8); jeden Zug einzeln auf den
 *    Server zu schreiben naehme dem spaeteren Undo-Stapel (Teil C5, E7) den Boden.
 *  - „Gespeichert" wird erst gemeldet, wenn die Seite vom Server ZURUECKGELESEN
 *    wurde und traegt, was sie tragen sollte - Seiteneigenschaften, Reihenfolge
 *    UND jede Koordinate. Ein 204 allein ist kein Beleg; in Runde 1 meldete der
 *    Editor Erfolg fuer eine Einstellung, die gar keinen Traeger gefunden hatte.
 *  - Das Sofort-Sichern liest ebenfalls zurueck. Es meldet keinen Erfolg (es
 *    steht kein „Gespeichert" dahinter), aber es meldet einen FEHLSCHLAG - sonst
 *    waere ausgerechnet der Pfad, dem nie ein „Speichern" folgt, der einzige
 *    ohne Beleg.
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
  ensureBoxes,
  guidesFor,
  idsWithoutBox,
  matchSize,
  moveItem,
  sendToBack,
  snapBox,
  snapSize,
} from '@/utils/visuEditorLayout'
import {
  LAYOUT_MODES,
  LAYOUT_PIXEL,
  LAYOUT_RESPONSIVE,
  formatBreakpoints,
  hasBox,
  parseBreakpoints,
  readPageSettings,
  renderedMode,
  sameSettings,
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
/** Dieselbe Liste, wie sie GESPEICHERT ist - der Boden jeder Sofort-Sicherung. */
const storedWidgets = ref([])
/** Der Rest der `PageConfig` (grid_cols, includes, popup ...) - unveraendert durchgereicht. */
const base = ref(null)
const nodeName = ref('')
const nodeKind = ref('normal')
/** Die Seiteneigenschaften, wie der Autor sie gerade eingestellt hat. */
const settings = reactive({ mode: LAYOUT_PIXEL, grid: DEFAULT_GRID, skin: null })
/**
 * Dieselben Eigenschaften, wie sie GESPEICHERT sind.
 *
 * Der Unterschied ist Absicht: ein Blick in den anderen Modus soll die Seite
 * nicht umschreiben. Ohne diese Trennung wuerde jede Ansichts-Entscheidung
 * heimlich mitgespeichert, und eine Seite haette nach einem Ausprobieren einen
 * anderen Modus, als der Autor je gewaehlt hat.
 */
const storedSettings = reactive({
  mode: LAYOUT_PIXEL,
  grid: DEFAULT_GRID,
  breakpoints: [],
  skin: null,
})
/**
 * Die Kacheln, denen der Editor beim Laden eine Vorgabe-Lage geben musste.
 *
 * Der Normalfall ist die leere Liste: das Backend-Modell traegt vier `int`, und
 * seit Runde 3 nimmt sie ihm niemand mehr ab. Kommt trotzdem eine Zeile ohne
 * Box herein (direkter DB-Zugriff, ein altes Restore, eine Zeile aus Runde 2),
 * dann wird gefuellt - aber sichtbar. Eine erfundene Lage, die der naechste
 * „Speichern"-Klick festschreibt, darf nicht still bleiben.
 */
const placedByDefault = ref([])
const breakpointText = ref('')
const previewWidth = ref('')
const selectedIds = ref([])
const guides = ref([])
const loaded = ref(false)
const errorKey = ref(null)
const saved = ref(false)

/**
 * Die LAYER dieser Seite: die globalen Inkludeseiten und die individuellen
 * Inkludeseiten, die unter ihr liegen (§3, C2-Zeile „Layer-Sichtbarkeit").
 *
 * Sie sind ANSICHT, nicht Inhalt: der Autor blendet sie ein und aus, um zu
 * sehen, was ihm unter der eigenen Seite liegt. Gespeichert wird dabei nichts -
 * ob eine Seite den globalen Boden ueberhaupt bekommt (`ignore_global_includes`,
 * R13) und welche Seiten sie inkludiert (R14), sind Seiteneigenschaften und
 * gehoeren Teil C1. Diese beiden Schalter aendern nur, was Canvas und Vorschau
 * ZEIGEN.
 */
const layers = ref([])
const showGlobalLayer = ref(true)
const showIncludeLayer = ref(true)
const layersFailed = ref(false)

const isPixel = computed(() => settings.mode !== LAYOUT_RESPONSIVE)
const breakpointList = computed(() => parseBreakpoints(breakpointText.value))
const selected = computed(() => widgets.value.find((w) => w.id === selectedIds.value[0]) ?? null)
const selectedFlags = computed(() => widgetFlags(selected.value))
/** Der Skin der Seite (Teil C1 waehlt ihn) - hier nur gelesen und angezeigt. */
const activeSkin = computed(() => settings.skin || 'edomi')
/** Was der Skin aus dem gewaehlten Modus tatsaechlich macht. */
const shownMode = computed(() => renderedMode(settings.mode, settings.skin))

/** Die Layer, die der Autor gerade sehen will. */
const visibleLayers = computed(() =>
  layers.value.filter((layer) =>
    layer.kind === 'globalInclude' ? showGlobalLayer.value : showIncludeLayer.value,
  ),
)
/** Die Kacheln der sichtbaren Layer - Umrisse, die man nicht anfassen kann. */
const layerBoxes = computed(() => {
  if (!isPixel.value) return []
  const boxes = []
  for (const layer of visibleLayers.value) {
    for (const w of layer.page_config?.widgets ?? []) {
      if (hasBox(w) && !widgetFlags(w).hidden) boxes.push({ ...w, layerId: layer.id })
    }
  }
  return boxes
})
const globalLayerCount = computed(
  () => layers.value.filter((l) => l.kind === 'globalInclude').length,
)
const includeLayerCount = computed(
  () => layers.value.filter((l) => l.kind !== 'globalInclude').length,
)

/**
 * Wirken die Koordinaten dieser Seite gerade nicht?
 *
 * Der responsive Modus ist eine Ansage, keine Ansicht - und seit Runde 3 auch
 * kein Datenverlust mehr: die Zahlen bleiben stehen (R17), sie WIRKEN nur nicht,
 * weil der Host auf einer responsiven Seite gar kein `position` emittiert. Der
 * Hinweis beschreibt deshalb einen ZUSTAND und verschwindet nicht nach dem
 * Speichern, sondern erst mit dem Modus.
 */
const coordinatesInactive = computed(
  () =>
    loaded.value &&
    settings.mode === LAYOUT_RESPONSIVE &&
    widgets.value.some((w) => hasBox(w)),
)

/** Die eingestellten (noch nicht zwingend gespeicherten) Seiteneigenschaften. */
function pendingSettings() {
  return {
    mode: settings.mode,
    grid: settings.grid,
    breakpoints: breakpointList.value,
    skin: settings.skin,
  }
}

/** Die Seite mit einem bestimmten Satz Seiteneigenschaften und einer Widget-Liste. */
function configWith(pageSettings, widgetList) {
  return writePageSettings({ ...(base.value || {}), widgets: widgetList }, pageSettings)
}

/** Was die VORSCHAU zeigt: immer der eingestellte Stand, nie der gespeicherte. */
function currentConfig() {
  return configWith(pendingSettings(), widgets.value)
}

/* ------------------------------------------------------------------ laden */

/** Den Server-Stand als den eigenen uebernehmen (nach Laden und nach Speichern). */
function adopt(config) {
  base.value = config
  const stored = readPageSettings(config)
  Object.assign(storedSettings, stored)
  settings.mode = stored.mode
  settings.grid = stored.grid
  settings.skin = stored.skin
  breakpointText.value = formatBreakpoints(stored.breakpoints)
  const list = (config.widgets ?? []).map((w) => ({ ...w }))
  storedWidgets.value = list.map((w) => ({ ...w }))
  // Gezeichnet wird nur, was eine Box hat - unabhaengig vom Modus, denn der
  // Modus nimmt seit Runde 3 keine mehr weg. Bleibt trotzdem eine Kachel ohne
  // Lage uebrig, bekommt sie die Vorgabe des Backend-Modells UND einen Hinweis;
  // still andichten ist genau der Fehler aus Runde 2.
  const ohneBox = idsWithoutBox(list)
  placedByDefault.value = ohneBox
  widgets.value = ohneBox.length > 0 ? ensureBoxes(list) : list
}

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
    adopt(page?.data ?? {})
    selectedIds.value = []
    loaded.value = true
  } catch {
    errorKey.value = 'load'
    return
  }
  await loadLayers()
}

/**
 * Die Layer laden: globale Inkludeseiten aus dem Baum, individuelle aus den
 * `includes` DIESER Seite - beides nach denselben Regeln, nach denen die Visu
 * komponiert (R9/R11/R13/R14). Ein Popup und eine globale Inkludeseite bekommen
 * keinen globalen Boden.
 *
 * Ein Fehlschlag ist hier KEIN Ladefehler der Seite: der Canvas steht auch ohne
 * Layer. Er wird trotzdem gemeldet, statt als „diese Seite hat keine Layer"
 * durchzugehen.
 */
async function loadLayers() {
  layers.value = []
  layersFailed.value = false
  const config = base.value || {}
  try {
    const tree = (await visuApi.getTree())?.data ?? []
    const wanted = []
    if (nodeKind.value === 'normal' && config.ignore_global_includes !== true) {
      for (const node of tree) {
        if (node.kind === 'globalInclude' && node.id !== props.pageId) wanted.push(node)
      }
    }
    for (const id of config.includes ?? []) {
      const node = tree.find((n) => n.id === id)
      if (node && node.id !== props.pageId) wanted.push(node)
    }
    const loadedLayers = []
    for (const node of wanted) {
      const page = await visuApi.getPage(node.id)
      loadedLayers.push({
        id: node.id,
        name: node.name ?? '',
        kind: node.kind ?? 'normal',
        page_config: page?.data ?? { widgets: [] },
      })
    }
    layers.value = loadedLayers
  } catch {
    layers.value = []
    layersFailed.value = true
  }
}

/* --------------------------------------------------------------- speichern */

/**
 * Traegt der Server danach, was er tragen sollte?
 *
 * Verglichen werden die Seiteneigenschaften, die Reihenfolge der Ids UND die
 * Autoren-Box jeder Kachel. Die Box stand bis Runde 2 nicht drin, und das war
 * eine Luecke derselben Bauart wie der Fund von Runde 1: ginge serverseitig eine
 * Koordinate verloren, stuende trotzdem „Gespeichert" da. Sie ist erst seit
 * dieser Runde vergleichbar - vorher leerte das Backend-Modell die Zahlen im
 * responsiven Modus selbst, ein Vergleich haette also immer angeschlagen.
 */
function boxSignature(list) {
  return (list ?? []).map((w) => `${w.id}:${w.x},${w.y},${w.w},${w.h}`).join('|')
}

function confirmed(server, wanted) {
  if (!server || typeof server !== 'object') return false
  if (!sameSettings(readPageSettings(server), readPageSettings(wanted))) return false
  return boxSignature(server.widgets) === boxSignature(wanted.widgets)
}

/**
 * „Speichern": die ganze Seite - Widgets, Marken UND Seiteneigenschaften.
 *
 * Danach wird zurueckgelesen. Erst wenn die Seite auf dem Server traegt, was sie
 * tragen sollte, erscheint „Gespeichert"; sonst steht da der Speicherfehler. Das
 * kostet einen GET und schliesst dafuer die Luecke aus Runde 1, in der der Editor
 * Erfolg meldete, waehrend die Eingabe verloren ging.
 */
async function save() {
  if (!props.pageId) return
  const wanted = configWith(pendingSettings(), widgets.value)
  saved.value = false
  try {
    await visuApi.savePage(props.pageId, wanted)
    const server = (await visuApi.getPage(props.pageId))?.data ?? null
    if (!confirmed(server, wanted)) {
      errorKey.value = 'save'
      return
    }
    adopt(server)
    errorKey.value = null
    saved.value = true
  } catch {
    saved.value = false
    errorKey.value = 'save'
  }
}

/** Die gespeicherten Widgets in der Reihenfolge, die der Canvas gerade zeigt. */
function orderedStored() {
  const remaining = new Map(storedWidgets.value.map((w) => [w.id, w]))
  const ordered = []
  for (const w of widgets.value) {
    const stored = remaining.get(w.id)
    if (!stored) continue
    remaining.delete(w.id)
    ordered.push(stored)
  }
  // Was der Server haelt, der Canvas aber nicht kennt, bleibt erhalten statt
  // still zu verschwinden (heute kann das nicht vorkommen; sobald C3 Widgets
  // anlegt und C5 sie einfuegt, kostet diese Zeile nichts und rettet Daten).
  for (const rest of remaining.values()) ordered.push(rest)
  return ordered
}

/**
 * Die REIHENFOLGE sichern - und sonst nichts.
 *
 * Serialisiert und zusammengefasst: waehrend eine Anfrage laeuft, wird die
 * naechste nur vorgemerkt und danach EINMAL mit dem dann aktuellen Stand
 * gefahren. Ein Drag ueber drei Nachbarn setzt damit hoechstens eine Anfrage
 * gleichzeitig ab, und eine verspaetete Antwort kann keine veraltete Reihenfolge
 * gewinnen lassen (in Runde 1 lief jeder Zwischenschritt ungebremst hinaus).
 *
 * ZURUECKGELESEN WIRD AUCH HIER. Bis Runde 2 setzte dieser Pfad `storedWidgets`
 * aus der eigenen Nutzlast - er glaubte sich selbst. Das war ausgerechnet dort
 * die schwaechere Regel, wo nie ein „Speichern" nachkommt, das den Fehler noch
 * auffangen koennte. Gemeldet wird weiterhin kein Erfolg (dieser Pfad behauptet
 * keinen), sehr wohl aber ein Fehlschlag.
 */
let orderSaving = null
let orderPending = false

function persistOrder() {
  if (!props.pageId) return Promise.resolve()
  if (orderSaving) {
    orderPending = true
    return orderSaving
  }
  orderSaving = (async () => {
    try {
      let ok = true
      do {
        orderPending = false
        const payload = configWith({ ...storedSettings }, orderedStored())
        await visuApi.savePage(props.pageId, payload)
        const server = (await visuApi.getPage(props.pageId))?.data ?? null
        ok = confirmed(server, payload)
        // Der neue Boden ist, was der Server WIRKLICH haelt - auch im
        // Fehlerfall. `storedWidgets` bildet den Server ab, nicht den Wunsch;
        // sonst faehrt der naechste Zug auf einer Behauptung weiter.
        storedWidgets.value = (server?.widgets ?? payload.widgets).map((w) => ({ ...w }))
      } while (orderPending)
      errorKey.value = ok ? null : 'save'
    } catch {
      errorKey.value = 'save'
    } finally {
      orderSaving = null
    }
  })()
  return orderSaving
}

/* ---------------------------------------------------------------- auswahl */

function isSelected(id) {
  return selectedIds.value.includes(id)
}

/**
 * Gewaehlt wird beim DRUECKEN, nicht beim Klick - und nur dort.
 *
 * Beides zu behandeln (`@mousedown` UND `@click`) sieht harmlos aus und ist es
 * bei einem einfachen Klick auch, weil `select` dann zweimal dasselbe tut. Mit
 * gedrueckter Umschalttaste ist es das Gegenteil: die additive Wahl SCHALTET UM,
 * ein echter Browser-Klick loest beide Ereignisse aus, und die Auswahl war nach
 * dem Loslassen wieder leer. Eine Mehrfachauswahl per Umschalt war damit im
 * Browser gar nicht moeglich - im Vitest schon, weil dort nur `click`
 * ausgeloest wurde. Deshalb steht die Wahl jetzt an genau einer Stelle.
 */
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
 * nicht gespeichert - dafuer ist „Speichern" da (s. Kopf).
 *
 * Und er fasst die Koordinaten NICHT an, in keiner Richtung. Bis Runde 2 fuellte
 * der Rueckweg hier jede Kachel mit `0/0/2/2` auf, weil der Hinweg sie geleert
 * hatte: alle Kacheln lagen danach uebereinander auf dem Ursprung, ohne Hinweis,
 * und der naechste „Speichern"-Klick schrieb das in die Spalte. Beides ist weg -
 * der Hinweg nimmt nichts, der Rueckweg erfindet nichts.
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

/**
 * Der Anfasser unten rechts (E14, `data-resize="se"`): er zieht die MASSE, nicht
 * die Lage. Bis Runde 1 hatte er keinen Handler - ein Zug daran blubberte an das
 * `mousedown` des Elternelements und VERSCHOB das Element. Eine Affordanz, die
 * etwas anderes tut, als sie zeigt; deshalb faengt `stopPropagation` das Ereignis
 * hier ab, und an einem gesperrten Element wird der Anfasser gar nicht erst
 * gezeigt.
 */
function onResizeMouseDown(widget, ev) {
  if (ev.button !== undefined && ev.button !== 0) return
  ev.stopPropagation()
  drag = null
  select(widget.id)
  if (!isPixel.value || widgetFlags(widget).locked) return
  drag = {
    kind: 'resize',
    id: widget.id,
    startX: ev.clientX,
    startY: ev.clientY,
    origin: { w: widget.w, h: widget.h },
  }
}

function onWindowMouseMove(ev) {
  if (!drag) return
  if (drag.kind === 'move') {
    patchWidget(
      drag.id,
      snapBox(drag.origin, ev.clientX - drag.startX, ev.clientY - drag.startY, settings.grid),
    )
    guides.value = guidesFor(widgets.value, drag.id, GUIDE_TOLERANCE)
    drag.moved = true
    return
  }
  if (drag.kind === 'resize') {
    patchWidget(
      drag.id,
      snapSize(drag.origin, ev.clientX - drag.startX, ev.clientY - drag.startY, settings.grid),
    )
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
  // eine noch laufende Anfrage abbrechen. Geschrieben wird dabei NUR die
  // Reihenfolge, auf dem gespeicherten Stand (s. Kopf).
  persistOrder()
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
            layers: layers.value,
            showGlobalLayer: showGlobalLayer.value,
            showIncludeLayer: showIncludeLayer.value,
          })
        : null,
    )
  },
  { deep: true },
)

/** Die Layer-Schalter aendern das Bild, nicht das Modell - der Entwurf zieht mit. */
watch([layers, showGlobalLayer, showIncludeLayer], () => {
  if (!props.pageId || !base.value) return
  emit(
    'draft',
    toPreviewDraft({
      pageId: props.pageId,
      name: nodeName.value,
      kind: nodeKind.value,
      pageConfig: currentConfig(),
      layers: layers.value,
      showGlobalLayer: showGlobalLayer.value,
      showIncludeLayer: showIncludeLayer.value,
    }),
  )
})

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
          @click="save"
        >
          {{ $t('visuEditor.canvas.save') }}
        </button>
      </div>
    </div>

    <!-- Layer-Sichtbarkeit: was unter dieser Seite liegt, ein- und ausblendbar. -->
    <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
      <div class="flex items-center gap-2">
        <input
          id="editor-canvas-layer-global"
          type="checkbox"
          :checked="showGlobalLayer"
          @change="showGlobalLayer = $event.target.checked"
        >
        <label for="editor-canvas-layer-global">
          {{ $t('visuEditor.canvas.globalLayer', { count: globalLayerCount }) }}
        </label>
      </div>
      <div class="flex items-center gap-2">
        <input
          id="editor-canvas-layer-include"
          type="checkbox"
          :checked="showIncludeLayer"
          @change="showIncludeLayer = $event.target.checked"
        >
        <label for="editor-canvas-layer-include">
          {{ $t('visuEditor.canvas.includeLayer', { count: includeLayerCount }) }}
        </label>
      </div>
      <span
        v-if="layersFailed"
        data-testid="editor-canvas-layers-error"
        class="text-amber-600 dark:text-amber-400"
      >
        {{ $t('visuEditor.canvas.layersError') }}
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 text-xs">
      <span
        data-testid="editor-canvas-mode"
        class="text-slate-500 dark:text-slate-400"
      >
        {{
          $t('visuEditor.canvas.renderedAs', {
            mode:
              shownMode === LAYOUT_PIXEL
                ? $t('visuEditor.canvas.modePixel')
                : $t('visuEditor.canvas.modeResponsive'),
            skin: activeSkin,
          })
        }}
      </span>
      <span
        v-if="coordinatesInactive"
        data-testid="editor-canvas-mode-hint"
        class="text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.canvas.coordinatesInactive') }}
      </span>
      <span
        v-if="placedByDefault.length > 0"
        data-testid="editor-canvas-placed-hint"
        class="text-amber-600 dark:text-amber-400"
      >
        {{ $t('visuEditor.canvas.placedByDefault', { count: placedByDefault.length }) }}
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
        <!--
          Die Kacheln der Layer: Umrisse dessen, was UNTER dieser Seite liegt.
          Sie tragen bewusst NICHT `data-el` - der Harness und die Auswahl
          sprechen damit die eigenen Elemente an, und ein fremdes Element soll
          man hier weder waehlen noch verschieben koennen (es gehoert einer
          anderen Seite).
        -->
        <div
          v-for="ghost in layerBoxes"
          :key="`${ghost.layerId}-${ghost.id}`"
          :data-layer-el="ghost.id"
          :data-layer="ghost.layerId"
          class="pointer-events-none overflow-hidden border border-dashed border-slate-400/70 text-[10px] leading-none opacity-40"
          :style="elementStyle(ghost)"
        >
          <span class="block truncate">{{ ghost.name }}</span>
        </div>

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
        >
          <span class="pointer-events-none block truncate">{{ widget.name }}</span>
          <span
            v-if="isSelected(widget.id) && isPixel && !widgetFlags(widget).locked"
            data-resize="se"
            class="absolute right-0 bottom-0 h-2 w-2 cursor-se-resize bg-sky-500"
            @mousedown="onResizeMouseDown(widget, $event)"
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
