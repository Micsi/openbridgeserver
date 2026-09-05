/**
 * Der Entwurf, den die Vorschau-Bruecke hinueberschickt (M5 C3, Issue #170).
 *
 * Hier haengen zwei Zeilen der Messlatte:
 *
 * **E10 - Vorlage propagiert ohne Re-Import.** Die Wirtsseite speichert von
 * ihrer Vorlage nur die Id (`page_config.includes`, Teil A); der Entwurf laedt
 * die Vorlage bei jedem Aufbau FRISCH und legt sie als eigenen Knoten daneben.
 * Der Host komponiert daraus den Ebenenstapel (Teil B). Es gibt in diesem Modul
 * gar keinen Weg, Widgets einer Vorlage in eine andere Seite zu kopieren - und
 * deshalb auch nichts, was ein Autor je „neu importieren" muesste.
 *
 * **E16 - bedingte Sichtbarkeit.** Der Entwurf traegt JEDES Element, auch das
 * geregelte. Ausgewertet wird `config.visible_when` im HOST
 * (`apps/visu/src/core/obs/mapping.ts`) - dort, wo auch die ausgelieferte Visu
 * ihre Geraete und Ebenen herbekommt. Ein Filter an dieser Stelle waere eine
 * zweite Auswertung neben der echten und liesse die Vorschau fuer geregelte
 * Elemente von der Visu abweichen; genau das schliesst **E3** aus.
 *
 * Der Editor beobachtet die Regel-Datenpunkte trotzdem - aber als ANLASS, nicht
 * als Entscheidung: bewegt sich ein Wert, an dem eine Regel haengt, bekommt die
 * Bruecke einen neuen Entwurf, und der Host wertet die Seite frisch aus. Die
 * Werte kommen vom echten Backend (REST fuer den Anfangswert, WebSocket fuer die
 * Aenderung) - dieselbe Quelle wie im Rest der Admin-GUI, keine zweite.
 *
 * Was der Entwurf NICHT traegt: Werte. Die Vorschau liest sie selbst und
 * seitenbezogen am Server (`PreviewDataSource`, Teil C4) - der Entwurf ist
 * Struktur, nicht Zustand. Deshalb reist hier auch kein Wert mit, sondern nur
 * der Anlass, neu zu lesen.
 */
import { computed, ref, shallowRef, watch, onBeforeUnmount } from 'vue'

import { visuApi } from '@/api/visu'
import { dpApi } from '@/api/client'
import { useWebSocketStore } from '@/stores/websocket'
import { visibilityDatapointIds } from '@/utils/visuVisibility'
import { CORE_WIDGET_TYPES, WIDGET_FORMS } from '@/utils/visuWidgetTypes'

/**
 * Der Skin, gegen den der Editor zeichnet: der seitenbesitzende Pixel-Skin. Er
 * ist der einzige, der eine Seite mit ihren Ebenen und Popups rendert - genau
 * das, was ein Layering-Autor sehen muss.
 *
 * VORLAEUFIG EINE VORGABE, kein Entscheid: „Skin pro Seite oder global waehlbar"
 * ist Messlatte E19 und gehoert zu den Seiteneigenschaften (Teil C1). Sobald die
 * Seite ihren Skin traegt, kommt er von dort in `buildDraft`.
 */
export const EDITOR_SKIN = 'edomi'

/** Die Konfig-Schluessel, an denen ueberhaupt eine Datenpunkt-Id stehen kann. */
const DP_CONFIG_KEYS = (() => {
  const keys = new Set()
  for (const type of CORE_WIDGET_TYPES) {
    for (const field of WIDGET_FORMS[type].fields) {
      if (field.kind === 'datapoint' && field.path.startsWith('config.')) {
        keys.add(field.path.slice('config.'.length))
      }
    }
  }
  return [...keys]
})()

/**
 * Welche Knoten diese Seite fuer eine vollstaendige Vorschau braucht: sie
 * selbst, ihre Inkludeseiten (Kette, zyklensicher) und - solange sie die
 * globalen nicht ausblendet (R13) - die globalen Inkludeseiten.
 *
 * Reihenfolge = Baum-Reihenfolge. Sie ist tragend: mehrere globale
 * Inkludeseiten stapeln nach Knoten-`order` (R10), und `/visu/tree` liefert
 * genau diese Ordnung.
 */
