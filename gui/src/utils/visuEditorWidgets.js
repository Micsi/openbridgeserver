/**
 * Die Elemente einer Seite aus ZWEI Haenden - und die Schranke hinter der
 * Quittung (Nachzug M5 C3, Issue #170).
 *
 * DER FUND, gegen den diese Datei angetreten ist: Name, Datenpunkt-Bindung,
 * Sichtbarkeitsregel und ein frisch aus der Palette gelegtes Element erreichten
 * nur den ENTWURF. Gespeichert wurde ausschliesslich, was Seiteneigenschaften,
 * Canvas und Verlauf halten; „Speichern" im Canvas quittierte trotzdem
 * „Gespeichert", weil der Rueckvergleich nur Seiteneigenschaften und Boxen
 * ansah. `GET /visu/pages/<id>` war danach byteweise der alte Stand - ein
 * falscher Erfolg, dieselbe Fehlerklasse wie in C2 Runde 1 und C6 Runde 2.
 *
 * KEIN NEUER SCHREIBER. Auf `page_config` schreiben im Editor bereits mehrere
 * Stellen unabhaengig voneinander (Seiteneigenschaften, Canvas, Verlauf;
 * Micsi/openbridgeserver#187, „der letzte gewinnt"). Der Autorenteil bekommt
 * deshalb KEINEN eigenen Weg zum Backend: er reicht seine Elemente dem Canvas
 * herein, und der Canvas schreibt sie mit seinem einen `PUT` mit. Diese Datei
 * ist die Naht dafuer, und sie ist rein - gleiche Eingabe, gleiche Ausgabe,
 * keine Seiteneffekte.
 *
 * WER WELCHES FELD BESITZT - dieselbe Aufteilung wie beim Vorschau-Entwurf
 * (`utils/visuEditorDraftMerge.js`), nur in der anderen Richtung:
 *
 *  | Feld am Element                          | Wer entscheidet |
 *  |------------------------------------------|-----------------|
 *  | `name`, `type`                           | Autorenteil     |
 *  | `datapoint_id`, `status_datapoint_id`    | Autorenteil     |
 *  | `config.*` (Bindung, Rolle, Icon, Preset,|                 |
 *  |  Beschriftung, `visible_when`)           | Autorenteil     |
 *  | `x`/`y`/`w`/`h` (die Autoren-Box)        | Canvas          |
 *  | `config.editor` (gesperrt/ausgeblendet/  |                 |
 *  |  Gruppe)                                 | Canvas          |
 *  | Reihenfolge der Liste (Z-Ordnung, Fluss) | Canvas          |
 *
 * Neue Elemente kommen von BEIDEN Seiten: aus der Palette (Autorenteil) und aus
 * Einfuegen/Duplizieren (Canvas, Teil C5). Keine Seite loescht die andere weg -
 * was nur eine von beiden kennt, bleibt stehen.
 */

import { BOX_KEYS, WIDGET_FLAGS_KEY } from '@/utils/visuEditorPage'
import { BOX_DEFAULTS, canonicalJson } from '@/utils/visuPageJson'

/**
 * Die Vorgaben, die `WidgetInstance` (`obs/models/visu.py`) selbst setzt.
 *
 * Sie stehen hier, damit ein Vergleich mit dem Serverstand nicht an einem Feld
 * scheitert, das der Client gar nicht geschickt hat und das der Server aus
 * seinem Modell ergaenzt. `type` fehlt bewusst: es hat im Modell keine Vorgabe
 * und ist Pflicht - ein Element ohne Typ ist keines.
 */
export const WIDGET_MODEL_DEFAULTS = Object.freeze({
  name: '',
  datapoint_id: null,
  status_datapoint_id: null,
})

/**
 * Ein Element in der Form, in der es aus der Spalte zurueckkommt.
 *
 * Nur ERGAENZEN, nie wegnehmen: ein Feld, das der Client mitschickt und das der
 * Server nicht kennt, bleibt stehen und faellt im Vergleich auf. Genau das soll
 * es - der Server laesst es fallen, die Aenderung ist also nicht angekommen,
 * und dann darf keine Quittung erscheinen.
 *
 * Die vier Zahlen der Autoren-Box heilen auf DIESELBE Vorgabe, die das Backend
 * setzt (`_a_missing_coordinate_is_the_v1_default`, R17) - und auf keine andere.
 */
