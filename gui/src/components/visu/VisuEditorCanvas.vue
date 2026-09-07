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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { visuApi } from '@/api/visu'
import { parseEditorJson, toEditorJson } from '@/utils/visuPageJson'
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
  copiesOf,
  expandToGroups,
  groupFrames,
  groupIdOf,
  idsInRect,
  newEditorId,
  normalizeRect,
  nudged,
  withGroup,
} from '@/utils/visuEditorErgonomics'
import {
  createHistory,
  recordChange,
  redoTo,
  snapshotOf,
  undoTo,
} from '@/utils/visuEditorHistory'
import { readClipboard, writeClipboard } from '@/utils/visuEditorClipboard'
import { mergeAuthoredWidgets, widgetSignature } from '@/utils/visuEditorWidgets'
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
  /**
   * Was nach einem erfolgreichen Speichern noch geschehen muss, BEVOR
   * „Gespeichert" erscheint (M5 C6, Issue #173).
   *
   * Heute haengt genau eines daran: der Verlauf (E12). Ein Speichern legt einen
   * neuen Stand ab; ein Blick in den Verlauf unmittelbar danach zeigte ohne
   * dieses Nachziehen die Liste von VOR dem Speichern. Die Quittung waere dann
   * eine halbe Wahrheit - sie besagt seit Runde 1 ausdruecklich, dass der
   * Server traegt, was er tragen soll, und sie soll ebenso besagen, dass der
   * Editor zeigt, was der Server traegt.
   */
  afterSave: { type: Function, default: null },
  /**
   * Die Elemente, wie der AUTORENTEIL sie gerade haelt (Nachzug M5 C3, #170).
   *
   * DER GRUND, warum sie hier hereinkommen: Palette und Bindungsformular
   * schreiben in den Entwurf des Autorenteils, und der hatte keinen Weg auf
   * `page_config`. Name, Bindung, Rolle, Icon, Beschriftung, Preset und die
   * Sichtbarkeitsregel erreichten den Server nie, und „Speichern" quittierte
   * trotzdem - der Rueckvergleich sah nur Seiteneigenschaften und Boxen.
   *
   * KEIN ZWEITER SCHREIBER (Micsi/openbridgeserver#187): der Autorenteil
   * bekommt keinen eigenen `PUT`, er reicht seine Elemente hier herein, und der
   * eine Speicherweg dieses Canvas schreibt sie mit. Wer welches Feld besitzt,
   * steht in `utils/visuEditorWidgets.js`.
   *
   * `null` heisst „es gibt keinen Autorenteil" (die Proben des Canvas montieren
   * ihn allein); eine leere Liste heisst „er laedt gerade" - beides laesst die
   * Kacheln dieses Canvas unangetastet.
   */
  authoredWidgets: { type: Array, default: null },
})
const emit = defineEmits(['draft', 'preview-width', 'hidden-ids', 'select'])

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

/* ------------------------------------------------- Ergonomie (C5, #172) */

/**
 * Die ZEICHENFLAECHE innerhalb des Canvas-Kastens.
 *
 * Sie ist seit Teil C5 ein eigenes Element und nicht mehr der Kasten selbst -
 * aus einem gemessenen Grund: die Kacheln liegen absolut zum naechsten
 * positionierten Vorfahren, und das war der Kasten. Eine Kachel auf 0/0 klebte
 * damit in seiner linken oberen Ecke, und ein Zug, der auf dem LEEREN GRUND
 * beginnen soll (die Rahmenauswahl, E5), begann dort auf einer Kachel. Mit einer
 * eingerueckten Flaeche hat der Kasten einen Rand, der wirklich leer ist.
 *
 * Sie ist zugleich der Bezugspunkt der Rahmenauswahl: eine Autoreneinheit ist
 * ein CSS-Pixel, Modellkoordinaten und Flaechenkoordinaten sind damit dieselbe
 * Groesse, und der Rahmen braucht keine Umrechnung ausser dieser Verschiebung.
 */
const surface = ref(null)
/** Der aufgezogene Rahmen, solange die Maus unten ist (E5). */
const marquee = ref(null)
/**
 * Die Geschichte der ELEMENTE (E7). Reaktiv, weil „Rueckgaengig" und
 * „Wiederherstellen" ihren Zustand zeigen muessen - eine Schaltflaeche, die
 * immer klickbar aussieht, luegt ueber einen leeren Stapel.
 */
const history = reactive(createHistory())

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

/* ------------------------------------------------- JSON-Dualitaet (C6, E13) */

/**
 * ZWEI ANSICHTEN, EIN ENTWURF - und ausdruecklich KEIN dritter Schreiber.
 *
 * Die Textansicht zeigt dieselbe Seite wie der Canvas und schreibt in denselben
 * Entwurf; sie hat kein eigenes „Speichern" und setzt keine Anfrage ab.
 * Gespeichert wird weiterhin ueber genau einen Knopf, mit derselben
 * Rueckleseprobe wie zuvor. Auf `page_config` schreiben im Editor bereits zwei
 * Stellen unabhaengig voneinander (Formular und Canvas,
 * Micsi/openbridgeserver#187); eine dritte mit eigenem Schreibweg waere die
 * naechste Stelle, an der „der letzte gewinnt" entsteht.
 *
 * Richtung Canvas → Text: ein Beobachter auf demselben `currentConfig()`, den
 * auch die Vorschau bekommt. Eine Verschiebung steht damit sofort im Text, ohne
 * dass irgendwo gespeichert wuerde.
 *
 * Richtung Text → Canvas: ueber {@link parseEditorJson}. Was dort abgelehnt
 * wird, aendert NICHTS - der Canvas haelt seinen letzten guten Stand, und die
 * Meldung sagt, warum. Ein halb getipptes Dokument darf keine Kacheln kosten.
 *
 * `jsonIsSource` verhindert das Zurueckschreiben unmittelbar nach einer
 * Uebernahme: sonst formatierte der Beobachter dem Autor den Text unter den
 * Fingern um. Beobachter laufen im Vue-Scheduler VOR den `nextTick`-Rueckrufen,
 * die Marke steht also noch, wenn er an der Reihe ist.
 */
const VIEW_VISUAL = 'visual'
const VIEW_JSON = 'json'
const view = ref(VIEW_VISUAL)
const jsonText = ref('')
const jsonError = ref(null)
let jsonIsSource = false

watch(
  () => (props.pageId ? currentConfig() : null),
  (config) => {
    if (jsonIsSource) return
    jsonText.value = toEditorJson(config)
  },
  { deep: true, immediate: true },
)

/** Einen aus dem Text gelesenen Stand als den eigenen uebernehmen. */
function adoptEdited(config) {
  const stored = readPageSettings(config)
  settings.mode = stored.mode
  settings.grid = stored.grid
  settings.skin = stored.skin
  breakpointText.value = formatBreakpoints(stored.breakpoints)
  base.value = config
  widgets.value = (config.widgets ?? []).map((w) => ({ ...w }))
  guides.value = []
  // Eine Auswahl auf einer Kachel, die es im neuen Text nicht mehr gibt, waere
  // eine Auswahl auf nichts - und das Koordinatenfeld zeigte fremde Zahlen.
  selectedIds.value = selectedIds.value.filter((id) => widgets.value.some((w) => w.id === id))
}