export function requiredNodeIds(pageId, tree, pageConfigs) {
  const gebraucht = new Set()
  const offen = [pageId]
  while (offen.length > 0) {
    const id = offen.shift()
    if (!id || gebraucht.has(id)) continue
    if (!pageConfigs[id]) continue
    gebraucht.add(id)
    for (const include of pageConfigs[id].includes || []) offen.push(include)
  }
  const wurzel = pageConfigs[pageId]
  if (wurzel && wurzel.ignore_global_includes !== true) {
    for (const node of tree || []) {
      if (node.kind === 'globalInclude' && pageConfigs[node.id]) gebraucht.add(node.id)
    }
  }
  return (tree || []).filter((node) => gebraucht.has(node.id)).map((node) => node.id)
}

/** Eine Seiten-Konfiguration oder null (verdeckt/geloescht/keine Seite). */
async function ladePageConfig(nodeId) {
  try {
    const { data } = await visuApi.page(nodeId)
    return data
  } catch {
    // Eine Include-Quelle darf fehlen, verdeckt oder gar keine Seite sein
    // (CONTRIBUTING-visu-m5.md §2.1, „Grenzen der obigen Zusagen"). Der Entwurf
    // laesst sie dann weg - genau wie die Komposition des Hosts.
    return null
  }
}

/**
 * Die Knoten fuer den Entwurf einer Seite, jeder mit seiner FRISCH gelesenen
 * Seiten-Konfiguration (E10).
 */
export async function loadDraftNodes(pageId) {
  const { data: tree } = await visuApi.tree()
  const configs = {}

  // 1. die Seite selbst und ihre Include-Kette
  const offen = [pageId]
  const gesehen = new Set()
  while (offen.length > 0) {
    const id = offen.shift()
    if (!id || gesehen.has(id)) continue
    gesehen.add(id)
    const config = await ladePageConfig(id)
    if (!config) continue
    configs[id] = config
    for (const include of config.includes || []) offen.push(include)
  }

  // 2. die globalen Inkludeseiten, wenn die Seite sie nicht ausblendet (R13).
  //    Sie duerfen selbst nichts inkludieren (R12), also endet es hier.
  if (configs[pageId] && configs[pageId].ignore_global_includes !== true) {
    for (const node of tree || []) {
      if (node.kind !== 'globalInclude' || configs[node.id]) continue
      const config = await ladePageConfig(node.id)
      if (config) configs[node.id] = config
    }
  }

  return requiredNodeIds(pageId, tree, configs).map((id) => ({
    ...(tree || []).find((node) => node.id === id),
    page_config: configs[id],
  }))
}

/**
 * Der Entwurf in der Form, die die Bruecke erwartet (Protokoll 1.1).
 *
 * `tweaks` und `theme` sind additiv und stehen hier bewusst NICHT: an ihnen
 * haengen die Wurzel-Attribute des Skins, und ihre Werte gehoeren zu den
 * Seiteneigenschaften (Teil C1). Fehlen sie, rechnet die Vorschau dieselben
 * Vorgaben wie die echte Seite ohne eigene Werte (`applyTweaks({})`) - ein
 * ERFUNDENER Wert waere hier schlimmer als keiner, denn er zeigte dem Autor
 * eine Flaeche, die die Visu nie so rendert.
 *
 * Die Knoten gehen UNVERAENDERT hinueber - kein Filter, keine Auswahl, auch
 * nicht fuer `config.visible_when` (E16). Was der Host aus ihnen macht, macht er
 * fuer die Vorschau und fuer die ausgelieferte Seite gleich; jede Vorentscheidung
 * hier waere eine zweite Auswertung und damit genau die Abweichung, die E3
 * ausschliesst.
 */
export function buildDraft({ pageId, nodes, skin = EDITOR_SKIN }) {
  return { skin, pageId, nodes }
}

/** Jede Datenpunkt-Id, die in diesen Knoten steht (die Abo-Liste des Editors). */
export function draftDatapointIds(nodes) {
  const ids = []
  const merke = (id) => {
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id)
  }
  for (const node of nodes || []) {
    const widgets = node && node.page_config ? node.page_config.widgets : null
    if (!Array.isArray(widgets)) continue
    for (const widget of widgets) {
      merke(widget.datapoint_id)
      merke(widget.status_datapoint_id)
      for (const key of DP_CONFIG_KEYS) merke((widget.config || {})[key])
    }
  }
  for (const id of visibilityDatapointIds(nodes)) merke(id)
  return ids
}