export function normalizeWidget(widget) {
  const roh = widget && typeof widget === 'object' ? widget : {}
  const out = { ...roh, ...{} }
  for (const [key, wert] of Object.entries(WIDGET_MODEL_DEFAULTS)) {
    if (out[key] === undefined) out[key] = wert
  }
  for (const key of BOX_KEYS) {
    const n = Number(roh[key])
    out[key] = Number.isFinite(n) ? n : BOX_DEFAULTS[key]
  }
  out.config = roh.config && typeof roh.config === 'object' ? roh.config : {}
  return out
}

/**
 * Die Widget-Liste als vergleichbarer Text.
 *
 * DIE SCHRANKE HINTER DER QUITTUNG. Bis zu diesem Nachzug verglich der Canvas
 * nur die Ids und die vier Zahlen der Box; alles, was der Autorenteil setzt -
 * Name, Bindung, Rolle, Icon, Beschriftung, Preset, Sichtbarkeitsregel - lag
 * ausserhalb des Vergleichs und konnte spurlos verlorengehen, waehrend
 * „Gespeichert" dastand. Verglichen wird deshalb das GANZE Element, mit
 * sortierten Schluesseln (die Reihenfolge der Felder ist die des Servermodells,
 * nicht die des Editors) und in der REIHENFOLGE der Liste, denn die ist die
 * Z-Ordnung (E8) und der Fluss (E2).
 */
export function widgetSignature(list) {
  return canonicalJson((Array.isArray(list) ? list : []).map(normalizeWidget))
}

/** Die Felder, die der Canvas besitzt, an einem Element des Autorenteils. */
function withCanvasOwned(authored, canvasWidget) {
  const out = { ...authored }
  for (const key of BOX_KEYS) {
    if (typeof canvasWidget[key] === 'number') out[key] = canvasWidget[key]
  }
  const marken = canvasWidget.config ? canvasWidget.config[WIDGET_FLAGS_KEY] : undefined
  const config = { ...(authored.config || {}) }
  if (marken === undefined) delete config[WIDGET_FLAGS_KEY]
  else config[WIDGET_FLAGS_KEY] = marken
  out.config = config
  return out
}

/**
 * Die Elemente des Canvas und die des Autorenteils zu EINER Liste zusammenlegen.
 *
 * Die Reihenfolge ist die des Canvas - sie ist Z-Ordnung und Fluss und gehoert
 * ihm. Was nur der Autorenteil kennt, haengt hinten an (frisch aus der Palette);
 * was nur der Canvas kennt, bleibt stehen (frisch eingefuegt oder dupliziert).
 *
 * OHNE Autorenliste ist das ein Nichtstun. Das ist keine Bequemlichkeit, sondern
 * die Vorkehrung gegen den Augenblick zwischen zwei Ladevorgaengen: waehrend der
 * Autorenteil eine neue Seite liest, ist seine Liste leer, und eine leere Liste
 * darf niemals die Kacheln des Canvas abraeumen.
 */
export function mergeAuthoredWidgets(canvasWidgets, authoredWidgets) {
  const canvasList = (Array.isArray(canvasWidgets) ? canvasWidgets : []).filter(Boolean)
  const authored = (Array.isArray(authoredWidgets) ? authoredWidgets : []).filter(
    (w) => w && typeof w === 'object' && typeof w.id === 'string' && w.id !== '',
  )
  if (authored.length === 0) return canvasList.map((w) => ({ ...w }))

  const nachId = new Map(authored.map((w) => [w.id, w]))
  const uebernommen = new Set()
  const out = []
  for (const canvasWidget of canvasList) {
    const passend = canvasWidget.id ? nachId.get(canvasWidget.id) : null
    if (!passend) {
      out.push({ ...canvasWidget })
      continue
    }
    uebernommen.add(canvasWidget.id)
    out.push(withCanvasOwned(passend, canvasWidget))
  }
  for (const w of authored) {
    if (uebernommen.has(w.id)) continue
    out.push({ ...w })
  }
  return out
}

export default mergeAuthoredWidgets
