/**
 * Bedingte Sichtbarkeit (Messlatte **E16**, M5 C3, Issue #170) - die Seite des
 * EDITORS.
 *
 * Ein Element ist je nach Datenpunktwert sichtbar oder unsichtbar. Die Regel ist
 * DATEN am Widget (`config.visible_when`, also Teil der `PageConfig`, die das
 * Backend als JSON durchreicht); AUSGEWERTET wird sie im HOST
 * (`apps/visu/src/core/obs/mapping.ts` - `readVisibilityRule` /
 * `evaluateVisibility` / `isWidgetVisible`), also in derselben Uebersetzung, aus
 * der die ausgelieferte Visu UND die Vorschau ihre Geraete und Ebenen beziehen.
 *
 * WARUM NICHT HIER: Messlatte **E3** sagt, die Vorschau IST die Visu. Filterte
 * der Editor die geregelten Elemente aus seinem Entwurf heraus, zeigte die
 * Vorschau fuer genau diese Elemente eine andere Seite als die spaeter
 * ausgelieferte - ein eingebauter Auseinanderlauf, kein bloss fehlendes Stueck.
 * Der Editor reicht deshalb JEDES Element durch.
 *
 * Was dieser Datei bleibt, ist alles, was der Editor selbst tut:
 *
 *  - **schreiben**: das Formular baut die Regel und legt sie ans Widget
 *    ({@link normalizeRule}, {@link writeVisibilityRule}); halb ausgefuellt wird
 *    nichts gespeichert.
 *  - **lesen**: das Formular zeigt eine vorhandene Regel wieder an
 *    ({@link readVisibilityRule}).
 *  - **beobachten**: der Editor abonniert die Datenpunkte, an denen Regeln
 *    haengen ({@link visibilityDatapointIds}) - nicht um selbst zu entscheiden,
 *    sondern damit ein Wertwechsel Anlass ist, dem Host einen neuen Entwurf zu
 *    schicken, den er neu auswertet.
 *
 * Der Zaun dazu: `gui/tests/utils/visuVisibilityHost.spec.js`. Er laedt die
 * Abbildung der Visu als MODUL und haelt beide Haelften gegeneinander - die
 * Vergleichsliste, die Normalform und die Sicht, die Host und Editor auf
 * dieselbe Seite liefern.
 */

/**
 * Die Vergleiche, die das Formular anbietet.
 *
 * KOPIE der Liste im Host (`VISIBILITY_OPS` in `mapping.ts`); die GUI liegt
 * nicht im pnpm-Workspace der Visu und kann sie nicht importieren. Der Zaun
 * bindet sie an ihre Quelle.
 */
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

/**
 * Eine vollstaendige Regel oder null. Halb ausgefuellt wird nichts gespeichert:
 * eine Regel ohne Datenpunkt oder ohne Schwelle waere im gespeicherten Zustand
 * nicht auswertbar und verstuende sich stumm als „immer sichtbar".
 *
 * Die Normalform ist die, die der Host wieder einliest (`readVisibilityRule`):
 * die Schwelle als Zahl, wo sie eine ist, sonst als Text.
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
