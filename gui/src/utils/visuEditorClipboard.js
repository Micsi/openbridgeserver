/**
 * Die Zwischenablage des V2-Editors (M5 C5, Issue #172 - Messlatte E6).
 *
 * SIE MUSS EINEN SEITENWECHSEL UEBERLEBEN, denn genau das verlangt die Zeile:
 * „Copy/Paste/Duplizieren eines Elements, AUCH SEITENUEBERGREIFEND". Der Editor
 * laedt beim Wechsel der Seite die Adresse neu - ein Modulzustand waere damit
 * weg. Traeger ist deshalb der `localStorage`, wie schon bei der Skin-Wahl je
 * Seite (`utils/visuSkins.js`).
 *
 * SIE IST NICHT DIE SYSTEM-ZWISCHENABLAGE. `navigator.clipboard` traegt Text,
 * verlangt einen sicheren Kontext (den ein OBS im LAN ueber `http://` nicht hat)
 * und fragt je nach Browser nach Erlaubnis. Ein Editor, dessen Kopieren an einer
 * Berechtigungsabfrage haengt, ist kein Editor. Kopiert werden hier ausserdem
 * keine Zeichen, sondern Kacheln.
 *
 * SIE KOMMT OHNE SPEICHER AUS - halb. Ein Browser ohne Speicherzugriff
 * (privater Modus, gesperrte Herkunft) wirft beim Schreiben; Kopieren und
 * Einfuegen auf DERSELBEN Seite duerfen daran nicht scheitern, und deshalb
 * haelt dieses Modul den Inhalt zusaetzlich im Speicher. Der Seitenwechsel
 * scheitert dann sehr wohl - {@link writeClipboard} meldet das als `false`,
 * statt es zu verschweigen.
 */

/** Der Schluessel im `localStorage`. Eigener Praefix, damit nichts kollidiert. */
export const CLIPBOARD_KEY = 'obs-visu-editor-clipboard'

/** Die Form, in der die Ablage abgelegt wird - versioniert, damit sie wachsen kann. */
const CLIPBOARD_VERSION = 1

/**
 * Der Inhalt fuer DIESE Sitzung, falls der Speicher nicht mitspielt.
 * Er ist die Rueckfallebene, nicht die Wahrheit: gelesen wird zuerst der
 * Speicher, denn nur er hat den Seitenwechsel gesehen.
 */
let inMemory = []

/** Eine tiefe Kopie aus reinen Daten. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Nur was eine Id traegt, ist eine Kachel - alles andere ist kein Inhalt. */
function usable(widgets) {
  if (!Array.isArray(widgets)) return []
  return widgets.filter((w) => w && typeof w === 'object' && typeof w.id === 'string' && w.id)
}

/**
 * Die Auswahl in die Ablage legen.
 *
 * Gibt `false` zurueck, wenn der Inhalt leer war (dann bleibt die alte Ablage
 * stehen - ein Kopieren ohne Auswahl soll nicht die vorige Kopie vernichten)
 * oder wenn der Speicher sie nicht annimmt (dann gilt sie nur fuer diese Seite).
 */
export function writeClipboard(widgets) {
  const items = usable(widgets)
  if (items.length === 0) return false
  inMemory = plain(items)
  try {
    globalThis.localStorage?.setItem(
      CLIPBOARD_KEY,
      JSON.stringify({ version: CLIPBOARD_VERSION, widgets: items }),
    )
    return true
  } catch {
    // Kein Speicherzugriff: die Ablage gilt fuer diese Seite, nicht darueber
    // hinaus. Der Rueckgabewert sagt es, der Aufrufer entscheidet.
    return false
  }
}

/**
 * Der Inhalt der Ablage - immer eine Liste, nie `null`.
 *
 * Gelesen wird zuerst der Speicher (er hat den Seitenwechsel gesehen), dann der
 * eigene Inhalt dieser Sitzung. Was dort steht, ist fremder Text: kaputtes JSON,
 * ein fremder Schluessel, eine Kachel ohne Id - alles davon macht die Ablage
 * leer und nicht den Editor kaputt.
 */
export function readClipboard() {
  try {
    const raw = globalThis.localStorage?.getItem(CLIPBOARD_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const items = usable(parsed?.widgets)
      if (items.length > 0) return plain(items)
    }
  } catch {
    // Weder lesbar noch verstaendlich - dann eben der eigene Inhalt.
  }
  return plain(inMemory)
}

/** Die Ablage leeren - im Speicher UND in dieser Sitzung. */
export function clearClipboard() {
  inMemory = []
  try {
    globalThis.localStorage?.removeItem(CLIPBOARD_KEY)
  } catch {
    // Ohne Speicherzugriff gab es dort auch nichts zu leeren.
  }
}
