/**
 * Die Textseite der Dualitaet (M5 C6, Issue #173, Messlatte E13).
 *
 * „Seite als JSON/Text UND visuell editierbar, beide Ansichten synchron" -
 * hier liegt die REGEL dafuer, nicht die Ansicht: was aus einer Seite ein
 * Textdokument macht, und was aus einem Textdokument wieder eine Seite werden
 * darf.
 *
 * DIE TEXTANSICHT IST KEIN SCHREIBER. Sie erzeugt nichts, was der Canvas nicht
 * auch erzeugen koennte, und sie schickt nichts an das Backend; sie legt einen
 * Entwurf um, den weiterhin genau ein „Speichern" ablegt. Auf `page_config`
 * schreiben im Editor schon zwei Stellen unabhaengig voneinander
 * (Micsi/openbridgeserver#187) - eine dritte mit eigenem Schreibweg waere die
 * naechste Stelle mit „der letzte gewinnt".
 *
 * WAS ABGELEHNT WIRD, und warum es abgelehnt und nicht repariert wird: ein
 * halb getipptes Dokument ist keine Seite. Wuerde der Editor daraus die
 * naechstbeste Seite basteln, verloere der Autor beim Tippen Kacheln. Deshalb
 * gibt {@link parseEditorJson} bei jedem Zweifel `ok: false` zurueck, und die
 * Ansicht laesst den bisherigen Stand stehen.
 *
 * WAS TROTZDEM GEHEILT WIRD, und nur das: die vier Zahlen der Autoren-Box.
 * Sie sind R17 - V1 (`frontend/`) liest dieselbe Seite und rechnet ungeprueft
 * mit ihnen (`w.x * CELL_W`, `frontend/src/views/VisuEditor.vue`). Ein `null`
 * oder ein fehlendes Feld wuerde dort zu `0` und im Canvas zu `NaN`. Geheilt
 * wird deshalb auf DIESELBE Vorgabe, die auch das Backend-Modell setzt
 * (`WidgetInstance._a_missing_coordinate_is_the_v1_default`), und auf keine
 * andere.
 */

/** Die Vorgabe-Box aus dem Backend-Modell (`obs/models/visu.py`). */
export const BOX_DEFAULTS = { x: 0, y: 0, w: 2, h: 2 }

/** Die Seite als lesbares Dokument. Ohne Seite gibt es keinen Text. */
export function toEditorJson(pageConfig) {
  if (!pageConfig || typeof pageConfig !== 'object') return ''
  return JSON.stringify(pageConfig, null, 2)
}

/** Eine Koordinate: eine ganze Zahl, oder die V1-Vorgabe dieses Feldes. */
function boxValue(value, key) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : BOX_DEFAULTS[key]
}

/**
 * Ein Textdokument als Seite lesen.
 *
 * Rueckgabe: `{ ok: true, config }` oder `{ ok: false, reason }` mit
 * `reason` aus `syntax` (kein JSON) und `shape` (JSON, aber keine Seite).
 * Der Unterschied ist keine Feinheit - er ist der Satz, den der Autor liest.
 */
export function parseEditorJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'syntax' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'syntax' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'shape' }
  }
  if (!Array.isArray(parsed.widgets)) return { ok: false, reason: 'shape' }
  const widgets = []
  for (const widget of parsed.widgets) {
    if (!widget || typeof widget !== 'object' || Array.isArray(widget)) {
      return { ok: false, reason: 'shape' }
    }
    if (typeof widget.id !== 'string' || widget.id === '') return { ok: false, reason: 'shape' }
    const copy = { ...widget }
    for (const key of Object.keys(BOX_DEFAULTS)) copy[key] = boxValue(widget[key], key)
    widgets.push(copy)
  }
  return { ok: true, config: { ...parsed, widgets } }
}

/**
 * Sind zwei Seiten-Konfigurationen dieselbe?
 *
 * Verglichen wird ueber eine kanonische Fassung mit sortierten Schluesseln: der
 * Server gibt seine Felder in der Reihenfolge seines Modells zurueck, und ein
 * roher Textvergleich wuerde an dieser Reihenfolge scheitern statt an einem
 * Unterschied. Gebraucht wird das beim Wiederherstellen: „wiederhergestellt"
 * darf erst gemeldet werden, wenn der Server den alten Stand WIRKLICH traegt.
 */
export function sameConfig(a, b) {
  return canonicalJson(a) === canonicalJson(b)
}

/**
 * Die kanonische Fassung eines Wertes: sortierte Schluessel, sonst nichts.
 *
 * Seit dem Nachzug zu Teil C3 EXPORTIERT, weil der Canvas dieselbe Rechnung
 * fuer die Widget-Liste braucht (`utils/visuEditorWidgets.js`, die Schranke
 * hinter der Quittung). Eine zweite Kopie waere eine zweite Lesart derselben
 * Frage, und die beiden koennten auseinanderlaufen, ohne dass es jemand merkt.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
