/**
 * Die Rechenregeln der Editor-Ergonomie (M5 C5, Issue #172).
 *
 * Reine Funktionen, kein DOM, kein Vue, kein Zustand - dieselbe Bauart wie
 * `visuEditorLayout.js` (C2) und aus demselben Grund: die Messlatte nennt diese
 * Faehigkeiten einzeln (E5 Rahmenauswahl/Gruppen, E6 Kopieren/Einfuegen,
 * E7 Nudging), und eine falsche Zahl soll eine Zeile sein statt einer Sitzung im
 * Browser.
 *
 * EINHEITEN: wie in C2 Autoreneinheiten aus dem Backend-Modell
 * (`WidgetInstance.x/y/w/h`, ganze Zahlen). Der Canvas zeichnet eine Einheit als
 * einen CSS-Pixel; die Rahmenauswahl rechnet deshalb in derselben Groesse wie
 * das Modell und braucht keine Umrechnung.
 *
 * WO DIE GRUPPE WOHNT: in `WidgetInstance.config.editor.group`, also neben
 * `locked` und `hidden` (C2, `visuEditorPage.js`). Das ist bewusst KEINE zweite
 * Liste neben der Seite: eine Gruppe, die als eigenes Feld der `PageConfig`
 * lebte, muesste bei jedem Kopieren, Einfuegen und Loeschen nachgezogen werden
 * und liefe frueher oder spaeter aus dem Tritt. Am Widget kann sie das nicht -
 * sie faehrt mit, wohin das Widget faehrt, und ein geloeschtes Widget nimmt sie
 * mit. Der Vertrag laesst `config` ausdruecklich offen.
 */

import { widgetFlags } from '@/utils/visuEditorPage'

/** Der Schluessel der Gruppe innerhalb der Editor-Marken eines Widgets. */
export const GROUP_KEY = 'group'

