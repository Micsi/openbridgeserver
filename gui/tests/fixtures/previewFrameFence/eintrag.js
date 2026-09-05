/**
 * Pruefstueck fuer den Blattscan (M5 C4, Issue #171).
 *
 * Ein Einstieg, der ein Blatt NEBEN dem Quellverzeichnis einbindet - und zwar
 * einmal direkt und einmal ueber ein Zwischenmodul. Genau so ging der Angriff
 * der Kritik R10 (X8): `gui/theme-extra.css` lag ausserhalb von `gui/src`, wurde
 * von `main.js` importiert, landete woertlich im gebauten Blatt und blieb
 * ungelesen, weil der Scan nur ein VERZEICHNIS ablief statt den Importen zu
 * folgen.
 *
 * Diese Datei wird nie gebaut und nie ausgeliefert; sie steht hier, damit die
 * Gegenprobe zum Import-Weg fallen kann, ohne dass eine Probe im Produktbaum
 * zurueckbleibt.
 */
import './nebenblatt.css'
import { zwischenwert } from './zwischenmodul.js'

export const wert = zwischenwert