function onJsonInput(text) {
  jsonText.value = text
  const gelesen = parseEditorJson(text)
  if (!gelesen.ok) {
    jsonError.value = gelesen.reason
    return
  }
  jsonError.value = null
  jsonIsSource = true
  adoptEdited(gelesen.config)
  nextTick(() => {
    jsonIsSource = false
  })
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

/**
 * Die Elemente des Autorenteils in die eigene Liste hereinnehmen (Nachzug C3).
 *
 * Der Autorenteil (Palette, Bindungsformular) entscheidet Name, Typ, Bindung und
 * jeden Konfig-Schluessel; dieser Canvas entscheidet Lage, Marken und
 * Reihenfolge. `mergeAuthoredWidgets` haelt beides auseinander.
 *
 * ES WIRD NUR ZUGEWIESEN, WENN SICH ETWAS AENDERT. Sonst legte jede Runde des
 * Beobachters eine neue Liste an, der Entwurfs-Beobachter darueber liefe mit,
 * und die Vorschau bekaeme eine Nachricht ohne Nachricht.
 *
 * KEINE AUFZEICHNUNG auf dem Undo-Stapel: „Rueckgaengig" gehoert den Zuegen auf
 * dieser Flaeche (E7). Ein Tastendruck im Bindungsformular ist kein Zug hier,
 * und ihn zurueckzunehmen wuerde das Formular nicht mitnehmen - der Stapel
 * behauptete dann etwas ueber einen Zustand, den er nicht herstellen kann.
 */
function adoptAuthored() {
  if (!loaded.value) return
  const naechste = mergeAuthoredWidgets(widgets.value, props.authoredWidgets)
  if (widgetSignature(naechste) === widgetSignature(widgets.value)) return
  widgets.value = naechste
  const bekannt = new Set(naechste.map((w) => w.id))
  selectedIds.value = selectedIds.value.filter((id) => bekannt.has(id))
}

watch(() => props.authoredWidgets, adoptAuthored)

async function load() {
  if (!props.pageId) return
  // DIE MARKE FAELLT ZUERST. `.editor-canvas` sagt „der Editor steht" - und das
  // stimmt beim Wechsel INNERHALB der Anwendung erst, wenn die neue Seite da
  // ist. Bis Runde 2 wurde `loaded` nur einmal wahr und nie wieder falsch: unter
  // der Marke stand dann weiter die alte Seite, mit ihren Kacheln und ihren
  // Tasten, und ein Einfuegen oder eine Pfeiltaste traf eine Liste, die gleich
  // darauf ersetzt wurde. Die Wache deckte damit nur den Erstaufbau.
  loaded.value = false
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
    // Eine frisch geladene Seite hat keine Geschichte: der Stapel gehoert dem
    // Stand, der gerade auf dem Canvas liegt. Ein uebernommener Stapel wuerde
    // beim ersten „Rueckgaengig" die Elemente einer ANDEREN Seite einsetzen.
    history.past.length = 0
    history.future.length = 0
    lastRecordTag = null
    marquee.value = null
    loaded.value = true
    // Der Autorenteil kann frueher fertig sein als dieser Canvas. Ohne diese
    // Zeile bliebe sein Stand bis zur naechsten Eingabe draussen - und ein
    // „Speichern" dazwischen schriebe den Server-Stand zurueck.
    adoptAuthored()
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
 * Verglichen werden die Seiteneigenschaften UND jedes Element GANZ - Id,
 * Reihenfolge, Name, Typ, Bindung, jeder Konfig-Schluessel (Rolle, Icon,
 * Beschriftung, Preset, `visible_when`, die Marken) und die vier Zahlen der
 * Autoren-Box.
 *
 * ZWEIMAL WAR DIESER VERGLEICH ZU KURZ, und beide Male stand „Gespeichert" ueber
 * einem Verlust. In Runde 1 (C2) sah er nur die Seiteneigenschaften und die
 * Id-Reihenfolge: eine verlorene Koordinate fiel nicht auf. Bis zu diesem
 * Nachzug sah er zusaetzlich die Box - aber nichts von dem, was Palette und
 * Bindungsformular setzen; ein Name, eine Bindung, eine Sichtbarkeitsregel
 * konnten spurlos verschwinden, und die Quittung log weiter. Der Vergleich sieht
 * jetzt alles, was in der Nutzlast steht (`utils/visuEditorWidgets.js`).
 */
function confirmed(server, wanted) {
  if (!server || typeof server !== 'object') return false
  if (!sameSettings(readPageSettings(server), readPageSettings(wanted))) return false
  return widgetSignature(server.widgets) === widgetSignature(wanted.widgets)
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
  // Solange die Textansicht ein unlesbares Dokument haelt, wird NICHT
  // gespeichert. Sonst schriebe „Speichern" klaglos den Stand VOR der
  // Bearbeitung weg - eine Erfolgsmeldung, die stimmt und etwas anderes meint.
  if (jsonError.value) return
  // Der Stand des Autorenteils gehoert in DIESE Nutzlast. Der Beobachter oben
  // hat ihn im Normalfall laengst hereingenommen; hier steht es noch einmal,
  // damit der Schreibweg nicht davon abhaengt, wann der Scheduler gelaufen ist.
  adoptAuthored()
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
    // Erst nachziehen, dann quittieren (siehe `afterSave` oben).
    if (props.afterSave) await props.afterSave()
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
    // Abwaehlen nimmt die GANZE Gruppe wieder heraus, sonst bliebe nach einem
    // zweiten Umschalt-Klick der Rest der Gruppe gewaehlt zurueck - und die
    // Auswahl haette einen Zustand, den kein Klick erzeugt hat.
    const betroffen = new Set(expandToGroups(widgets.value, [id]))
    selectedIds.value = isSelected(id)
      ? selectedIds.value.filter((x) => !betroffen.has(x))
      : expandToGroups(widgets.value, [...selectedIds.value, id])
    return
  }
  selectedIds.value = expandToGroups(widgets.value, [id])
}

/**
 * Die Wahl nach OBEN melden (Nachzug M5 C3, #170).
 *
 * Bis hierher hatten Canvas und Bindungsformular zwei getrennte Auswahlen: wer
 * eine Kachel anklickte, um sie zu benennen oder zu binden, sah weiter das
 * Formular des zuletzt in der LISTE angeklickten Elements - und tippte seine
 * Aenderung damit in ein anderes Element. Gemeldet wird nur eine BELEGTE Wahl;
 * ein Klick auf den leeren Grund (der Beginn einer Rahmenauswahl, E5) raeumt
 * das Formular nicht weg, denn er sagt nichts ueber das Element aus.
 */
watch(
  () => selectedIds.value[0] ?? null,
  (id) => {
    if (id) emit('select', id)
  },
)

/** Die Auswahl in der Reihenfolge der Seite - „zuerst gewaehlt" ist reproduzierbar. */
const selectionInPageOrder = computed(() =>
  widgets.value.filter((w) => selectedIds.value.includes(w.id)).map((w) => w.id),
)

/** Die ausgewaehlten Elemente, die eine Aenderung ueberhaupt annehmen (E8). */
const movableSelection = computed(() =>
  widgets.value.filter((w) => selectedIds.value.includes(w.id) && !widgetFlags(w).locked),
)

/* ---------------------------------------------------- Undo/Redo (E7) */

/** Der Zustand, den der Stapel traegt: Elemente UND Auswahl (siehe `snapshotOf`). */
function snapshot() {
  return snapshotOf(widgets.value, selectedIds.value)
}

/** Einen Zustand vom Stapel uebernehmen. */
function restore(state) {
  widgets.value = state.widgets.map((w) => ({ ...w }))
  selectedIds.value = [...state.selectedIds]
  guides.value = []
}

/**
 * Womit die letzte Aufzeichnung zu tun hatte - fuer das Zusammenfassen von
 * Tastenanschlaegen in DEMSELBEN Zahlenfeld (siehe {@link record}).
 */
let lastRecordTag = null

/**
 * Den JETZIGEN Zustand aufzeichnen, BEVOR er geaendert wird.
 *
 * Aufgerufen wird sie nur dort, wo wirklich etwas geschieht: ein Nudge, der an
 * einer Sperre scheitert, und ein Zug, der nie bewegt wurde, legen nichts auf
 * den Stapel. Sonst kostete das Zuruecknehmen einer Aenderung mehrere Tasten,
 * von denen die meisten nichts taeten - und E7 verlangt „jeder Schritt einzeln".
 *
 * MIT `tag` WIRD ZUSAMMENGEFASST. Die Koordinatenfelder melden bei JEDEM
 * Anschlag (`@input`, und daran haengt die Abnahme von C2); wer „120" tippt,
 * legte sonst drei Schritte auf den Stapel, von denen zwei Zwischenzahlen sind,
 * die der Autor nie sehen wollte. Aufeinanderfolgende Aenderungen an derselben
 * Zahl desselben Elements sind deshalb EIN Schritt; jede andere Aktion beendet
 * die Serie.
 */
function record(tag = null) {
  if (tag && lastRecordTag === tag) return
  recordChange(history, snapshot())
  lastRecordTag = tag
}

const canUndo = computed(() => history.past.length > 0)
const canRedo = computed(() => history.future.length > 0)

function undo() {
  const state = undoTo(history, snapshot())
  if (!state) return
  lastRecordTag = null
  restore(state)
}

function redo() {
  const state = redoTo(history, snapshot())
  if (!state) return
  lastRecordTag = null
  restore(state)
}

/* ------------------------------------------------------- Gruppen (E5) */

/** Je Gruppe ein Rahmen - das Sichtbare einer Gruppe (nur im Pixel-Modus). */
const groupBoxes = computed(() => (isPixel.value ? groupFrames(widgets.value) : []))

/**
 * Ist die Auswahl SCHON genau eine Gruppe?
 *
 * Dann aendert „Gruppieren" nichts, und die Schaltflaeche sagt das auch: bis
 * Runde 2 legte dreimal Gruppieren derselben Auswahl DREI Schritte auf den
 * Stapel, von denen zwei nichts taten - „Rueckgaengig" musste man dann mehrfach
 * druecken und sah dabei zweimal nichts geschehen. Zu einer Gruppe gehoert
 * beides: alle Gewaehlten tragen dieselbe Marke, UND keine fremde Kachel traegt
 * sie auch. Sonst waere das Herausloesen einer Teilmenge in eine eigene Gruppe
 * versperrt.
 */
const selectionIsOneGroup = computed(() => {
  const wanted = new Set(selectedIds.value)
  if (wanted.size < 2) return false
  const gruppen = new Set(widgets.value.filter((w) => wanted.has(w.id)).map((w) => groupIdOf(w)))
  if (gruppen.size !== 1) return false
  const [gruppe] = [...gruppen]
  if (!gruppe) return false
  return widgets.value.every((w) => groupIdOf(w) !== gruppe || wanted.has(w.id))
})
const canGroup = computed(() => selectedIds.value.length >= 2 && !selectionIsOneGroup.value)
const canUngroup = computed(() =>
  widgets.value.some((w) => selectedIds.value.includes(w.id) && groupIdOf(w)),
)

function groupSelection() {
  if (!canGroup.value) return
  record()
  const gruppe = newEditorId()
  const wanted = new Set(selectedIds.value)
  widgets.value = widgets.value.map((w) => (wanted.has(w.id) ? withGroup(w, gruppe) : w))
}

function ungroupSelection() {
  if (!canUngroup.value) return
  record()
  const wanted = new Set(selectedIds.value)
  widgets.value = widgets.value.map((w) => (wanted.has(w.id) ? withGroup(w, null) : w))
}

/* ------------------------------------- Kopieren, Einfuegen, Duplizieren (E6) */

/**
 * Der Versatz, mit dem eine Kopie neben ihrem Original landet: die Rasterweite.
 * Exakt uebereinander waere sie unauffindbar, und ein fester Betrag laege bei
 * grobem Raster daneben - so bleibt die Kopie auf dem Raster der Seite.
 */
function pasteOffset() {
  return Math.max(1, Number(settings.grid) || 1)
}

/** Die Kopien anhaengen und AUSWAEHLEN - der naechste Zug gilt ihnen, nicht dem Original. */
function appendCopies(copies) {
  if (copies.length === 0) return
  record()
  widgets.value = [...widgets.value, ...ensureBoxes(copies)]
  selectedIds.value = copies.map((w) => w.id)
}

function copySelection() {
  if (selectedIds.value.length === 0) return
  const wanted = new Set(selectedIds.value)
  writeClipboard(widgets.value.filter((w) => wanted.has(w.id)))
}

function pasteClipboard() {
  const items = readClipboard()
  if (items.length === 0) return
  appendCopies(
    copiesOf(
      items,
      items.map((w) => w.id),
      { offset: pasteOffset() },
    ),
  )
}

function duplicateSelection() {
  if (selectedIds.value.length === 0) return
  appendCopies(copiesOf(widgets.value, selectedIds.value, { offset: pasteOffset() }))
}

/* ------------------------------------------------------------------ aendern */

function patchWidget(id, patch) {
  widgets.value = widgets.value.map((w) => (w.id === id ? { ...w, ...patch } : w))
}

/**
 * NUR AUFZEICHNEN, WENN SICH ETWAS AENDERT - dieselbe Linie wie beim Zug
 * ({@link noteDragChange}). Wer die Zahl tippt, die schon dasteht, bekommt
 * keinen Schritt auf den Stapel; wer sie aendert, genau einen (das Zusammenfassen
 * ueber `tag` besorgt den Rest).
 */
function setCoordinate(key, value) {
  if (!selected.value) return
  const n = Number(value)
  const naechster = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (selected.value[key] === naechster) return
  record(`coord:${selected.value.id}:${key}`)
  patchWidget(selected.value.id, { [key]: naechster })
}

function setFlag(key, value) {
  if (!selected.value) return
  const id = selected.value.id
  // Das Ankreuzfeld haengt an `:checked`, nicht an `v-model`: es kann ein
  // `change` schicken, das den Wert traegt, der schon steht. Der zaehlt nicht.
  if (widgetFlags(selected.value)[key] === value) return
  record()
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

/** Die schon vorderste (bzw. hinterste) Kachel noch weiter zu schieben, ist nichts. */
function toFront() {
  if (!selected.value) return
  const liste = widgets.value
  if (liste.length > 0 && liste[liste.length - 1].id === selected.value.id) return
  record()
  widgets.value = bringToFront(liste, selected.value.id)
}

function toBack() {
  if (!selected.value) return
  const liste = widgets.value
  if (liste.length > 0 && liste[0].id === selected.value.id) return
  record()
  widgets.value = sendToBack(liste, selected.value.id)
}

function distribute() {
  const next = distributeHorizontally(widgets.value, selectionInPageOrder.value)
  if (!next) return
  if (widgets.value.every((w) => next[w.id] === undefined || next[w.id] === w.x)) return
  record()
  widgets.value = widgets.value.map((w) => (next[w.id] === undefined ? w : { ...w, x: next[w.id] }))
}

function equalSize() {
  const next = matchSize(widgets.value, selectionInPageOrder.value)
  if (!next) return
  if (
    widgets.value.every(
      (w) => next[w.id] === undefined || (next[w.id].w === w.w && next[w.id].h === w.h),
    )
  ) {
    return
  }
  record()
  widgets.value = widgets.value.map((w) => (next[w.id] === undefined ? w : { ...w, ...next[w.id] }))
}

/* --------------------------------------------------------- ziehen und tippen */

/**
 * DER LAUFENDE ZUG - fuer Maus UND Finger derselbe (E14).
 *
 * Das ist die ganze Begruendung dafuer, warum ein Touch-Zug um DIESELBE Distanz
 * bewegt wie ein Maus-Zug: es gibt nur EINE Rechnung. Die Zeiger-Ereignisse
 * unterscheiden sich allein darin, WO die Koordinaten stehen (`ev.clientX` beim
 * einen, `ev.touches[0].clientX` beim anderen); ab {@link startElementDrag} und
 * {@link applyDrag} laeuft beides durch denselben Code, dieselbe Rasterweite und
 * dasselbe {@link snapBox}/{@link snapSize}. Zwei Nachbildungen derselben
 * Bewegung koennten auseinanderlaufen; diese kann es nicht.
 */
let drag = null

/** Der erste Beruehrungspunkt eines Touch-Ereignisses, in Fensterkoordinaten. */
function touchPoint(ev) {
  const points = (ev.touches && ev.touches.length ? ev.touches : ev.changedTouches) || []
  const point = points[0]
  return point ? { x: point.clientX, y: point.clientY } : null
}

/**
 * Auf welches Element die Auswahl beim Loslassen zusammenfaellt, falls der Zug
 * ein blosser Klick bleibt - siehe {@link startElementDrag} und {@link endDrag}.
 */
let collapseTo = null

/**
 * Einen Zug am Element beginnen: waehlen, und im Pixel-Modus die Ausgangslage
 * jedes MITGEZOGENEN Elements festhalten.
 *
 * WER SCHON ZUR AUSWAHL GEHOERT, ZIEHT SIE MIT. Das ist das Gruppenverschieben
 * aus E5 und die Korrektur aus Runde 2: bis dahin waehlte JEDER Zug zuerst neu
 * (`select` schrumpft ohne Umschalttaste auf ein Element) und las die Mitzieher
 * erst DANACH - die angefasste Kachel wanderte allein, und die uebrige Auswahl
 * war stillschweigend verworfen. Per Rahmen liess sich damit einsammeln, aber
 * nicht verschieben; genau diese Verbindung meint E5. Ein Zug an einem Element
 * AUSSERHALB der Auswahl waehlt weiterhin neu.
 *
 * EIN KLICK OHNE BEWEGUNG sammelt die Auswahl trotzdem auf das angefasste
 * Element ein ({@link endDrag}) - so verhalten sich die belegten Champions, und
 * ohne diesen Rueckweg fuehrte von einer Mehrfachauswahl kein Weg mehr zu einer
 * einzelnen Kachel ausser ueber den leeren Grund.
 *
 * Festgehalten wird die Lage VOR dem Zug, damit jede Bewegung absolut aus dem
 * Ausgangspunkt gerechnet wird: eine Kette relativer Schritte sammelte bei jedem
 * Einrasten einen Rest, und die Kacheln liefen auseinander.
 */
function startElementDrag(widget, clientX, clientY, additive) {
  drag = null
  collapseTo = null
  const gehoertDazu = isSelected(widget.id)
  if (additive === true || !gehoertDazu) select(widget.id, additive === true)
  else if (selectedIds.value.length > 1) collapseTo = widget.id
  if (!isPixel.value) {
    drag = { kind: 'order', id: widget.id }
    return
  }
  if (widgetFlags(widget).locked) return
  drag = {
    kind: 'move',
    id: widget.id,
    startX: clientX,
    startY: clientY,
    origin: { x: widget.x, y: widget.y },
    // Mitgezogen wird nur, wenn das angefasste Element selbst gewaehlt ist. Ein
    // Umschalt-Klick, der es gerade ABgewaehlt hat, zieht es allein - sonst
    // bewegte ausgerechnet das Abwaehlen die uebrige Auswahl mit.
    others: isSelected(widget.id)
      ? movableSelection.value
          .filter((w) => w.id !== widget.id)
          .map((w) => ({ id: w.id, x: w.x, y: w.y }))
      : [],
    before: snapshot(),
    committed: false,
  }
}

/** Dasselbe fuer den Anfasser: er zieht die MASSE, nie die Lage. */
function startResizeDrag(widget, clientX, clientY) {
  drag = null
  collapseTo = null
  select(widget.id)
  if (!isPixel.value || widgetFlags(widget).locked) return
  drag = {
    kind: 'resize',
    id: widget.id,
    startX: clientX,
    startY: clientY,
    origin: { w: widget.w, h: widget.h },
    before: snapshot(),
    committed: false,
  }
}

/**
 * Den Zug auf dem Stapel vermerken - EINMAL, und nur wenn er wirklich etwas
 * bewegt hat.
 *
 * Ein Zug schickt Dutzende Ereignisse; jedes einzeln aufzuzeichnen hiesse, dass
 * ein einziges Verschieben Dutzende Male zurueckgenommen werden muesste (E7:
 * „jeder Schritt einzeln" meint einen Zug, nicht ein Ereignis). Und ein Klick
 * OHNE Bewegung legt gar nichts auf den Stapel - sonst haette ein blosses
 * Auswaehlen eine Geschichte.
 */
function noteDragChange(changed) {
  if (!drag || drag.committed || !changed) return
  // Ab hier ist es ein Zug und kein Klick mehr - die Auswahl bleibt stehen.
  collapseTo = null
  recordChange(history, drag.before)
  lastRecordTag = null
  drag.committed = true
}

/**
 * Den Zug auswerten. `node` ist das Element unter dem Zeiger - im responsiven
 * Modus sagt es, wohin einsortiert wird; per Finger liegt es nicht im Ereignis
 * (ein Touch bleibt bei dem Element, auf dem er begann) und wird deshalb ueber
 * den Punkt gesucht.
 */
function applyDrag(clientX, clientY, node) {
  if (!drag) return
  if (drag.kind === 'move') {
    const box = snapBox(drag.origin, clientX - drag.startX, clientY - drag.startY, settings.grid)
    const dx = box.x - drag.origin.x
    const dy = box.y - drag.origin.y
    const jetzt = widgets.value.find((w) => w.id === drag.id)
    noteDragChange(Boolean(jetzt) && (jetzt.x !== box.x || jetzt.y !== box.y))
    widgets.value = widgets.value.map((w) => {
      if (w.id === drag.id) return { ...w, ...box }
      const mit = drag.others.find((o) => o.id === w.id)
      // DIESELBE DISTANZ fuer alle: der gezogene bestimmt sie (samt Einrasten),
      // die uebrigen folgen ihm um genau diesen Betrag. Wuerde jeder fuer sich
      // einrasten, zoege eine Auswahl beim Verschieben ihre Abstaende zusammen.
      return mit ? { ...w, x: Math.max(0, mit.x + dx), y: Math.max(0, mit.y + dy) } : w
    })
    guides.value = guidesFor(widgets.value, drag.id, GUIDE_TOLERANCE)
    return
  }
  if (drag.kind === 'resize') {
    const size = snapSize(drag.origin, clientX - drag.startX, clientY - drag.startY, settings.grid)
    const jetzt = widgets.value.find((w) => w.id === drag.id)
    noteDragChange(Boolean(jetzt) && (jetzt.w !== size.w || jetzt.h !== size.h))
    patchWidget(drag.id, size)
    guides.value = guidesFor(widgets.value, drag.id, GUIDE_TOLERANCE)
    return
  }
  if (drag.kind === 'marquee') {
    marquee.value = { from: drag.from, to: toSurface(clientX, clientY) }
    const rect = normalizeRect(marquee.value.from, marquee.value.to)
    selectedIds.value = expandToGroups(widgets.value, idsInRect(widgets.value, rect))
    return
  }
  // Responsiver Modus: das Element unter dem Zeiger sagt, wohin es einsortiert
  // wird. Kein HTML5-Drag - der Harness fuehrt echte Zeigerereignisse.
  const host = node && node.closest ? node.closest('[data-el]') : null
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

function endDrag() {
  // Der Zug blieb ein Klick auf ein Mitglied der Auswahl: sie faellt jetzt auf
  // dieses eine Element zusammen (siehe {@link startElementDrag}).
  const einsammeln = collapseTo
  collapseTo = null
  if (einsammeln) select(einsammeln, false)
  if (!drag) return
  drag = null
  marquee.value = null
  guides.value = []
}

/* ---------------------------------------------------------- Maus und Finger */

function onElementMouseDown(widget, ev) {
  if (ev.button !== undefined && ev.button !== 0) return
  startElementDrag(widget, ev.clientX, ev.clientY, ev.shiftKey === true)
}

/**
 * Die Kantenlaenge des Anfassers in CSS-Pixeln - dieselbe Zahl wie `h-2 w-2` an
 * ihm (0,5 rem). Sie steht hier, weil der Rueckzug unten eine RECHNUNG ist und
 * kein `elementFromPoint`: gefragt wird, WAS der Anfasser ganz zudeckt, und dazu
 * muss man wissen, wie gross er ist.
 */
const HANDLE_SIZE = 8

/** Die Flaeche des Anfassers in Flaechenkoordinaten (siehe {@link resizeHandleStyle}). */
function resizeHandleRect(widget) {
  return {
    x: widget.x + Math.max(1, widget.w),
    y: widget.y + Math.max(1, widget.h),
    w: HANDLE_SIZE,
    h: HANDLE_SIZE,
  }
}

/**
 * WOVOR DER ANFASSER ZURUECKTRITT - und wovor eben NICHT.
 *
 * Die Korrektur aus Runde 3. Bis dahin trat er vor JEDER Kachel zurueck, die
 * unter ihm lag, und das war viel zu weit: im lueckenlosen Raster, das dieser
 * Editor mit seinem Einrasten selbst erzeugt, liegt seine gesamte Flaeche auf
 * der diagonalen Nachbarin (vier Kacheln 40x40 an 0/0, 40/0, 0/40, 40/40: der
 * Anfasser von (0,0) beginnt genau auf (40,40)). Kein einziger seiner 64 Pixel
 * war frei, die Kachel liess sich am Anfasser gar nicht mehr vergroessern, und
 * ein Zug daran verschob stattdessen die Nachbarin (gemessen in der Kritik zu
 * Runde 2). Auf einer Unterlage dasselbe: der Zug am Anfasser einer kleinen
 * Kachel zog das ganze Panel weg.
 *
 * GESUCHT WIRD WEITERHIN DIE KACHEL UNTER DEM AUFSETZPUNKT - also die, der der
 * Zeiger ohne den Anfasser gehoert haette. Neu sind die ZWEI BEDINGUNGEN, unter
 * denen er ihr den Punkt ueberhaupt ueberlaesst; beide muessen gelten:
 *
 *  1. SIE STEHT VOR DER EIGENEN KACHEL (Z-Ordnung; die Reihenfolge der Liste ist
 *     sie). Was HINTER der eigenen liegt, darf den Anfasser nicht verdraengen -
 *     eine Unterlage ist der Grund, auf dem gearbeitet wird, und nicht das Ziel
 *     eines Klicks auf den Anfasser der Kachel darauf. Ohne diese Bedingung zog
 *     der Anfasser einer kleinen Kachel das ganze Panel unter ihr weg.
 *  2. DER ANFASSER LIESSE IHR NICHTS. Er tritt nur zurueck, wenn sie
 *     VOLLSTAENDIG unter ihm verschwindet, also selbst keinen freien Pixel mehr
 *     haette. Genau das ist der Fall aus Runde 1: die Kacheln der
 *     M5-Beispielwelt messen 3x2 Autoreneinheiten, der Anfasser 8x8 - er
 *     schluckt eine ganze Nachbarkachel, und ein Klick auf sie waere sonst
 *     unmoeglich. Bleibt ihr auch nur ein Pixel, ist sie DORT erreichbar und der
 *     Anfasser hier: 8x8 auf einer 40x40-Kachel nehmen ihr vier Prozent, und
 *     dafuer die einzige Maus-Geste zum Vergroessern aufzugeben, waere ein
 *     schlechter Tausch.
 *
 * Trifft die oberste Kachel unter dem Punkt eine der beiden Bedingungen nicht,
 * behaelt der Anfasser den Zeiger - es wird NICHT weiter nach unten gesucht.
 * Gefragt ist genau eine Kachel: die, die der Punkt sonst getroffen haette.
 */
function handleCedesTo(widget, clientX, clientY) {
  const at = toSurface(clientX, clientY)
  const griff = resizeHandleRect(widget)
  const eigen = widgets.value.findIndex((w) => w && w.id === widget.id)
  if (eigen < 0) return null
  for (let i = widgets.value.length - 1; i > eigen; i -= 1) {
    const w = widgets.value[i]
    if (!w || !hasBox(w)) continue
    const breite = Math.max(1, w.w)
    const hoehe = Math.max(1, w.h)
    if (at.x < w.x || at.x >= w.x + breite) continue
    if (at.y < w.y || at.y >= w.y + hoehe) continue
    if (w.x < griff.x || w.x + breite > griff.x + griff.w) return null
    if (w.y < griff.y || w.y + hoehe > griff.y + griff.h) return null
    return w
  }
  return null
}

/**
 * Der Anfasser unten rechts (E14, `data-resize="se"`): er zieht die MASSE, nicht
 * die Lage. Bis Runde 1 hatte er keinen Handler - ein Zug daran blubberte an das
 * `mousedown` des Elternelements und VERSCHOB das Element. Eine Affordanz, die
 * etwas anderes tut, als sie zeigt; deshalb faengt `stopPropagation` das Ereignis
 * hier ab, und an einem gesperrten Element wird der Anfasser gar nicht erst
 * gezeigt.
 *
 * ER TRITT ZURUECK, WO ER EINER NACHBARIN NICHTS LIESSE - und nur dort. Seit
 * Runde 2 sitzt er vollstaendig ausserhalb seiner Kachel (siehe
 * {@link resizeHandleStyle}), und dort kann eine Nachbarkachel stehen; die
 * Beispielwelt legt sie im Abstand von zwei Einheiten uebereinander, und ein
 * Klick auf sie landete in Runde 1 zweimal auf dem Anfasser. Wann genau er ihr
 * den Zeiger ueberlaesst, entscheidet {@link handleCedesTo}; dort steht auch,
 * warum der Rueckzug in Runde 2 zu weit ging.
 */
function onResizeMouseDown(widget, ev) {
  if (ev.button !== undefined && ev.button !== 0) return
  ev.stopPropagation()
  const darunter = handleCedesTo(widget, ev.clientX, ev.clientY)
  if (darunter) {
    startElementDrag(darunter, ev.clientX, ev.clientY, ev.shiftKey === true)
    return
  }
  startResizeDrag(widget, ev.clientX, ev.clientY)
}

/**
 * DER FINGER (E14). `preventDefault` ist hier keine Kosmetik: ohne es schickt
 * der Browser nach dem Loslassen noch eine Runde nachgebauter Mausereignisse
 * hinterher (`mousedown`/`mouseup`/`click`), und die begaennen einen zweiten Zug
 * auf demselben Element.
 */
function onElementTouchStart(widget, ev) {
  const at = touchPoint(ev)
  if (!at) return
  if (typeof ev.preventDefault === 'function') ev.preventDefault()
  startElementDrag(widget, at.x, at.y, ev.shiftKey === true)
}

function onResizeTouchStart(widget, ev) {
  const at = touchPoint(ev)
  if (!at) return
  ev.stopPropagation()
  if (typeof ev.preventDefault === 'function') ev.preventDefault()
  const darunter = handleCedesTo(widget, at.x, at.y)
  if (darunter) {
    startElementDrag(darunter, at.x, at.y, ev.shiftKey === true)
    return
  }
  startResizeDrag(widget, at.x, at.y)
}

function onWindowMouseMove(ev) {
  if (!drag) return
  applyDrag(ev.clientX, ev.clientY, ev.target)
}

function onWindowTouchMove(ev) {
  if (!drag) return
  const at = touchPoint(ev)
  if (!at) return
  // Waehrend eines Zugs gehoert die Geste dem Canvas und nicht dem Rollbalken.
  if (ev.cancelable && typeof ev.preventDefault === 'function') ev.preventDefault()
  const node =
    typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(at.x, at.y)
      : null
  applyDrag(at.x, at.y, node)
}

function onWindowMouseUp() {
  endDrag()
}

/* --------------------------------------------------- Rahmenauswahl (E5) */

/** Ein Punkt in Fensterkoordinaten, umgerechnet auf die Zeichenflaeche. */
function toSurface(clientX, clientY) {
  const node = surface.value
  const rect =
    node && typeof node.getBoundingClientRect === 'function'
      ? node.getBoundingClientRect()
      : { left: 0, top: 0 }
  return { x: Math.round(clientX - rect.left), y: Math.round(clientY - rect.top) }
}

/**
 * Ein Zug auf dem LEEREN GRUND zieht einen Rahmen (E5).
 *
 * Beginnt der Zug auf einer Kachel, gehoert er ihr - dort wird verschoben, und
 * genau das prueft E1. Die Unterscheidung haengt deshalb am Ziel des Ereignisses
 * und nicht an einer Sondertaste: ein Rahmen, den man nur mit gedrueckter
 * Taste bekaeme, waere eine versteckte Faehigkeit.
 */
function onCanvasMouseDown(ev) {
  if (ev.button !== undefined && ev.button !== 0) return
  if (!beginsOnEmptyGround(ev)) return
  beginMarquee(ev.clientX, ev.clientY)
}

/**
 * DERSELBE RAHMEN MIT DEM FINGER (E5 auf einem Touch-Geraet).
 *
 * Der Harness faehrt den Editor bei 393x851 und nimmt ihn in E14 ausdruecklich
 * als Touch-Geraet ab. Bliebe der Rahmen der Maus vorbehalten, gaebe es dort
 * ueberhaupt keine Mehrfachauswahl per Zeiger - und „Gruppieren" waere eine
 * Schaltflaeche, die man nie benutzen kann. Gerechnet wird danach dasselbe wie
 * bei der Maus; wie beim Ziehen gibt es nur EINE Rechnung.
 *
 * OHNE `preventDefault` HIER, mit Absicht: der leere Grund soll sich mit dem
 * Finger weiterhin rollen lassen. Sobald der Rahmen wirklich gezogen wird,
 * nimmt {@link onWindowTouchMove} die Geste an sich - und damit entfaellt auch
 * die nachgereichte Runde Mausereignisse, die sonst nach dem Loslassen die
 * frische Auswahl wieder geleert haette.
 */
function onCanvasTouchStart(ev) {
  const at = touchPoint(ev)
  if (!at) return
  if (!beginsOnEmptyGround(ev)) return
  beginMarquee(at.x, at.y)
}

/** Beginnt dieser Zug wirklich auf dem leeren Grund - und darf er es? */
function beginsOnEmptyGround(ev) {
  if (!isPixel.value) return false
  const node = ev.target
  return !(node && typeof node.closest === 'function' && node.closest('[data-el]'))
}

function beginMarquee(clientX, clientY) {
  const at = toSurface(clientX, clientY)
  drag = { kind: 'marquee', from: at }
  collapseTo = null
  marquee.value = { from: at, to: at }
  // Ein Klick ins Leere leert die Auswahl - auch dann, wenn kein Rahmen folgt.
  selectedIds.value = []
}

/** Der gezeichnete Rahmen, in Koordinaten der Zeichenflaeche. */
const marqueeRect = computed(() =>
  marquee.value ? normalizeRect(marquee.value.from, marquee.value.to) : null,
)

/* ----------------------------------------------------------------- tastatur */

const NUDGE = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * Steht der Zeiger gerade in einem Eingabefeld?
 *
 * Dann gehoeren die Tasten dem Feld. Ohne diese Frage verschoebe eine Pfeiltaste
 * im X-Feld das Element UND aenderte die Zahl, und ein Strg+C im
 * Breakpoint-Feld kopierte Kacheln statt Text.
 */
function isTextEntry(node) {
  if (!node || typeof node !== 'object') return false
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return node.isContentEditable === true
}

function onWindowKeyDown(ev) {
  if (!loaded.value) return
  if (isTextEntry(ev.target)) return
  const key = typeof ev.key === 'string' ? ev.key.toLowerCase() : ''
  if (ev.ctrlKey || ev.metaKey) {
    if (key === 'a') {
      ev.preventDefault()
      selectedIds.value = widgets.value.map((w) => w.id)
      return
    }
    if (key === 'z') {
      ev.preventDefault()
      if (ev.shiftKey) redo()
      else undo()
      return
    }
    if (key === 'y') {
      ev.preventDefault()
      redo()
      return
    }
    if (key === 'c') {
      if (selectedIds.value.length === 0) return
      ev.preventDefault()
      copySelection()
      return
    }
    if (key === 'v') {
      ev.preventDefault()
      pasteClipboard()
      return
    }
    if (key === 'd') {
      ev.preventDefault()
      duplicateSelection()
      return
    }
    return
  }
  const step = NUDGE[ev.key]
  if (!step || !isPixel.value || selectedIds.value.length === 0) return
  const vorher = snapshot()
  const { widgets: next, moved } = nudged(widgets.value, selectedIds.value, step[0], step[1])
  // Nichts bewegt (alles gesperrt, alles am Ursprung)? Dann ist die Taste nicht
  // verbraucht und es gehoert nichts auf den Stapel.
  if (!moved) return
  recordChange(history, vorher)
  lastRecordTag = null
  widgets.value = next
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

/**
 * Die AUSGEBLENDETEN Kacheln nach oben melden (E8, Integration C2+C3).
 *
 * Der Entwurf oben laesst sie schon weg. Das genuegt aber nur, solange dieser
 * Canvas der einzige ist, der einen Entwurf schickt - der Autorenteil (C3)
 * schickt seinen eigenen, und der kennt das Ausblenden nicht. Die Ansicht legt
 * beide zusammen (`utils/visuEditorDraftMerge.js`) und braucht dafuer die Ids
 * ausdruecklich: ein Element, das nicht da ist, ist von einem, das gerade erst
 * aus der Palette kam, sonst nicht zu unterscheiden.
 */
watch(
  () => widgets.value.filter((w) => widgetFlags(w).hidden).map((w) => w.id),
  (ids) => emit('hidden-ids', ids),
  { deep: true, immediate: true },
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

/**
 * Die Zeigerereignisse haengen am FENSTER, nicht am Element: ein Zug, der den
 * Canvas verlaesst, soll weiterlaufen und beim Loslassen enden, auch wenn der
 * Zeiger dann woanders steht. `touchmove` bekommt ausdruecklich `passive:
 * false`, weil der Zug waehrend seiner Dauer die Geste besitzt - sonst rollt
 * unter dem Finger die Seite weg.
 */
onMounted(() => {
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup', onWindowMouseUp)
  window.addEventListener('touchmove', onWindowTouchMove, { passive: false })
  window.addEventListener('touchend', onWindowMouseUp)
  window.addEventListener('touchcancel', onWindowMouseUp)
  window.addEventListener('keydown', onWindowKeyDown)
  load()
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('touchmove', onWindowTouchMove)
  window.removeEventListener('touchend', onWindowMouseUp)
  window.removeEventListener('touchcancel', onWindowMouseUp)
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

/**
 * WO DER ANFASSER LIEGT: vollstaendig AUSSERHALB seiner Kachel, mit der linken
 * oberen Ecke genau auf ihrer rechten unteren.
 *
 * Das ist die Korrektur aus Runde 2. Eine Kachel der M5-Beispielwelt misst 3x2
 * Autoreneinheiten, also 3x2 CSS-Pixel; ein 8x8 grosser Anfasser AUF dieser Ecke
 * verdeckte sie vollstaendig und ragte 4 px in die Nachbarschaft. Ein Zug in der
 * Kachelmitte vergroesserte sie dann, statt sie zu verschieben (gemessen
 * 3x2 → 40x1), und ein Klick auf die Nachbarkachel landete auf dem Anfasser. Ein
 * Anfasser, der die Flaeche verdeckt, an der er haengt, ist keine Affordanz.
 *
 * DIE RECHNUNG: die Kachel traegt 1 px Rahmen und rechnet in `border-box`; der
 * Bezugsrahmen eines absolut gesetzten Kindes ist ihr INNENkasten, der also um
 * genau diesen einen Pixel eingerueckt liegt. `w - 1` landet damit auf `x + w`,
 * `h - 1` auf `y + h` - die Aussenkante, ohne einen Pixel Ueberdeckung, und zwar
 * bei jeder Kachelgroesse. Was er dort verdeckt, gibt er wieder her (siehe
 * {@link onResizeMouseDown}).
 */
function resizeHandleStyle(widget) {
  return {
    left: `${Math.max(1, widget.w) - 1}px`,
    top: `${Math.max(1, widget.h) - 1}px`,
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
          class="shrink-0 rounded bg-sky-600 px-2 py-1 text-sm whitespace-nowrap text-white disabled:opacity-40"
          :disabled="jsonError !== null"
          @click="save"
        >
          {{ $t('visuEditor.canvas.save') }}
        </button>
      </div>
    </div>

    <!--
      DIE ERGONOMIE-LEISTE (Teil C5, Issue #172): dieselben Faehigkeiten, die
      auch auf Tasten liegen (Strg+Z/Y, Strg+D, Strg+C/V), zusaetzlich als
      Schaltflaeche. Eine Faehigkeit, die es NUR auf einer Tastenkombination
      gibt, findet nur, wer sie schon kennt - und auf einem Touch-Geraet (E14)
      gibt es sie dann gar nicht.

      Eigene Zeile, weil die Leiste darueber auf einem 393px breiten Geraet
      schon waagerecht rollt; sie rollt hier ebenso, statt umzubrechen und den
      Canvas nach unten zu schieben.
    -->
    <div class="flex items-center gap-2 overflow-x-auto pb-1">
      <button
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="!canUndo"
        @click="undo"
      >
        {{ $t('visuEditor.canvas.undo') }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="!canRedo"
        @click="redo"
      >
        {{ $t('visuEditor.canvas.redo') }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="selectedIds.length === 0"
        @click="duplicateSelection"
      >
        {{ $t('visuEditor.canvas.duplicate') }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="selectedIds.length === 0"
        @click="copySelection"
      >
        {{ $t('visuEditor.canvas.copy') }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        @click="pasteClipboard"
      >
        {{ $t('visuEditor.canvas.paste') }}
      </button>
      <button
        v-if="isPixel"
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="!canGroup"
        @click="groupSelection"
      >
        {{ $t('visuEditor.canvas.group') }}
      </button>
      <button
        v-if="isPixel"
        type="button"
        class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="!canUngroup"
        @click="ungroupSelection"
      >
        {{ $t('visuEditor.canvas.ungroup') }}
      </button>
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
      <!--
        Die Beschwerde ueber den Text steht in der IMMER sichtbaren Zeile, nicht
        im JSON-Kasten: sonst verschwaende sie beim Wechsel auf „Visuell", und
        der Autor saehe dort den alten Stand in dem Glauben, seine Eingabe sei
        angekommen. Solange sie steht, ist auch „Speichern" gesperrt.
      -->
      <span
        v-if="jsonError"
        data-testid="editor-json-error"
        class="text-amber-600 dark:text-amber-400"
      >
        {{
          jsonError === 'syntax'
            ? $t('visuEditor.canvas.jsonSyntaxError')
            : $t('visuEditor.canvas.jsonShapeError')
        }}
      </span>
    </div>

    <!--
      DIE ZWEITE ANSICHT DERSELBEN SEITE (M5 C6, Issue #173, E13). Die Reiter
      schalten nur um, WAS gezeigt wird; der Entwurf darunter ist EINER, und
      gespeichert wird weiterhin ueber den einen Knopf oben. Der visuelle
      Bereich wird mit `v-show` versteckt und nicht ausgehaengt: `.editor-canvas`
      ist die Marke, an der der Harness „der Editor steht" liest, und sie soll
      nicht davon abhaengen, welcher Reiter gerade offen ist.
    -->
    <div
      role="tablist"
      class="flex items-center gap-1 text-sm"
      :aria-label="$t('visuEditor.canvas.views')"
    >
      <button
        v-for="entry in [
          { id: VIEW_VISUAL, label: $t('visuEditor.canvas.tabVisual') },
          { id: VIEW_JSON, label: $t('visuEditor.canvas.tabJson') },
        ]"
        :key="entry.id"
        type="button"
        role="tab"
        :aria-selected="view === entry.id ? 'true' : 'false'"
        :data-view="entry.id"
        class="rounded-t border-b-2 px-2 py-1"
        :class="
          view === entry.id
            ? 'border-sky-500 text-slate-800 dark:text-slate-100'
            : 'border-transparent text-slate-500 dark:text-slate-400'
        "
        @click="view = entry.id"
      >
        {{ entry.label }}
      </button>
    </div>

    <div
      v-if="view === VIEW_JSON"
      class="flex flex-col gap-1"
    >
      <label
        for="editor-canvas-json"
        class="text-xs text-slate-500 dark:text-slate-400"
      >{{ $t('visuEditor.canvas.jsonLabel') }}</label>
      <textarea
        id="editor-canvas-json"
        class="editor-json min-h-[280px] w-full rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs text-slate-800 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-100"
        spellcheck="false"
        :value="jsonText"
        @input="onJsonInput($event.target.value)"
      />
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('visuEditor.canvas.jsonHint') }}
      </p>
    </div>

    <div
      v-show="view === VIEW_VISUAL"
      class="flex flex-wrap gap-3"
    >
      <!--
        DER CANVAS-KASTEN erscheint erst, wenn die Seite WIRKLICH geladen ist.

        Er ist die Marke, an der der Playwright-Harness „der Editor steht"
        abliest (`openEditor` in `apps/visu/e2e/editor-helpers.ts`). Stand sie
        schon da, waehrend die Seite noch unterwegs war, dann zaehlte ein
        Szenario seine Elemente auf einer leeren Flaeche und arbeitete danach am
        falschen Ausgangswert weiter - dieselbe Bauart Fehler wie eine
        Erfolgsmeldung, die vom vorigen Mal stehen geblieben ist. Ohne Seite (der
        Zustand von E9/E15) traegt der Platzhalter der Ansicht die Marke.

        DER ZUG AUF DEM LEEREN GRUND gehoert dem Kasten: hier beginnt die
        Rahmenauswahl (E5). Die Kacheln liegen eine Ebene tiefer, damit dieser
        Grund ueberhaupt existiert - siehe `surface`.
      -->
      <div
        v-if="loaded"
        class="editor-canvas relative min-h-[280px] min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-white p-2 select-none dark:border-slate-700/60 dark:bg-slate-900"
        :class="isPixel ? 'overflow-auto' : ''"
        @mousedown="onCanvasMouseDown"
        @touchstart="onCanvasTouchStart"
      >
        <div
          ref="surface"
          class="editor-surface relative"
          :class="isPixel ? 'min-h-[256px]' : 'flex flex-col gap-2'"
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

          <!--
            Der Rahmen einer GRUPPE (E5): das Sichtbare daran. Er faengt keine
            Zeiger (`pointer-events-none`) - angefasst werden die Mitglieder,
            und ein Rahmen, der den Zug abfinge, machte die Kacheln darunter
            unerreichbar.
          -->
          <div
            v-for="frame in groupBoxes"
            :key="frame.id"
            :data-group="frame.id"
            class="pointer-events-none absolute border border-dashed border-fuchsia-500/70"
            :style="{
              left: `${frame.x - 2}px`,
              top: `${frame.y - 2}px`,
              width: `${frame.w + 4}px`,
              height: `${frame.h + 4}px`,
            }"
          />

          <div
            v-for="widget in widgets"
            :key="widget.id"
            :data-el="widget.id"
            :data-x="widget.x"
            :data-y="widget.y"
            :data-w="widget.w"
            :data-h="widget.h"
            class="border text-[10px] leading-none"
            :class="[
              isSelected(widget.id)
                ? 'is-selected border-sky-500 bg-sky-100 dark:bg-sky-900/40'
                : 'border-slate-400 bg-slate-100 dark:bg-slate-700',
              widgetFlags(widget).hidden ? 'opacity-40' : '',
              isPixel ? '' : 'cursor-move rounded px-2 py-3',
            ]"
            :style="elementStyle(widget)"
            @mousedown="onElementMouseDown(widget, $event)"
            @touchstart="onElementTouchStart(widget, $event)"
          >
            <span class="pointer-events-none block truncate">{{ widget.name }}</span>
            <!--
              DER ANFASSER SITZT NEBEN DER ECKE, nicht auf ihr: seine linke obere
              Ecke liegt genau auf der rechten unteren der Kachel, er verdeckt von
              ihr also nichts. Warum das so gerechnet wird und was er dafuer
              wieder hergeben muss, steht an `resizeHandleStyle` und
              `onResizeMouseDown`.

              Die Kachel beschneidet ihn deshalb auch nicht (kein
              `overflow-hidden`) - sie wuerde ihn sonst restlos wegschneiden. Der
              Name wird trotzdem beschnitten, das erledigt `truncate` an ihm
              selbst.

              `z-10` IST KEINE KOSMETIK, SONDERN DER GRUND, WARUM ES IHN GIBT:
              die Kacheln liegen alle auf `z-auto`, also malt der Browser sie in
              Dokumentreihenfolge, und der Anfasser gehoert zum Teilbaum SEINER
              Kachel. Ohne diese Zeile lag er unter jeder spaeteren Kachel - im
              lueckenlosen Raster also unter der diagonalen Nachbarin, die seine
              gesamte Flaeche deckt. Der Zeiger erreichte ihn dort gar nicht
              mehr, und der Zug traf die Nachbarin (Kritik Runde 2, im Browser
              gemessen: 0 von 64 Griffpixeln frei, `GA` unveraendert,
              `GD:40,40 → 80,80`). Was er dabei verdeckt, gibt er nach der Regel
              in {@link handleCedesTo} wieder her.
            -->
            <span
              v-if="isSelected(widget.id) && isPixel && !widgetFlags(widget).locked"
              data-resize="se"
              class="absolute z-10 h-2 w-2 cursor-se-resize bg-sky-500"
              :style="resizeHandleStyle(widget)"
              @mousedown="onResizeMouseDown(widget, $event)"
              @touchstart="onResizeTouchStart(widget, $event)"
            />
          </div>

          <div
            v-if="marqueeRect"
            class="editor-marquee pointer-events-none absolute border border-sky-500 bg-sky-500/10"
            :style="{
              left: `${marqueeRect.x}px`,
              top: `${marqueeRect.y}px`,
              width: `${marqueeRect.w}px`,
              height: `${marqueeRect.h}px`,
            }"
          />

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

          <!--
            Der Hinweis auf die leere Seite liegt IN der Zeichenflaeche und
            nimmt keinen Platz weg (`absolute`) - sonst schoebe er sie nach
            unten - und faengt keine Zeiger, damit der Rahmen (E5) auch ueber ihn
            hinweg aufgezogen werden kann.
          -->
          <p
            v-if="widgets.length === 0"
            class="pointer-events-none absolute inset-0 p-4 text-sm text-slate-400"
          >
            {{ $t('visuEditor.canvas.empty') }}
          </p>
        </div>
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
