/**
 * Zugang zum Visu-Editor (M5 C4, Issue #171).
 *
 * Owner-Entscheid (CONTRIBUTING-visu-m5.md §2.4): der V2-Editor lebt in der
 * Admin-GUI, nicht in der Visu — genau weil hier die Berechtigungen ausgewertet
 * werden. Diese Datei haelt die drei Entscheidungen fest, die daraus folgen, als
 * reine Funktionen (testbar ohne Router und ohne Store):
 *
 *  1. Wer darf den Bereich sehen?          → {@link canUseVisuEditor}
 *  2. Was tut die Route bei jemand anderem? → {@link visuEditorGuard}
 *  3. Mit welchem Origin spricht die Bruecke? → {@link previewOriginOf}
 */

/** Pfad des Admin-Bereichs. Eine Stelle, damit Menue, Route und Gate nicht driften. */
export const VISU_EDITOR_ROUTE = '/visu-editor'

/**
 * Wo die eingebettete Vorschau liegt (der `/preview`-Modus von `apps/visu`).
 *
 * BAUZEIT-Konfiguration, bewusst nicht aus der URL: der erlaubte Origin der
 * Bruecke wird daraus abgeleitet, und ein aus der Adresszeile gelesener Origin
 * waere gar keine Pruefung mehr. Der Standardpfad ist relativ, also
 * same-origin — der Normalfall, weil FastAPI Admin-GUI und Visu ausliefert.
 */
export const VISU_PREVIEW_URL = import.meta.env.VITE_VISU_PREVIEW_URL || '/visu-v2/preview'

/**
 * Darf dieser Auth-Zustand den Visu-Editor benutzen?
 *
 * Beide Bedingungen zaehlen: angemeldet UND Admin. Ein `is_admin`-Flag ohne
 * Anmeldung ist kein Zugang, sondern ein Rest aus einer alten Sitzung.
 */
export function canUseVisuEditor(auth) {
  if (!auth) return false
  return auth.isLoggedIn === true && auth.isAdmin === true
}

/**
 * Router-Wache fuer admin-pflichtige Routen. Gibt das Redirect-Ziel zurueck oder
 * `undefined`, wenn nichts zu tun ist — fremde Routen bleiben unberuehrt.
 */
export function visuEditorGuard(to, auth) {
  if (!to || !to.meta || to.meta.admin !== true) return undefined
  return canUseVisuEditor(auth) ? undefined : { name: 'Dashboard' }
}

/**
 * Der Origin, mit dem die Vorschau-Bruecke sprechen darf — aus der Vorschau-URL
 * gegen die eigene Adresse aufgeloest. `null`, wenn die URL unbrauchbar ist:
 * lieber gar keine Bruecke als eine, die an jeden sendet.
 */
export function previewOriginOf(url, base) {
  if (typeof url !== 'string' || url.length === 0) return null
  try {
    return new URL(url, base).origin
  } catch {
    return null
  }
}