/** Eine ganze Zahl aus allem, was hereinkommt - `NaN` wird zu 0. */
function int(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** Traegt dieses Element eine vollstaendige, rechenbare Box? */
function boxOf(widget) {
  if (!widget || typeof widget !== 'object') return null
  for (const key of ['x', 'y', 'w', 'h']) {
    if (typeof widget[key] !== 'number' || !Number.isFinite(widget[key])) return null
  }
  return { x: widget.x, y: widget.y, w: widget.w, h: widget.h }
}

/** Eine Liste, auch wenn keine hereinkam. */
function list(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Der aufgezogene Rahmen aus zwei Punkten - in JEDER Zugrichtung dieselbe Box.
 *
 * Ohne diese Normalisierung waere ein Zug von rechts unten nach links oben eine
 * Box mit negativer Breite, und die Auswahl daraus waere leer: der haeufigste
 * Zug eines Autors („alles einsammeln, von der Ecke her") faende dann nichts.
 */
export function normalizeRect(a, b) {
  const x0 = int(a?.x)
  const y0 = int(a?.y)
  const x1 = int(b?.x)
  const y1 = int(b?.y)
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  }
}

/**
 * Die Elemente, die der Rahmen UMSCHLIESST (E5).
 *
 * Umschlossen heisst umschlossen: ein Element, das der Rahmen nur anschneidet,
 * ist nicht gewaehlt. Das ist die Regel des belegten Champions (ioBroker vis-2)
 * und die einzige, die sich ohne Blick in den Code voraussagen laesst - „wer
 * beruehrt wird, ist dabei" sammelt beim Ziehen ueber eine dichte Seite alles
 * ein, was zufaellig am Weg lag.
 *
 * Kantendeckung zaehlt als umschlossen: ein Rahmen, der genau auf der Kante
 * endet, hat das Element ganz erfasst.
 *
 * Ein Rahmen ohne Ausdehnung waehlt nichts - er ist ein Klick auf den leeren
 * Grund und soll die Auswahl leeren, nicht ein Element am Ursprung treffen.
 *
 * Gesperrte und ausgeblendete Elemente sind dabei: WAEHLEN ist nicht AENDERN.
 * Ein gesperrtes Element darf man ansehen und in eine Gruppe stecken; bewegt
 * wird es trotzdem nicht (siehe {@link nudged}).
 */
export function idsInRect(widgets, rect) {
  const r = {
    x: int(rect?.x),
    y: int(rect?.y),
    w: Math.max(0, int(rect?.w)),
    h: Math.max(0, int(rect?.h)),
  }
  if (r.w <= 0 || r.h <= 0) return []
  const found = []
  for (const widget of list(widgets)) {
    const box = boxOf(widget)
    if (!box) continue
    if (box.x < r.x || box.y < r.y) continue
    if (box.x + box.w > r.x + r.w || box.y + box.h > r.y + r.h) continue
    found.push(widget.id)
  }
  return found
}

/**
 * Die Auswahl um `dx`/`dy` verschieben (E5 Gruppenverschieben, E7 Nudging).
 *
 * OHNE EINRASTEN. Das ist der Unterschied zum Ziehen mit der Maus und Absicht:
 * die Pfeiltaste ist das Werkzeug fuer den letzten Pixel, den das Raster gerade
 * verhindert. Ein Nudge, der auf das Raster zurueckfaellt, waere entweder ein
 * Sprung ueber die halbe Rasterweite oder gar keine Bewegung - beides ist nicht,
 * was E7 verlangt („nudgen pixelweise").
 *
 * GESPERRTE ELEMENTE BLEIBEN STEHEN (E8), auch mitten in einer Auswahl. Der
 * Rueckgabewert sagt deshalb, ob ueberhaupt etwas passiert ist: nur dann ist die
 * Taste verbraucht (und nur dann gehoert der Schritt auf den Undo-Stapel).
 *
 * Der Ursprung ist die Grenze - negativ gibt es auf dem Canvas nicht.
 */
export function nudged(widgets, ids, dx, dy) {
  const wanted = new Set(list(ids))
  let moved = false
  const next = list(widgets).map((widget) => {
    if (!wanted.has(widget?.id)) return widget
    if (widgetFlags(widget).locked) return widget
    const box = boxOf(widget)
    if (!box) return widget
    const x = Math.max(0, box.x + int(dx))
    const y = Math.max(0, box.y + int(dy))
    if (x === box.x && y === box.y) return widget
    moved = true
    return { ...widget, x, y }
  })
  return { widgets: moved ? next : list(widgets).map((w) => w), moved }
}

/** Die Gruppe eines Elements - `null`, wenn es zu keiner gehoert. */
export function groupIdOf(widget) {
  const raw = widget && widget.config ? widget.config.editor : null
  const id = raw && typeof raw[GROUP_KEY] === 'string' ? raw[GROUP_KEY].trim() : ''
  return id || null
}

/**
 * Eine Kopie des Widgets in (oder ohne) Gruppe; das Original bleibt stehen.
 * Die uebrigen Marken (`locked`, `hidden`) bleiben unangetastet - sie gehoeren
 * demselben Objekt, und eine Gruppierung darf keine Sperre aufheben.
 */
export function withGroup(widget, groupId) {
  const editor = { ...(widget && widget.config ? widget.config.editor : null) }
  const id = typeof groupId === 'string' ? groupId.trim() : ''
  if (id) editor[GROUP_KEY] = id
  else delete editor[GROUP_KEY]
  return {
    ...widget,
    config: { ...(widget && widget.config ? widget.config : {}), editor },
  }
}

/**
 * Die Auswahl auf die vollstaendigen Gruppen ausweiten (E5).
 *
 * Das ist die halbe Bedeutung von „Gruppieren": wer ein Mitglied anfasst, fasst
 * die Gruppe an. Die andere Haelfte ist der gemeinsame Rahmen, den der Canvas
 * zeichnet.
 *
 * Zurueck kommen die Ids in der REIHENFOLGE DER SEITE und ohne Dubletten -
 * dieselbe Regel wie bei „Verteilen" und „Gleiche Groesse" (C2), damit jede
 * Aktion auf einer Auswahl reproduzierbar bleibt und nicht von der Klickfolge
 * abhaengt.
 */
export function expandToGroups(widgets, ids) {
  const items = list(widgets)
  const wanted = new Set(list(ids))
  const groups = new Set()
  for (const widget of items) {
    if (!wanted.has(widget?.id)) continue
    const group = groupIdOf(widget)
    if (group) groups.add(group)
  }
  return items
    .filter((widget) => wanted.has(widget?.id) || groups.has(groupIdOf(widget)))
    .map((widget) => widget.id)
}

/**
 * Je Gruppe ein Rahmen um alle ihre Mitglieder - das SICHTBARE einer Gruppe.
 *
 * Ohne ihn waere „Gruppieren" eine unsichtbare Eigenschaft, die man nur daran
 * merkt, dass ein Klick mehr faengt als erwartet. Eine Kachel ohne Box zieht den
 * Rahmen nicht auf `NaN`, sie bleibt draussen; eine Gruppe, von der keine
 * einzige Kachel eine Box traegt, bekommt gar keinen.
 */
export function groupFrames(widgets) {
  const frames = new Map()
  for (const widget of list(widgets)) {
    const group = groupIdOf(widget)
    if (!group) continue
    const box = boxOf(widget)
    if (!box) continue
    const found = frames.get(group)
    if (!found) {
      frames.set(group, { id: group, x: box.x, y: box.y, w: box.w, h: box.h })
      continue
    }
    const right = Math.max(found.x + found.w, box.x + box.w)
    const bottom = Math.max(found.y + found.h, box.y + box.h)
    found.x = Math.min(found.x, box.x)
    found.y = Math.min(found.y, box.y)
    found.w = right - found.x
    found.h = bottom - found.y
  }
  return [...frames.values()]
}

/**
 * Eine Id fuer eine Kopie oder eine Gruppe.
 *
 * `crypto.randomUUID()` fehlt oder wirft ausserhalb eines sicheren Kontexts
 * (OBS ueber schlichtes `http://` aus dem LAN ist ein normaler Betriebsfall) -
 * deshalb dieselbe Staffel wie in `utils/logicClipboard.js`: erst `randomUUID`,
 * dann `getRandomValues`, zuletzt `Math.random`. Sicherheitsrelevant ist hier
 * nichts; die Id muss nur innerhalb einer Seite eindeutig sein.
 */
export function newEditorId() {
  const c = globalThis.crypto
  if (c) {
    if (typeof c.randomUUID === 'function') {
      try {
        return c.randomUUID()
      } catch {
        // Manche Browser bieten `randomUUID` an und werfen ausserhalb eines
        // sicheren Kontexts - weiter zur naechsten Stufe.
      }
    }
    if (typeof c.getRandomValues === 'function') {
      const bytes = c.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
    }
  }
  return `w-${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/**
 * Die Kopien der Auswahl (E6: Duplizieren, Kopieren, Einfuegen).
 *
 * DREI REGELN, und jede hat einen Fehler, den sie verhindert:
 *
 *  1. JEDE KOPIE BEKOMMT EINE FRISCHE ID. Zwei Kacheln mit derselben Id auf
 *     einer Seite waeren fuer den Canvas, den Entwurf und den Server dieselbe
 *     Kachel - und beim Einfuegen auf einer ANDEREN Seite zeigten zwei Seiten
 *     auf dieselbe Id.
 *  2. EINE KOPIERTE GRUPPE WIRD EINE NEUE GRUPPE. Behielte die Kopie die
 *     Gruppen-Id des Originals, waere sie danach Mitglied DERSELBEN Gruppe: ein
 *     Klick auf das Original faenge die Kopie mit, und nach dem Einfuegen auf
 *     einer zweiten Seite gaebe es eine Gruppe ueber zwei Seiten hinweg. Zwei
 *     verschiedene Quellgruppen bleiben dabei zwei.
 *  3. NICHTS WIRD GETEILT. Die `config` wird tief kopiert; sonst aendert eine
 *     Bindung an der Kopie das Original mit.
 *
 * Der Versatz haelt die Kopie auffindbar (sie liegt sonst exakt unter dem
 * Original) und faellt am Ursprung auf 0 zurueck, statt ins Negative zu laufen.
 * Kopiert wird in der Reihenfolge der Seite, nicht in der der Klicks.
 */
export function copiesOf(widgets, ids, { offset = 0, newId = newEditorId } = {}) {
  const wanted = new Set(list(ids))
  const source = list(widgets).filter((widget) => wanted.has(widget?.id))
  if (source.length === 0) return []
  const groupMap = new Map()
  return source.map((widget) => {
    const copy = JSON.parse(JSON.stringify(widget))
    copy.id = newId()
    const box = boxOf(widget)
    if (box) {
      copy.x = Math.max(0, box.x + int(offset))
      copy.y = Math.max(0, box.y + int(offset))
    }
    const group = groupIdOf(widget)
    if (!group) return copy
    if (!groupMap.has(group)) groupMap.set(group, newId())
    return withGroup(copy, groupMap.get(group))
  })
}
