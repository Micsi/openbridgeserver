/**
 * Pruefstueck fuer den Blattscan (M5 C4, Issue #171, Kritik R11 Y2).
 *
 * Zwei Spezifizierer, die der Scan NICHT zu einer gelesenen Datei macht: einer
 * zeigt aus `gui/` heraus (die Datei existiert, liegt aber ausserhalb der
 * Wurzel), einer zeigt ins Leere. Beide wurden bis Kritik R11 kommentarlos
 * verworfen; jetzt muessen beide namentlich gemeldet werden.
 *
 * Diese Datei wird nie gebaut und nie ausgeliefert.
 */
import '../../../../eslint.config.js'
import './gibt-es-nicht.css'
import 'tailwindcss'

export const wert = 3
