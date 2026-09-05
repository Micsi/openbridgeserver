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
import { DEFAULT_VISU_SKIN, isKnownSkin, readPageSkin, writePageSkin } from '@/utils/visuSkins'

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
  const savedAt = ref(0)
  const skin = ref(DEFAULT_VISU_SKIN)

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

  const problems = computed(() =>
    validatePage(draft.value, { nodes: nodes.value, includesById: includesById.value }),
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
      allUsernames.value = (Array.isArray(data) ? data : []).map((user) =>
        typeof user === 'string' ? user : user.username,
      )
    } catch {
      // Ohne Nutzerliste bleibt die Zielgruppe lesbar, nur nicht erweiterbar.
      allUsernames.value = []
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
    savedAt.value = 0
    const node = nodeId ? nodeById.value.get(nodeId) : null
    if (!node) {
      draft.value = null
      return
    }
    skin.value = readPageSkin(node.id)
    let usernames = []
    if (node.type === 'PAGE') {
      if (!pageConfigs.value[node.id]) await loadPageConfig(node.id)
      usernames = await loadAudience(node.id)
    }
    const config = pageConfigs.value[node.id] ?? null
    draft.value = {
      id: node.id,
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
    savedAt.value = 0
    skin.value = DEFAULT_VISU_SKIN
    draft.value = {
      id: null,
      parentId: parent,
      name: '',
      type,
      editorKind: 'normal',
      order: nextOrder(parent),
      icon: null,
      access: null,
      pin: '',
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

  function setSkin(value) {
    if (!isKnownSkin(value)) return
    skin.value = value
    if (draft.value?.id) writePageSkin(draft.value.id, value)
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
    }
    saveError.value = null
    let nodeId = draft.value.id
    try {
      for (const step of planPageSave(draft.value, stored)) {
        nodeId = (await runStep(step, nodeId)) ?? nodeId
      }
    } catch (error) {
      saveError.value = rejectionText(error, 'save-failed')
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
    allUsernames,
    selectedId,
    selectedNode,
    draft,
    loading,
    loadError,
    saveError,
    savedAt,
    skin,
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
