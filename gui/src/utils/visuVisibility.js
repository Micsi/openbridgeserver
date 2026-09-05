/**
 * Bedingte Sichtbarkeit (Messlatte **E16**, M5 C3, Issue #170).
 *
 * Ein Element ist je nach Datenpunktwert sichtbar oder unsichtbar. Die Regel ist
 * DATEN am Widget (`config.visible_when`, also Teil der `PageConfig`, die das
 * Backend als JSON durchreicht), die Auswertung ist CODE - diese reinen
 * Funktionen. Damit gilt dieselbe Trennung wie ueberall in der Visu, und die
 * gespeicherte Seite traegt die Regel auch dann, wenn sie ausser dem Editor
 * niemand auswertet.
 *
 * GRENZE, ausdruecklich: ausgewertet wird die Regel HEUTE im Editor, der die
 * Knoten fuer die Vorschau zusammenstellt (siehe `useVisuEditorDraft.js`). Der
 * Live-Host (`apps/visu/`) liest `visible_when` noch nicht; das ist der
 * Renderer-Teil und liegt ausserhalb von C3 (Teil C3 aendert `apps/visu/src`
 * nicht). Die Regel steht als Daten in der Seite und wartet dort auf ihn.
 */

/** Die Vergleiche, die das Formular anbietet. */
export const VISIBILITY_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'truthy', 'falsy']

/** Vergleiche, die ohne Schwelle unvollstaendig sind. */
const BRAUCHT_SCHWELLE = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte'])

/** Zahl oder null - dieselbe Lesart wie `toNum` in der Abbildung der Visu. */
function toNum(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (!Number.isNaN(n)) return n
  }
  return null
}

/** Wahrheitswert oder null - dieselbe Lesart wie `toBool` in der Abbildung. */
function toBool(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'on') return true
    if (s === 'false' || s === '0' || s === 'off' || s === '') return false
  }
  return null
}

/**
 * Eine vollstaendige Regel oder null. Halb ausgefuellt wird nichts gespeichert:
 * eine Regel ohne Datenpunkt oder ohne Schwelle waere im gespeicherten Zustand
 * nicht auswertbar und verstuende sich stumm als „immer sichtbar".
 */
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null
  const datapointId = typeof raw.datapoint_id === 'string' ? raw.datapoint_id.trim() : ''
  if (!datapointId) return null
  if (!VISIBILITY_OPS.includes(raw.op)) return null
  if (!BRAUCHT_SCHWELLE.has(raw.op)) return { datapoint_id: datapointId, op: raw.op }

  const roh = raw.value
  if (roh === null || roh === undefined || (typeof roh === 'string' && roh.trim() === '')) return null
  const zahl = toNum(roh)
  return { datapoint_id: datapointId, op: raw.op, value: zahl === null ? roh : zahl }
}

/** Die Regel eines Widgets, oder null. */
export function readVisibilityRule(widget) {
  return normalizeRule(widget && widget.config ? widget.config.visible_when : null)
}

/** Das Widget mit (oder ohne) Regel - als neues Objekt. */
export function writeVisibilityRule(widget, rule) {
  const config = { ...(widget.config || {}) }
  const normalisiert = normalizeRule(rule)
  if (normalisiert) config.visible_when = normalisiert
  else delete config.visible_when
  return { ...widget, config }
}

/**
 * Ist die Bedingung erfuellt?
 *
 * Ohne Regel: sichtbar. Mit Regel, aber ohne Wert: NICHT sichtbar - eine
 * Bedingung, die niemand pruefen konnte, ist nicht erfuellt. Sonst blitzte beim
 * Laden genau das Element auf, das die Regel verbergen soll.
 */
export function evaluateVisibility(rule, value) {
  const regel = normalizeRule(rule)
  if (!regel) return true
  if (value === null || value === undefined) return false

  if (regel.op === 'truthy') return toBool(value) === true
  if (regel.op === 'falsy') return toBool(value) === false

  const links = toNum(value)
  const rechts = toNum(regel.value)
  if (links === null || rechts === null) {
    // Nicht-numerisch: nur Gleichheit ist sinnvoll, und die als Text.
    if (regel.op === 'eq') return String(value) === String(regel.value)
    if (regel.op === 'ne') return String(value) !== String(regel.value)
    return false
  }
  switch (regel.op) {
    case 'eq':
      return links === rechts
    case 'ne':
      return links !== rechts
    case 'lt':
      return links < rechts
    case 'lte':
      return links <= rechts
    case 'gt':
      return links > rechts
    case 'gte':
      return links >= rechts
    default:
      return true
  }
}

/** Ist dieses Widget bei diesem Wertestand sichtbar? */
export function isWidgetVisible(widget, values = {}) {
  const regel = readVisibilityRule(widget)
  if (!regel) return true
  return evaluateVisibility(regel, values[regel.datapoint_id])
}

/**
 * Die Knoten ohne die Elemente, deren Bedingung nicht erfuellt ist. Neue
 * Objekte; die Knoten des Aufrufers bleiben, wie sie sind.
 */
export function applyVisibility(nodes, values = {}) {
  return (nodes || []).map((node) => {
    const widgets = node && node.page_config ? node.page_config.widgets : null
    if (!Array.isArray(widgets)) return node
    return {
      ...node,
      page_config: { ...node.page_config, widgets: widgets.filter((w) => isWidgetVisible(w, values)) },
    }
  })
}

/** Die Datenpunkte, an denen eine Sichtbarkeitsregel haengt (die Abo-Liste). */
export function visibilityDatapointIds(nodes) {
  const ids = []
  for (const node of nodes || []) {
    const widgets = node && node.page_config ? node.page_config.widgets : null
    if (!Array.isArray(widgets)) continue
    for (const widget of widgets) {
      const regel = readVisibilityRule(widget)
      if (regel && !ids.includes(regel.datapoint_id)) ids.push(regel.datapoint_id)
    }
  }
  return ids
}