/**
 * Der Editor-Entwurf als Vue-Zustand: Knoten laden, Werte am Backend abonnieren,
 * Entwurf rechnen.
 *
 * @param {import('vue').Ref<string|null>} pageId Die bearbeitete Seite.
 */
export function useVisuEditorDraft(pageId) {
  const nodes = shallowRef([])
  const values = ref({})
  const loading = ref(false)
  const error = ref(null)
  const ws = useWebSocketStore()
  let abonniert = []

  /** Anfangswerte per REST, Aenderungen per WebSocket - eine Quelle, das Backend. */
  async function beobachte(ids) {
    const neu = ids.filter((id) => !abonniert.includes(id))
    const weg = abonniert.filter((id) => !ids.includes(id))
    if (weg.length > 0) ws.unsubscribe(weg)
    abonniert = ids
    if (ids.length > 0) ws.subscribe(ids)
    for (const id of neu) {
      try {
        const { data } = await dpApi.value(id)
        values.value = { ...values.value, [id]: data?.value }
      } catch {
        // Ein Datenpunkt, den der Server nicht (mehr) hergibt, bleibt unbekannt -
        // eine Regel darauf gilt damit als nicht erfuellt (siehe visuVisibility).
      }
    }
  }

  const stopWs = ws.onValue((datapointId, value) => {
    if (!abonniert.includes(datapointId)) return
    values.value = { ...values.value, [datapointId]: value }
  })

  async function reload() {
    if (!pageId.value) {
      nodes.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      nodes.value = await loadDraftNodes(pageId.value)
      await beobachte(draftDatapointIds(nodes.value))
    } catch (err) {
      error.value = err
      nodes.value = []
    } finally {
      loading.value = false
    }
  }

  /** Ein Widget der bearbeiteten Seite ersetzen (der Entwurf, nicht der Server). */
  function replaceWidget(widget) {
    nodes.value = nodes.value.map((node) => {
      if (node.id !== pageId.value) return node
      const widgets = (node.page_config.widgets || []).map((w) => (w.id === widget.id ? widget : w))
      return { ...node, page_config: { ...node.page_config, widgets } }
    })
    void beobachte(draftDatapointIds(nodes.value))
  }

  /** Ein neues Widget auf der bearbeiteten Seite ablegen. */
  function addWidget(widget) {
    nodes.value = nodes.value.map((node) =>
      node.id === pageId.value
        ? {
            ...node,
            page_config: { ...node.page_config, widgets: [...(node.page_config.widgets || []), widget] },
          }
        : node,
    )
  }

  /**
   * Der Stand der Datenpunkte, an denen SICHTBARKEITSREGELN haengen.
   *
   * Er geht NICHT mit hinueber - die Vorschau liest ihre Werte selbst und
   * seitenbezogen (C4), und der Host wertet die Regel aus (E16). Gebraucht wird
   * er als ANLASS: bewegt sich einer dieser Werte, muss der Host die Seite neu
   * auswerten, und dafuer braucht die Bruecke einen neuen Entwurf. Ohne diese
   * Abhaengigkeit blieben geregelte Elemente stehen, bis der Autor zufaellig
   * etwas anderes anfasst.
   */
  const regelStand = computed(() =>
    visibilityDatapointIds(nodes.value)
      .map((id) => `${id}=${JSON.stringify(values.value[id] ?? null)}`)
      .join('|'),
  )

  const draft = computed(() => {
    // Abhaengigkeit ohne Inhalt, mit Absicht: `regelStand` gehoert NICHT in den
    // Entwurf (die Vorschau liest ihre Werte selbst), aber seine Aenderung MUSS
    // einen neuen Entwurf ergeben - sonst bekaeme der Host nie den Anlass, die
    // Regel mit dem frischen Wert neu auszuwerten.
    void regelStand.value
    return pageId.value && nodes.value.length > 0
      ? buildDraft({ pageId: pageId.value, nodes: nodes.value })
      : null
  })

  const pageWidgets = computed(() => {
    const seite = nodes.value.find((node) => node.id === pageId.value)
    return seite && seite.page_config ? seite.page_config.widgets || [] : []
  })

  watch(pageId, () => void reload(), { immediate: true })
  onBeforeUnmount(() => {
    stopWs()
    if (abonniert.length > 0) ws.unsubscribe(abonniert)
  })

  return { nodes, values, draft, pageWidgets, loading, error, reload, replaceWidget, addWidget }
}
