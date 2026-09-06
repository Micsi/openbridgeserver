/**
 * Der Undo-/Redo-Stapel des V2-Editors (M5 C5, Issue #172 - Messlatte E7).
 *
 * WAS AUF DEM STAPEL LIEGT, ist ein ZUSTAND und keine rueckwaerts gelesene
 * Aktion. Das ist die Entscheidung, an der ein Undo-Stapel steht oder faellt:
 * eine Aktion muss ihre Umkehrung kennen, und jede neue Aktion (Gruppieren,
 * Einfuegen, „Verteilen") braucht eine zweite, invers gebaute Fassung ihrer
 * selbst. Ein Zustand braucht das nicht - er ist die Umkehrung. E7 verlangt
 * genau das: „Undo stellt EXAKT den vorigen Zustand wieder her".
 *
 * ER LIEGT TIEF KOPIERT DA. Ein Stapel, der auf dieselben Objekte zeigt wie der
 * Editor, waere mit der naechsten Aenderung stillschweigend mitgewandert; das
 * Zuruecknehmen lieferte dann genau den Stand, von dem man wegwollte. Kopiert
 * wird ueber JSON - dasselbe Mittel, mit dem der Entwurf an die Vorschau geht
 * (`toPreviewDraft`), und aus demselben Grund: was hier hineinkommt, haengt an
 * Vues `ref()`/`reactive()`, und ein Proxy ist kein Zustand, sondern ein Blick
 * auf einen.
 *
 * WAS NICHT DARAUF LIEGT: die SEITENEIGENSCHAFTEN (Layout-Modus, Rasterweite,
 * Breakpoints, Skin). Der Stapel ist die Geschichte der ELEMENTE. Die
 * Rasterweite aendert sich waehrend des Tippens bei jedem Anschlag, und ein
 * Stapel, der jeden Anschlag traegt, kostet zehn Tastendruecke, um einen
 * Nudge zurueckzunehmen. Die Seiteneigenschaften haben ihr eigenes „Speichern"
 * und ihren eigenen Rueckweg (die Seite neu laden); dieser Stapel mischt sich
 * nicht ein.
 */

/**
 * Wie viele Schritte der Stapel haelt.
 *
 * Endlich, weil jeder Schritt eine vollstaendige Kopie der Widget-Liste ist. 50
 * Schritte sind mehr, als ein Autor in einem Zug zurueckgeht, und bei einer
 * Seite von 50 Kacheln immer noch ein Bruchteil eines Megabytes.
 */
export const HISTORY_LIMIT = 50

/** Eine tiefe Kopie aus reinen Daten - kein reaktiver Proxy, keine Vue-Innereien. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Der festgehaltene Zustand: die Elemente UND die Auswahl.
 *
 * Die Auswahl gehoert dazu, und zwar nicht aus Bequemlichkeit: der Anfasser zum
 * Groesserziehen (`[data-resize="se"]`) existiert nur am ausgewaehlten Element.
 * Ein Undo, das die Auswahl leert, laesst ihn verschwinden - und E14 misst
 * genau ueber ihn, jeweils nach einem Undo.
 */
export function snapshotOf(widgets, selectedIds) {
  return plain({
    widgets: Array.isArray(widgets) ? widgets : [],
    selectedIds: Array.isArray(selectedIds) ? selectedIds : [],
  })
}

/** Ein leerer Stapel: was war (`past`) und was zurueckgenommen wurde (`future`). */
export function createHistory() {
  return { past: [], future: [] }
}

/**
 * Einen Zustand aufzeichnen, BEVOR er geaendert wird.
 *
 * Die Zukunft wird dabei verworfen: wer nach einem Undo etwas Neues tut, hat
 * sich fuer einen anderen Weg entschieden, und ein Redo, das ihn auf den alten
 * zurueckwuerfe, waere ein Sprung in eine Geschichte, die es nicht mehr gibt.
 *
 * Ob sich ueberhaupt etwas aendert, entscheidet der AUFRUFER. Diese Funktion
 * kann es nicht wissen - sie sieht nur den Zustand vorher. Der Canvas ruft sie
 * deshalb erst, wenn eine Aenderung wirklich ansteht (ein Nudge, der an einer
 * Sperre scheitert, zeichnet nichts auf; ein Zug, der nie bewegt wurde,
 * ebenfalls nicht).
 */
export function recordChange(history, snapshot, limit = HISTORY_LIMIT) {
  history.past.push(plain(snapshot))
  history.future.length = 0
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : HISTORY_LIMIT
  while (history.past.length > max) history.past.shift()
  return history
}

/**
 * Einen Schritt zurueck. `current` ist der Zustand, in dem der Editor gerade
 * steht - er wandert auf die Zukunft, damit Redo ihn wiederholen kann.
 * Zurueck kommt der wiederherzustellende Zustand, oder `null`, wenn es nichts
 * zurueckzunehmen gibt.
 */
export function undoTo(history, current) {
  if (history.past.length === 0) return null
  history.future.push(plain(current))
  return history.past.pop()
}

/** Ein Schritt vorwaerts - das Gegenstueck zu {@link undoTo}. */
export function redoTo(history, current) {
  if (history.future.length === 0) return null
  history.past.push(plain(current))
  return history.future.pop()
}
