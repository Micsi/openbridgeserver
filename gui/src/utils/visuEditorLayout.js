/**
 * Die Rechenregeln des WYSIWYG-Canvas (M5 C2, Issue #169).
 *
 * Reine Funktionen, kein DOM, kein Vue, kein Zustand: Snap, Ausrichtlinien,
 * Verteilen, gleiche Groesse und die Z-Ordnung. Sie stehen getrennt von
 * `VisuEditorCanvas.vue`, weil die Messlatte sie einzeln nennt (E1, E4, E8) und
 * eine falsche Zahl hier eine Zeile ist statt einer Sitzung im Browser.
 *
 * EINHEITEN: alle Werte sind Autoreneinheiten aus dem Backend-Modell
 * (`obs/models/visu.py` → `WidgetInstance.x/y/w/h`). Das Modell traegt `int`;
 * ein gebrochener Wert waere nicht speicherbar, deshalb rechnet jede Funktion
 * hier auf ganzen Zahlen und rundet, wo eine Division sonst Kommastellen liesse.
 * Der Canvas zeichnet eine Einheit als ein CSS-Pixel (Edomi-Semantik: der
 * Vertrag nennt die Zahlen ausdruecklich opak, `WidgetPosition` in
 * `packages/contract/src/types.ts`).
 */

/** Vorgabe der Rasterweite, wenn eine Seite noch keine traegt. */
export const DEFAULT_GRID = 8

/** Toleranz, ab der zwei Kanten als deckungsgleich gelten (Messlatte E4: <=4px). */
export const GUIDE_TOLERANCE = 4

/** Eine ganze Zahl aus allem, was hereinkommt - `NaN` wird zu 0. */
function int(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Der naechste Rasterpunkt zu `value`.
 *
 * ABSOLUT, nicht relativ zum Startpunkt: eine Kachel, die krumm liegt, soll nach
 * dem Ziehen AUF dem Raster liegen und nicht krumm bleiben (E1 prueft genau das
 * mit `after.x % 20 === 0`). Eine Rasterweite <= 1 heisst „kein Raster" und
 * liefert die gerundete Zahl.
 */
export function snapValue(value, step) {
  const s = Number(step)
  if (!Number.isFinite(s) || s <= 1) return int(value)
  return Math.round(int(value) / s) * s
}

/**
 * Die neue Lage einer Kachel nach einer Verschiebung um `dx`/`dy`, eingerastet.
 * Gibt NUR die Lage zurueck - Breite und Hoehe gehoeren dem Element, nicht der
 * Bewegung. Der Ursprung ist die Grenze: negativ gibt es auf dem Canvas nicht.
 */
export function snapBox(box, dx, dy, step) {
  return {
    x: Math.max(0, snapValue(int(box?.x) + int(dx), step)),
    y: Math.max(0, snapValue(int(box?.y) + int(dy), step)),
  }
}

/**
 * Die neuen MASSE einer Kachel nach einem Zug am Anfasser um `dx`/`dy`,
 * eingerastet. Das Gegenstueck zu {@link snapBox}: gibt nur `w`/`h` zurueck, die
 * Lage bleibt, wo sie ist (die Ecke unten rechts zieht, die oben links haelt).
 *
 * Die Untergrenze ist 1 und nicht 0: eine Kachel ohne Ausdehnung waere im Canvas
 * unauffindbar und im Modell eine Kachel, die es nicht gibt. Sie wird VOR dem
 * Einrasten geprueft, damit auch ein grobes Raster nie auf 0 rastet.
 */
export function snapSize(box, dx, dy, step) {
  return {
    w: Math.max(1, snapValue(int(box?.w) + int(dx), step)),
    h: Math.max(1, snapValue(int(box?.h) + int(dy), step)),
  }
}

/** Die Vorgabe-Box, die eine Kachel im Pixel-Modus bekommt, wenn sie keine traegt. */
export const DEFAULT_BOX = { x: 0, y: 0, w: 2, h: 2 }

/**
 * Dieselbe Liste, aber jede Kachel mit einer vollstaendigen Box.
 *
 * Gebraucht wird das genau einmal: eine Seite im responsiven Modus traegt KEINE
 * Koordinaten (Design-Invariante §1.1), und wer sie danach auf „Pixel" stellt,
 * muss irgendwo anfangen. Die Vorgabe ist dieselbe wie im Backend-Modell
 * (`WidgetInstance`), damit der Editor keine dritte Zahl erfindet. Kachel, die
 * schon eine Box hat, wird nicht angefasst.
 */
export function ensureBoxes(list) {
  return (Array.isArray(list) ? list : []).map((item) => {
    const filled = { ...item }
    for (const key of ['x', 'y', 'w', 'h']) {
      if (typeof filled[key] !== 'number') filled[key] = DEFAULT_BOX[key]
    }
    return filled
  })
}

/** Die sechs Kanten/Mitten einer Box, nach Achse getrennt. */
function edges(box) {
  const x = int(box.x)
  const y = int(box.y)
  const w = int(box.w)
  const h = int(box.h)
  return {
    x: [x, x + w / 2, x + w],
    y: [y, y + h / 2, y + h],
  }
}

/**
 * Die Ausrichtlinien, die beim Ziehen von `activeId` erscheinen (E4).
 *
 * Verglichen werden linke/mittlere/rechte bzw. obere/mittlere/untere Kante des
 * aktiven Elements mit denselben Kanten JEDES anderen. Liegt ein Paar innerhalb
 * der Toleranz, entsteht eine Linie AN DER KANTE DES ANDEREN Elements - dorthin
 * zielt das Ausrichten, nicht auf die Zufallslage des gezogenen Elements. Jede
 * Linie erscheint genau einmal.
 */
export function guidesFor(boxes, activeId, tolerance = GUIDE_TOLERANCE) {
  const list = Array.isArray(boxes) ? boxes : []
  const active = list.find((b) => b && b.id === activeId)
  if (!active) return []
  const tol = Number.isFinite(Number(tolerance)) ? Math.abs(Number(tolerance)) : GUIDE_TOLERANCE
  const own = edges(active)
  const seen = new Set()
  const guides = []
  for (const other of list) {
    if (!other || other.id === activeId) continue
    const theirs = edges(other)
    for (const axis of ['x', 'y']) {
      for (const mine of own[axis]) {
        for (const at of theirs[axis]) {
          if (Math.abs(mine - at) > tol) continue
          const key = `${axis}:${at}`
          if (seen.has(key)) continue
          seen.add(key)
          guides.push({ axis, at })
        }
      }
    }
  }
  return guides
}

/** Die ausgewaehlten Boxen in der Reihenfolge der Seite (Namen ohne Box fallen weg). */
function selectionOf(boxes, ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : [])
  return (Array.isArray(boxes) ? boxes : []).filter((b) => b && wanted.has(b.id))
}

