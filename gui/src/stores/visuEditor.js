/**
 * Der Zustand des V2-Editors (M5 C1, Issue #168).
 *
 * Eine Quelle, ein Entwurf: der Store haelt den Baum (`GET /visu/tree`), die
 * geladenen Seiten-Konfigurationen und genau EINEN Entwurf - die Seite, die der
 * Autor gerade bearbeitet. Baum, Eigenschaftsformular und Vorschau lesen alle
 * denselben Entwurf; es gibt keine zweite Kopie, die auseinanderlaufen koennte.
 *
 * Die verbotenen Kombinationen greifen HIER, nicht erst im Backend: `problems`
 * ist die Liste aus `validatePage`, `canSave` haengt daran, und `save()` schickt
 * nichts los, solange etwas gemeldet ist (Messlatte E9/E15).
 *
 * Was der Store bewusst NICHT tut: Widgets und Positionen anfassen. Sie stehen
 * in derselben `page_config` und werden beim Speichern unveraendert
 * mitgeschrieben (`visuPageSavePlan`) - Teil C2/C3 fuellen sie.
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { visuApi } from '@/api/visu'
import { collectReferencedPageIds, toBackendKind, toEditorKind } from '@/utils/visuPageKind'
import { canMoveInto, neighbourSwap, siblingsOf } from '@/utils/visuPageTree'
import { planPageSave } from '@/utils/visuPageSavePlan'
import { validatePage } from '@/utils/visuPageValidation'
import {
  DEFAULT_VISU_SKIN,
  isKnownSkin,
  pageConfigCarriesSkin,
  readPageSkin,
  skinFromPageConfig,
  writePageSkin,
} from '@/utils/visuSkins'

/** Ein frischer Popup-Deskriptor - alle Felder, damit `PopupConfig` nichts raten muss. */
export function emptyPopup() {
  return {
    x: null,
    y: null,
    w: null,
    h: null,
    auto_close_ms: null,
    modal: false,
    animate: false,
    shadow: false,
    dim_backdrop: false,
  }
}

/** Der Meldungstext einer abgelehnten Anfrage - `detail` kann Text ODER Objekt sein. */
function rejectionText(error, fallback) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (detail && typeof detail === 'object' && typeof detail.code === 'string') return detail.code
  return fallback
}

/**
 * Die Einzelheiten einer Ablehnung (`{ code, usernames | username, datapoint_ids }`).
 *
 * Das Backend nennt bei 422/403 genau, WER oder WAS beanstandet wird. Ohne diese
 * Angaben bliebe dem Autor nur ein Code - mit ihnen kann der Editor den Satz
 * ausschreiben, den der Server meint.
 */
function rejectionDetail(error) {
  const detail = error?.response?.data?.detail
  return detail && typeof detail === 'object' ? detail : null
}

