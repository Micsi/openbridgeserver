/**
 * Der Speicherplan einer Seite (M5 C1, Issue #168).
 *
 * Eine Seite liegt im Backend an ZWEI Stellen, und beide validieren
 * gegeneinander:
 *
 *   `PATCH /visu/nodes/{id}` — Name, `kind`, `order`, Icon, Zugriff, PIN,
 *      Zielgruppe. Ein neuer `kind` wird gegen die GESPEICHERTE Konfiguration
 *      geprueft (`_apply_kind_change`): ein Wechsel Popup → globale
 *      Inkludeseite scheitert, solange der alte `popup`-Deskriptor in der Zeile
 *      steht.
 *   `PUT /visu/pages/{id}` — `includes`, `ignore_global_includes`, `popup`.
 *      Geprueft wird gegen den GESPEICHERTEN `kind` (`node.kind`): ein
 *      `popup`-Deskriptor an einer Seite, die im Backend noch `normal` heisst,
 *      ist 400.
 *
 * Daraus folgt eine Reihenfolge, die man nicht raten darf. Ohne Typwechsel
 * genuegen zwei Schritte. MIT Typwechsel sind es drei: erst die Konfiguration
 * entschaerfen (Popup und Includes weg — das passt unter JEDEN alten Typ), dann
 * den Typ setzen, dann die neue Konfiguration schreiben.
 *
 * Der Plan ist DATEN, kein Ablauf: so ist die Reihenfolge pruefbar, statt in
 * einer `async`-Kette zu verschwinden.
 */

import { toBackendKind } from '@/utils/visuPageKind'
import { DEFAULT_VISU_SKIN, withPageSkin } from '@/utils/visuSkins'

/** Die Vorgabe-Konfiguration einer frisch angelegten Seite (`PageConfig()`). */
const DEFAULT_PAGE_CONFIG = Object.freeze({
  grid_cols: 12,
  grid_row_height: 80,
  grid_cell_width: 80,
  background: null,
  widgets: [],
  includes: [],
  ignore_global_includes: false,
  popup: null,
})

/**
 * Die Konfiguration, die geschrieben werden soll — Bestand plus die C1-Felder.
 *
 * Der Skin geht nur mit, wenn das Backend das Feld ueberhaupt fuehrt
 * (`skinSupported`, siehe `visuSkins.js`): heute faellt ein unbekanntes Feld in
 * `PageConfig` still weg, und ein still weggeworfener Wert waere schlimmer als
 * gar keiner. Sobald Teil C2 das Feld ergaenzt hat, schreibt derselbe Pfad ihn
 * mit — ohne eine Zeile Aenderung hier.
 */
function pageBody(draft, storedConfig, { includes, popup, skinSupported }) {
  const base = storedConfig ? { ...storedConfig } : { ...DEFAULT_PAGE_CONFIG, widgets: [] }
  return withPageSkin(
    {
      ...base,
      includes,
      ignore_global_includes: draft.ignoreGlobalIncludes === true,
      popup: popup ?? null,
    },
    draft.skin,
    skinSupported === true,
  )
}

/** Weicht die Konfiguration ueberhaupt von der Vorgabe ab? */
function differsFromDefault(body) {
  return (
    (body.includes ?? []).length > 0 ||
    body.ignore_global_includes === true ||
    body.popup !== null ||
    (body.skin !== undefined && body.skin !== DEFAULT_VISU_SKIN)
  )
}

/** Der Knoten-Rumpf fuer `PATCH /visu/nodes/{id}`. */
function nodeBody(draft, { kind }) {
  const body = {
    name: draft.name,
    order: draft.order,
    icon: draft.icon ?? null,
    access: draft.access ?? null,
  }
  if (kind !== undefined) body.kind = kind
  if (draft.pin) body.access_pin = draft.pin
  // Die Zielgruppe geht NUR bei Zugriff „user" mit: alles andere quittiert das
  // Backend mit 422 (`visu_target_audience_requires_user_access`), und bei einem
  // Wechsel raeumt es die Zuordnung ohnehin selbst weg.
  if (draft.access === 'user') body.usernames = [...(draft.usernames ?? [])]
  return body
}

/**
 * @param {object|null} draft   Der Entwurf aus dem Editor.
 * @param {object} [stored]     `{ node: VisuNodeSummary|null, config: PageConfig|null,
 *                                skinSupported?: boolean }`
 * @returns {Array<{op: 'createNode'|'patchNode'|'savePage', nodeId: string|null, body: object}>}
 */
export function planPageSave(draft, stored = {}) {
  if (!draft) return []
  const node = stored.node ?? null
  const storedConfig = stored.config ?? null
  const isPage = draft.type !== 'LOCATION'
  const kind = toBackendKind(draft.editorKind)
  const includes = isPage ? [...(draft.includes ?? [])] : []
  const popup = isPage ? (draft.popup ?? null) : null
  const skinSupported = stored.skinSupported === true

  if (!draft.id) {
    const steps = [
      {
        op: 'createNode',
        nodeId: null,
        body: {
          parent_id: draft.parentId ?? null,
          name: draft.name,
          type: draft.type ?? 'PAGE',
          kind,
          order: draft.order ?? 0,
          icon: draft.icon ?? null,
          access: draft.access ?? null,
          access_pin: draft.pin || null,
        },
      },
    ]
    if (isPage) {
      const body = pageBody(draft, null, { includes, popup, skinSupported })
      if (differsFromDefault(body)) steps.push({ op: 'savePage', nodeId: null, body })
    }
    // `POST /visu/nodes` kennt keine Zielgruppe — sie kommt als eigener Schritt
    // nach, sonst waere eine neue user-Seite ohne Publikum.
    if (draft.access === 'user' && (draft.usernames ?? []).length > 0) {
      steps.push({ op: 'patchNode', nodeId: null, body: { usernames: [...draft.usernames] } })
    }
    return steps
  }

  const storedKind = node?.kind ?? 'normal'
  const kindChanges = kind !== storedKind
  const final = isPage ? pageBody(draft, storedConfig, { includes, popup, skinSupported }) : null

  if (!kindChanges) {
    const steps = [{ op: 'patchNode', nodeId: draft.id, body: nodeBody(draft, {}) }]
    if (isPage) steps.push({ op: 'savePage', nodeId: draft.id, body: final })
    return steps
  }

  const steps = []
  if (isPage) {
    // Schritt 1 entschaerft: ohne Popup und ohne Includes passt die
    // Konfiguration unter jeden alten Typ, und `_apply_kind_change` findet in
    // Schritt 2 nichts mehr vor, woran der Wechsel scheitern koennte.
    steps.push({
      op: 'savePage',
      nodeId: draft.id,
      body: pageBody(draft, storedConfig, { includes: [], popup: null, skinSupported }),
    })
  }
  steps.push({ op: 'patchNode', nodeId: draft.id, body: nodeBody(draft, { kind }) })
  if (isPage) steps.push({ op: 'savePage', nodeId: draft.id, body: final })
  return steps
}
