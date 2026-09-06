/**
 * Export und Import einer Seite als Datei (M5 C6, Issue #173, Messlatte E18).
 *
 * KEIN neuer Endpunkt: exportiert wird ueber `GET /visu/nodes/{id}/export`,
 * eingelesen ueber `POST /visu/nodes/import` - beide gibt es seit V1. Hier
 * liegt nur, was dazwischen im Browser passiert: wie die Datei heisst, wie sie
 * den Rechner des Autors erreicht, und was beim Einlesen ABGELEHNT wird.
 *
 * WARUM ABGELEHNT WIRD, statt es dem Backend zu ueberlassen: eine Datei, die
 * gar kein Visu-Export ist, liefe dort in einen 400, den der Autor nicht mehr
 * seinem Griff in den falschen Ordner zuordnen kann. Der naechstgelegene Ort
 * der Ablehnung ist der bessere.
 *
 * WAS DER EXPORT NICHT LEISTET (bewusst, siehe `CONTRIBUTING-visu-m5.md` §2.1):
 * `GET /nodes/{id}/export` liest die Spalte roh, an der Modellschicht vorbei,
 * und ist deshalb nicht dublettenfrei. Der Weg zurueck laeuft dagegen durch das
 * Modell (`PageConfig.model_validate` im Import), womit der Kreis trotzdem
 * dieselbe Seite ergibt. Belegt in `tests/unit/test_visu_page_versions.py`.
 */

/** Nur diese Kennung ist ein Visu-Export (`obs/api/v1/visu.py` → `export_node`). */
export const EXPORT_MARKER = 'visu_subtree'

/** Wie lang ein Dateiname insgesamt werden darf. */
const MAX_FILENAME = 128
const SUFFIX = '_visu.json'

/**
 * Der Name der Ausfuhr - nach der Seite, damit der Autor sie im Ordner
 * wiederfindet. Alles, was in einem Dateinamen nichts zu suchen hat, wird zu
 * einem Unterstrich; ein Name, der gar keiner ist, bekommt einen neutralen.
 */
export function exportFileName(pageName) {
  const roh = typeof pageName === 'string' ? pageName.trim() : ''
  const sauber = roh.replace(/[^\w.-]/g, '_')
  const basis = sauber || 'visu_export'
  return `${basis.slice(0, MAX_FILENAME - SUFFIX.length)}${SUFFIX}`
}

/**
 * Eine gewaehlte Datei als Export-Dokument lesen.
 *
 * Rueckgabe `{ ok: true, document }` oder `{ ok: false, reason }` mit `reason`
 * aus `missing` (keine Datei gewaehlt), `unreadable` (nicht lesbar), `syntax`
 * (kein JSON) und `shape` (JSON, aber kein Visu-Export).
 */
export async function readExportDocument(file) {
  if (!file || typeof file.text !== 'function') return { ok: false, reason: 'missing' }
  let text
  try {
    text = await file.text()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'syntax' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'shape' }
  }
  if (parsed.obs_export !== EXPORT_MARKER) return { ok: false, reason: 'shape' }
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return { ok: false, reason: 'shape' }
  return { ok: true, document: parsed }
}

/**
 * Das Dokument als Datei ausgeben.
 *
 * Ein Anker mit `download` ist die einzige Affordanz, die im Browser eine echte
 * Ausfuhr ausloest - und die einzige, die eine Automatisierung als Ladevorgang
 * sieht. Die Blob-Adresse wird erst spaeter freigegeben: der Ladevorgang
 * beginnt asynchron, und ein sofortiges `revokeObjectURL` nimmt ihm die Quelle
 * unter den Fuessen weg.
 */
export function triggerJsonDownload(document_, filename, { revokeAfterMs = 60_000 } = {}) {
  const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs)
  return url
}

/**
 * Ein Name fuer die importierte Seite, der im Baum nicht schon vergeben ist.
 *
 * WARUM UEBERHAUPT UMBENENNEN: der Import legt eine EIGENE, neue Seite an (das
 * ist die Zusage von E18). Landet sie in derselben Instanz, in der auch die
 * Vorlage steht, stuende der Name danach zweimal im Baum - und der Autor haette
 * zwei Zeilen, die er nicht auseinanderhalten kann. Das Backend verlangt beim
 * Kopieren aus genau diesem Grund einen neuen Namen (``CopyNodeRequest.new_name``
 * ist Pflicht); der Import bekommt hier dieselbe Hoeflichkeit.
 *
 * NUR WENN NOETIG: ist der Name frei (der Normalfall beim Einlesen in eine
 * frische Instanz), bleibt er unveraendert. Ein Import ist keine Kopie, solange
 * es nichts zu unterscheiden gibt.
 *
 * NUR DIE WURZEL: die Namen der Seiten UNTER ihr bleiben, wie sie sind. Sie sind
 * durch ihren Elternknoten unterschieden, und sie umzubenennen waere ein
 * Eingriff in die Struktur, die der Autor exportiert hat.
 *
 * ``format(name, index)`` baut den Vorschlag - die Beschriftung gehoert der
 * Ansicht (i18n), nicht dieser Regel.
 */
export function uniqueImportName(name, taken, format) {
  const vergeben = new Set(Array.isArray(taken) ? taken : [])
  if (!vergeben.has(name)) return name
  for (let index = 1; index <= 500; index += 1) {
    const kandidat = format(name, index)
    if (!vergeben.has(kandidat)) return kandidat
  }
  // 500 gleichnamige Kopien sind kein Bedienfall mehr, sondern ein Skript. Statt
  // ewig zu suchen, entscheidet dann die Uhr - eindeutig, wenn auch haesslich.
  return format(name, Date.now())
}
