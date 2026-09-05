/**
 * Der Seitentyp des V2-Editors (M5 C1, Issue #168 — Regel R1, Messlatte E9).
 *
 * Edomi kennt VIER Seitentypen: normal, Inkludeseite, globale Inkludeseite,
 * Popup. Das OBS-Backend kennt DREI Spaltenwerte (`obs/models/visu.py →
 * PageKind`), und das ist kein Versehen, sondern der A0-Entscheid:
 *
 *   „Individuelle Inkludeseiten sind gewöhnliche Seiten, die woanders in
 *    PageConfig.includes referenziert werden, sie brauchen keinen eigenen Typ."
 *
 * Der Editor muss trotzdem die vier Namen zeigen, sonst fehlt dem Autor Edomis
 * Vokabular. Er erfindet dafuer aber KEINE zweite Datenquelle: „Inkludeseite"
 * ist eine ABGELEITETE Rolle — wird die Seite irgendwo inkludiert, ist sie eine.
 * Damit bleibt genau eine Wahrheit (die `includes`-Listen im Backend), und die
 * Abbildung in beide Richtungen ist verlustfrei fuer alles, was das Backend
 * speichert.
 *
 * Reine Funktionen: kein Zustand, kein Netz, keine Vue-Abhaengigkeit.
 */

/** Die vier Typen, die der Editor anbietet — in Edomis Reihenfolge (R1). */
export const EDITOR_PAGE_KINDS = Object.freeze(['normal', 'include', 'globalInclude', 'popup'])

/** Die drei Werte, die die Spalte `visu_nodes.kind` traegt. */
export const BACKEND_PAGE_KINDS = Object.freeze(['normal', 'globalInclude', 'popup'])

/**
 * Editor-Typ → Backend-Wert. „Inkludeseite" faellt auf `normal` zurueck, weil
 * das Backend fuer sie keinen eigenen Wert kennt (und keinen braucht).
 * Alles Unbekannte wird `normal` — derselbe Default wie im Modell, damit eine
 * kaputte Eingabe nie einen fremden Typ erzeugt.
 */
export function toBackendKind(editorKind) {
  if (editorKind === 'popup') return 'popup'
  if (editorKind === 'globalInclude') return 'globalInclude'
  return 'normal'
}

/**
 * Backend-Wert → Editor-Typ. `referenced` sagt, ob die Seite in der
 * `includes`-Liste irgendeiner anderen Seite steht; nur dann heisst eine
 * normale Seite im Editor „Inkludeseite".
 *
 * Ein fehlender Wert (Bestandsseite eines Servers vor M5, R17) gilt als
 * `normal` — exakt der Backend-Default.
 */
export function toEditorKind(backendKind, { referenced = false } = {}) {
  if (backendKind === 'popup') return 'popup'
  if (backendKind === 'globalInclude') return 'globalInclude'
  return referenced ? 'include' : 'normal'
}

/**
 * Darf dieser Typ ueberhaupt Seiten inkludieren?
 *
 * Nein fuer die globale Inkludeseite (R12, eine Ebene) und fuer das Popup (R9,
 * die Komposition entscheidet). Genau die beiden Faelle lehnt
 * `_validate_page_kind_config` mit 400 ab.
 */
export function supportsIncludes(editorKind) {
  return editorKind === 'normal' || editorKind === 'include'
}

/** Traegt dieser Typ einen Popup-Deskriptor (R2-R6)? */
export function supportsPopup(editorKind) {
  return editorKind === 'popup'
}

/**
 * Alle Seiten-IDs, die irgendwo inkludiert werden — die Grundlage der
 * abgeleiteten Rolle „Inkludeseite".
 *
 * @param {Record<string, {includes?: string[]}>|null} pageConfigs
 * @returns {Set<string>}
 */
export function collectReferencedPageIds(pageConfigs) {
  const referenced = new Set()
  if (!pageConfigs || typeof pageConfigs !== 'object') return referenced
  for (const config of Object.values(pageConfigs)) {
    const includes = config && Array.isArray(config.includes) ? config.includes : []
    for (const target of includes) referenced.add(target)
  }
  return referenced
}