/**
 * „Verteilen" (E4): gleiche Abstaende zwischen den ausgewaehlten Elementen.
 *
 * Erst ab DREI Elementen sinnvoll und deshalb erst ab drei erlaubt - bei zweien
 * gibt es nur einen Abstand, und „alle Abstaende gleich" waere eine leere
 * Behauptung.
 *
 * Verteilt wird in der REIHENFOLGE DER SEITE, nicht nach der aktuellen X-Lage.
 * Das ist eine bewusste Entscheidung und keine Bequemlichkeit: die Reihenfolge
 * der Widget-Liste ist in diesem Modell der Boden (§2.1 - „Reihenfolge und
 * Gruppe sind der Boden, `position` ist additiv"), sie ist zugleich die
 * Z-Ordnung, und das Abnahmekriterium E4 misst die Abstaende genau in dieser
 * Reihenfolge. Eine Verteilung nach der Zufallslage haette Abstaende, die je
 * nach Vorgeschichte der Seite gleich sind oder nicht.
 *
 * Der linke Anker (das kleinste x der Auswahl) bleibt stehen. Die Schrittweite
 * wird auf eine GANZE Einheit gerundet, weil das Backend-Modell nur ganze Zahlen
 * speichert: ein „exakt gleicher" Abstand aus einer Division mit Rest waere nach
 * dem Speichern keiner mehr.
 */
export function distributeHorizontally(boxes, ids) {
  const selection = selectionOf(boxes, ids)
  if (selection.length < 3 || selection.length !== new Set(ids).size) return null
  const xs = selection.map((box) => int(box.x))
  const first = Math.min(...xs)
  const last = Math.max(...xs)
  const step = Math.max(1, Math.round((last - first) / (selection.length - 1)))
  const next = {}
  selection.forEach((box, i) => {
    next[box.id] = first + i * step
  })
  return next
}

/**
 * „Gleiche Groesse" (E4): die Masse des ZUERST gewaehlten Elements gehen an alle
 * anderen. „Zuerst gewaehlt" ist die Reihenfolge der Seite, damit die Aktion
 * wiederholbar ist und nicht von der Klickfolge abhaengt.
 */
export function matchSize(boxes, ids) {
  const selection = selectionOf(boxes, ids)
  if (selection.length < 2) return null
  const { w, h } = selection[0]
  const next = {}
  for (const box of selection) next[box.id] = { w: int(w), h: int(h) }
  return next
}

/** Die Liste ohne das Element `id`, plus dessen Index (oder -1). */
function without(list, id) {
  const items = Array.isArray(list) ? list : []
  const index = items.findIndex((item) => item && item.id === id)
  return { items, index }
}

/**
 * Z-Ordnung „nach vorne" (E8). Die Zeichenreihenfolge IST die Reihenfolge der
 * Widget-Liste: das letzte Kind liegt oben. Damit ist die Z-Ordnung dieselbe
 * Groesse wie die Reihenfolge im responsiven Modus - „Reihenfolge ist der Boden".
 */
export function bringToFront(list, id) {
  const { items, index } = without(list, id)
  if (index < 0) return [...items]
  const next = [...items]
  next.push(next.splice(index, 1)[0])
  return next
}

/** Z-Ordnung „nach hinten" (E8): erstes Kind, also ganz unten. */
export function sendToBack(list, id) {
  const { items, index } = without(list, id)
  if (index < 0) return [...items]
  const next = [...items]
  next.unshift(next.splice(index, 1)[0])
  return next
}

/**
 * Ein Element an eine andere Stelle der Liste setzen - der Drag des responsiven
 * Modus (E2). Unmoegliche Indizes aendern nichts, statt still zu verrutschen.
 */
export function moveItem(list, from, to) {
  const items = Array.isArray(list) ? [...list] : []
  if (!Number.isInteger(from) || !Number.isInteger(to)) return items
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const [moved] = items.splice(from, 1)
  items.splice(to, 0, moved)
  return items
}