export const useVisuEditorStore = defineStore('visuEditor', () => {
  const nodes = ref([])
  const pageConfigs = ref({})
  const audience = ref({})
  const allUsernames = ref([])
  const selectedId = ref(null)
  const draft = ref(null)
  const loading = ref(false)
  const loadError = ref(false)
  const saveError = ref(null)
  const saveErrorDetail = ref(null)
  const savedAt = ref(0)
  // Ob die Nutzerliste ueberhaupt geladen ist. Ohne sie SCHWEIGT die
  // Zielgruppen-Pruefung: eine Bestandsseite darf nicht unspeicherbar werden,
  // nur weil `GET /auth/users` einmal gescheitert ist.
  const usernamesLoaded = ref(false)

  const nodeById = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
  const selectedNode = computed(() => nodeById.value.get(selectedId.value) ?? null)

  /** Welche Seiten irgendwo inkludiert werden - die Grundlage der Rolle „Inkludeseite". */
  const referencedIds = computed(() => collectReferencedPageIds(pageConfigs.value))

  /**
   * Wer wen inkludiert - mit dem UNGESPEICHERTEN Entwurf der aktuellen Seite,
   * damit Zyklus- und Popup-Pruefung das sehen, was der Autor gerade baut.
   */
  const includesById = computed(() => {
    const map = {}
    for (const [id, config] of Object.entries(pageConfigs.value)) {
      map[id] = Array.isArray(config?.includes) ? [...config.includes] : []
    }
    if (draft.value?.id) map[draft.value.id] = [...(draft.value.includes ?? [])]
    return map
  })

  /**
   * Der Skin der bearbeiteten Seite. Er steht IM ENTWURF, nicht daneben - sonst
   * gaebe es fuer denselben Wert zwei Quellen, und der Speicherplan saehe die
   * Wahl gar nicht (siehe `visuSkins.js`, Naht zu Teil C2).
   */
  const skin = computed(() => (isKnownSkin(draft.value?.skin) ? draft.value.skin : DEFAULT_VISU_SKIN))

  /** Fuehrt das Backend das Skin-Feld schon? Sichtbar an jeder geladenen Konfiguration. */
  const skinSupported = computed(() => Object.values(pageConfigs.value).some(pageConfigCarriesSkin))

  /**
   * Die GESPEICHERTEN Includes der bearbeiteten Seite.
   *
   * `validatePage` braucht sie, weil das Backend einen bereits gespeicherten
   * Eintrag bewusst nicht erneut gegen die Datenbank prueft
   * (`obs/api/v1/visu.py:415,419-420`, §2.1). Ohne diese Menge waere der Editor
   * strenger als das Backend und machte eine Bestandsseite mit verwaistem
   * Eintrag unspeicherbar (R17).
   */
  const storedIncludes = computed(() => {
    const config = draft.value?.id ? pageConfigs.value[draft.value.id] : null
    return Array.isArray(config?.includes) ? config.includes : []
  })

  /**
   * Bindet die bearbeitete Seite ueberhaupt Datenpunkte?
   *
   * Nur dann kann `_check_user_page_target_datapoint_policy` (`visu.py:555-580`)
   * beim Wechsel auf Zugriff „user" mit 403 ablehnen.
   *
   * Der Editor nimmt diese Ablehnung bewusst NICHT vorweg. Nicht, weil es keinen
   * Endpunkt gaebe - `POST /api/v1/authz/preview` (`obs/api/v1/authz.py:544`)
   * beantwortet genau diese Frage und kennt `node_type: "datapoint"`. Sondern
   * weil eine echte Vorwegnahme je Zielgruppen-Mitglied MAL Datenpunkt eine
   * Vorschau-Abfrage braeuchte, und zwar bei JEDEM Zugriffswechsel - und dem
   * Stand des Servers trotzdem hinterherliefe. Der Editor sagt dem Autor
   * deshalb, DASS geprueft wird, statt ihm hinterher einen Code zu zeigen; den
   * Ablehnungssatz samt Nutzer und Datenpunkt-IDs schreibt er ohnehin aus.
   *
   * Was diese Bedingung NICHT sieht: das Backend laeuft ueber JEDE Seite, deren
   * Zugriff sich auf den geaenderten Knoten aufloest
   * (`_check_user_target_pages_datapoint_policy_after_access_change`,
   * `visu.py:602-628`) - also auch ueber erbende Kindseiten. Deren
   * `page_config` ist hier nicht geladen (sie kaeme je Kindseite als eigene
   * Anfrage), der Hinweis ist deshalb eine UNTERGRENZE: er nennt die Pruefung
   * in ihrem vollen Umfang, kann aber schweigen, wo erst eine Kindseite den 403
   * ausloest. Diesen Rest faengt der ausgeschriebene Ablehnungssatz.
   */
  const draftBindsDatapoints = computed(() => {
    const config = draft.value?.id ? pageConfigs.value[draft.value.id] : null
    const widgets = Array.isArray(config?.widgets) ? config.widgets : []
    return widgets.some((widget) => widget?.datapoint_id || widget?.status_datapoint_id)
  })

  const problems = computed(() =>
    validatePage(draft.value, {
      nodes: nodes.value,
      includesById: includesById.value,
      storedIncludes: storedIncludes.value,
      knownUsernames: usernamesLoaded.value ? allUsernames.value : null,
    }),
  )
  const canSave = computed(() => draft.value !== null && problems.value.length === 0)

  /**
   * Der Entwurf, den die Vorschau-Bruecke bekommt (Protokoll 1.1, Backend-Form).
   *
   * BEWUSST ALS EINFACHE KOPIE (`JSON`-Runde): der Entwurf reist per
   * `postMessage`, und der strukturierte Klon des Browsers lehnt einen
   * Vue-Proxy ab („DataCloneError: #<Object> could not be cloned", im Browser
   * gemessen). Was hier hinausgeht, muss reine Daten sein - dieselbe goldene
   * Regel wie ueberall: Daten = JSON, Verhalten = Code.
   */
  const previewDraft = computed(() => {
    if (!draft.value || draft.value.type === 'LOCATION' || !draft.value.id) return null
    return JSON.parse(JSON.stringify({
      skin: skin.value,
      pageId: draft.value.id,
      nodes: nodes.value.map((node) => {
        const own = node.id === draft.value.id
        return {
          id: node.id,
          parent_id: node.parent_id ?? null,
          name: own ? draft.value.name : node.name,
          type: node.type,
          kind: own ? toBackendKind(draft.value.editorKind) : (node.kind ?? 'normal'),
          order: node.order ?? 0,
          access: node.access ?? null,
          page_config: own ? draftPageConfig() : (pageConfigs.value[node.id] ?? null),
        }
      }),
    }))
  })

  /** Die `page_config` des Entwurfs: Bestand (Widgets, Raster) plus die C1-Felder. */
  function draftPageConfig() {
    const base = pageConfigs.value[draft.value.id] ?? { widgets: [] }
    return {
      ...base,
      includes: [...(draft.value.includes ?? [])],
      ignore_global_includes: draft.value.ignoreGlobalIncludes === true,
      popup: draft.value.popup ? { ...draft.value.popup } : null,
    }
  }

  /* -------------------------------------------------------------- Laden */

  async function loadPageConfig(nodeId) {
    try {
      const { data } = await visuApi.getPage(nodeId)
      pageConfigs.value[nodeId] = data
    } catch {
      // Eine Seite, die dieser Principal nicht lesen darf (401/403) oder die es
      // nicht mehr gibt (404), ist kein Grund, den Baum fallen zu lassen -
      // §2.1 nennt genau diese Signale. Sie bleibt ohne Konfiguration stehen.
    }
  }

  /**
   * Die GESPEICHERTE Konfiguration EINER Seite neu einlesen (Nachzug C3 R2).
   *
   * Der Anlass ist Micsi/openbridgeserver#187, „der letzte gewinnt". Der
   * Speicherplan der Seiteneigenschaften baut seine Nutzlast auf
   * `pageConfigs[id]` - also auf dem Stand, den dieser Store beim AUSWAEHLEN
   * der Seite gelesen hat. Speichert der Canvas danach Elemente (Lage, Name,
   * Bindung, Regel, neue Kacheln), weiss dieser Store nichts davon, und das
   * naechste „Speichern" der Seiteneigenschaften schriebe die alte Widget-Liste
   * zurueck - mit einer Quittung darueber. Bis Teil C3 kostete das nur Lage,
   * seit dem Schreibweg des Autorenteils ganze Elemente (gemessen).
   *
   * KEIN NEUER SCHREIBER: das hier ist ein `GET`. Geschrieben wird weiterhin an
   * denselben zwei Stellen wie zuvor, sie stehen nur nicht mehr auf einem
   * veralteten Boden.
   */
  async function refreshPageConfig(nodeId) {
    if (!nodeId) return
    await loadPageConfig(nodeId)
  }

  async function load() {
    loading.value = true
    loadError.value = false
    try {
      const { data } = await visuApi.tree()
      nodes.value = Array.isArray(data) ? data : []
      pageConfigs.value = {}
      await Promise.all(
        nodes.value.filter((node) => node.type === 'PAGE').map((node) => loadPageConfig(node.id)),
      )
    } catch {
      nodes.value = []
      loadError.value = true
    } finally {
      loading.value = false
    }
    try {
      const { data } = await visuApi.usernames()
      // OHNE ADMINS: `_validate_target_usernames` (`visu.py:635-650`) lehnt einen
      // Admin als Zielgruppen-Mitglied mit 422 ab. Wer ihn gar nicht erst
      // anbietet, produziert die Ablehnung nicht.
      allUsernames.value = (Array.isArray(data) ? data : [])
        .filter((user) => typeof user === 'string' || user?.is_admin !== true)
        .map((user) => (typeof user === 'string' ? user : user.username))
      usernamesLoaded.value = true
    } catch {
      // Ohne Nutzerliste bleibt die Zielgruppe lesbar, nur nicht erweiterbar -
      // und die Pruefung gegen sie schweigt (siehe `usernamesLoaded`).
      allUsernames.value = []
      usernamesLoaded.value = false
    }
  }

  async function loadAudience(nodeId) {
    if (audience.value[nodeId]) return audience.value[nodeId]
    try {
      const { data } = await visuApi.nodeUsers(nodeId)
      audience.value[nodeId] = Array.isArray(data) ? data : []
    } catch {
      audience.value[nodeId] = []
    }
    return audience.value[nodeId]
  }

  /* ----------------------------------------------------------- Auswaehlen */

  async function select(nodeId) {
    selectedId.value = nodeId ?? null
    saveError.value = null
    saveErrorDetail.value = null
    savedAt.value = 0
    const node = nodeId ? nodeById.value.get(nodeId) : null
    if (!node) {
      draft.value = null
      return
    }
    let usernames = []
    if (node.type === 'PAGE') {
      if (!pageConfigs.value[node.id]) await loadPageConfig(node.id)
      usernames = await loadAudience(node.id)
    }
    const config = pageConfigs.value[node.id] ?? null
    draft.value = {
      id: node.id,
      // Zuerst die Seite selbst (sobald Teil C2 das Feld liefert), dann der
      // Browser-Speicher als Notbehelf - nie umgekehrt.
      skin: skinFromPageConfig(config) ?? readPageSkin(node.id),
      parentId: node.parent_id ?? null,
      name: node.name,
      type: node.type,
      editorKind:
        node.type === 'PAGE'
          ? toEditorKind(node.kind, { referenced: referencedIds.value.has(node.id) })
          : 'normal',
      order: node.order ?? 0,
      icon: node.icon ?? null,
      access: node.access ?? null,
      pin: '',
      // Gibt es zu dieser Seite ueberhaupt eine PIN? `null` heisst NICHT „keine",
      // sondern „diese Antwort weist es nicht aus" (der Baum sagt es nur einem
      // Admin). Das leere PIN-Feld unten kann die Frage nicht beantworten - der
      // Hash geht nie an den Browser.
      hasPin: node.has_pin ?? null,
      usernames: [...usernames],
      includes: Array.isArray(config?.includes) ? [...config.includes] : [],
      ignoreGlobalIncludes: config?.ignore_global_includes === true,
      popup: config?.popup ? { ...emptyPopup(), ...config.popup } : null,
    }
  }

  /* ------------------------------------------------------------- Anlegen */

  function nextOrder(parentId) {
    const level = siblingsOf(nodes.value, parentId ?? null)
    if (level.length === 0) return 0
    return Math.max(...level.map((node) => node.order ?? 0)) + 1
  }

  /** Wohin ein neuer Knoten gehoert: neben eine Seite, unter einen Ordner. */
  function defaultParent() {
    const node = selectedNode.value
    if (!node) return null
    return node.type === 'LOCATION' ? node.id : (node.parent_id ?? null)
  }

  function startDraft(type, parentId) {
    const parent = parentId === undefined ? defaultParent() : (parentId ?? null)
    selectedId.value = null
    saveError.value = null
    saveErrorDetail.value = null
    savedAt.value = 0
    draft.value = {
      id: null,
      skin: DEFAULT_VISU_SKIN,
      parentId: parent,
      name: '',
      type,
      editorKind: 'normal',
      order: nextOrder(parent),
      icon: null,
      access: null,
      pin: '',
      hasPin: null,
      usernames: [],
      includes: [],
      ignoreGlobalIncludes: false,
      popup: null,
    }
  }

  const newPage = (parentId) => startDraft('PAGE', parentId)
  const newFolder = (parentId) => startDraft('LOCATION', parentId)

  function discard() {
    draft.value = null
    selectedId.value = null
  }

  /* -------------------------------------------------------- Seitentyp/Skin */

  /**
   * Der Seitentyp-Wechsel im Entwurf - samt Popup-Deskriptor.
   *
   * Der Deskriptor haengt am Typ: ohne diese Kopplung entstuende beim Wechsel
   * genau die Kombination, die das Backend mit 400 ablehnt („Popup-Konfiguration
   * ist nur fuer Seitentyp 'popup' zulaessig").
   */
  function setEditorKind(editorKind) {
    if (!draft.value) return
    draft.value.editorKind = editorKind
    if (editorKind === 'popup') {
      if (!draft.value.popup) draft.value.popup = emptyPopup()
    } else {
      draft.value.popup = null
    }
  }

  /**
   * Die Skin-Wahl. Sie landet im Entwurf (und damit im Speicherplan, sobald das
   * Backend das Feld fuehrt) UND im Browser-Speicher - solange es das Feld nicht
   * gibt, ist der Browser die einzige Ablage, die den Reload ueberlebt.
   */
  function setSkin(value) {
    if (!isKnownSkin(value) || !draft.value) return
    draft.value.skin = value
    if (draft.value.id) writePageSkin(draft.value.id, value)
  }

  /* ---------------------------------------------------------- Speichern */

  async function runStep(step, nodeId) {
    if (step.op === 'createNode') {
      const { data } = await visuApi.createNode(step.body)
      return data.id
    }
    if (step.op === 'patchNode') {
      await visuApi.updateNode(step.nodeId ?? nodeId, step.body)
      return nodeId
    }
    await visuApi.savePage(step.nodeId ?? nodeId, step.body)
    return nodeId
  }

  async function save() {
    if (!draft.value || problems.value.length > 0) return
    const stored = {
      node: draft.value.id ? (nodeById.value.get(draft.value.id) ?? null) : null,
      config: draft.value.id ? (pageConfigs.value[draft.value.id] ?? null) : null,
      skinSupported: skinSupported.value,
    }
    saveError.value = null
    saveErrorDetail.value = null
    // Die Erfolgsmeldung des VORIGEN Speicherns verschwindet, solange dieses
    // laeuft. Sonst bestaetigt der Editor eine Aenderung, die noch unterwegs
    // ist - und der Playwright-Harness liest die stehengebliebene Meldung als
    // Schranke („speichern, dann am Server nachlesen", E9/E15). Gemessen: genau
    // daran ist E9 gerissen, als der Zwischen-Ladevorgang wegfiel, der die
    // Meldung bis dahin beilaeufig mitgeloescht hatte.
    savedAt.value = 0
    let nodeId = draft.value.id
    try {
      for (const step of planPageSave(draft.value, stored)) {
        nodeId = (await runStep(step, nodeId)) ?? nodeId
      }
    } catch (error) {
      saveError.value = rejectionText(error, 'save-failed')
      saveErrorDetail.value = rejectionDetail(error)
      return
    }
    audience.value = {}
    await load()
    await select(nodeId)
    savedAt.value = Date.now()
  }

  /* ------------------------------------------- Verschieben, Umordnen, Loeschen */

  async function moveTo(nodeId, parentId) {
    const target = parentId || null
    if (!canMoveInto(nodes.value, nodeId, target)) return
    const node = nodeById.value.get(nodeId)
    try {
      await visuApi.moveNode(nodeId, { new_parent_id: target, order: node?.order ?? 0 })
    } catch (error) {
      saveError.value = rejectionText(error, 'save-failed')
      saveErrorDetail.value = rejectionDetail(error)
      return
    }
    await load()
    if (selectedId.value) await select(selectedId.value)
  }

  async function nudge(nodeId, direction) {
    const swap = neighbourSwap(nodes.value, nodeId, direction)
    if (!swap) return
    try {
      for (const entry of swap) await visuApi.updateNode(entry.id, { order: entry.order })
    } catch (error) {
      saveError.value = rejectionText(error, 'save-failed')
      saveErrorDetail.value = rejectionDetail(error)
      return
    }
    await load()
    if (selectedId.value) await select(selectedId.value)
  }

  async function remove(nodeId) {
    try {
      await visuApi.deleteNode(nodeId)
    } catch (error) {
      saveError.value = rejectionText(error, 'save-failed')
      saveErrorDetail.value = rejectionDetail(error)
      return
    }
    audience.value = {}
    await load()
    if (selectedId.value === nodeId || !nodeById.value.has(selectedId.value)) {
      selectedId.value = null
      draft.value = null
    }
  }

  return {
    nodes,
    pageConfigs,
    refreshPageConfig,
    allUsernames,
    usernamesLoaded,
    selectedId,
    selectedNode,
    draft,
    loading,
    loadError,
    saveError,
    saveErrorDetail,
    savedAt,
    skin,
    skinSupported,
    storedIncludes,
    draftBindsDatapoints,
    referencedIds,
    includesById,
    problems,
    canSave,
    previewDraft,
    load,
    select,
    newPage,
    newFolder,
    discard,
    setEditorKind,
    setSkin,
    save,
    moveTo,
    nudge,
    remove,
  }
})
