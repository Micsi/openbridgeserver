/**
 * Die verbotenen Kombinationen — abgefangen VOR dem Speichern (M5 C1, #168).
 *
 * Das Backend lehnt jede dieser Lagen ohnehin ab (400 bzw. 422); der Autor soll
 * es aber sehen, bevor er auf „Speichern" drueckt, und nicht danach einen
 * Statuscode vorgesetzt bekommen (Messlatte E9/E15).
 *
 * Jede Regel hier hat ihr Gegenstueck in `obs/api/v1/visu.py`:
 *
 *   `_validate_node_kind`            → kindOnlyForPages
 *   `_validate_page_kind_config`     → popupOnlyForPopupKind, globalIncludeCannotInclude,
 *                                      popupCannotInclude, selfInclude, includeTargetMissing,
 *                                      includeTargetNotAPage, includeTargetIsPopup
 *   `_assert_no_include_cycle`       → includeCycle
 *   `_assert_not_included_elsewhere` → includedPageCannotBecomePopup
 *   `update_node`                    → pinRequiresProtected, audienceRequiresUserAccess
 *   `_validate_target_usernames`     → audienceUserUnknown (422
 *                                      `visu_target_audience_invalid_users`)
 *
 * ZUR REIHENFOLGE, genau und nicht mehr: uebernommen ist die Reihenfolge
 * INNERHALB von `_validate_page_kind_config` — sobald der Seitentyp jeden
 * Include verbietet, prueft das Backend gar kein Ziel mehr, und der Editor sagt
 * dann denselben einen Satz statt zusaetzlich ueber Ziele zu reden, die nicht
 * zur Debatte stehen. Die Reihenfolge von `update_node` ist NICHT uebernommen:
 * dort steht die Zielgruppe zuerst (`visu.py:966`) und die PIN zuletzt
 * (`visu.py:1000`), hier stehen beide am Ende. Das ist folgenlos, weil der
 * Editor sammelt statt beim ersten Verstoss abzubrechen — der Autor sieht alle
 * Verstoesse auf einmal, das Backend nennt den ersten.
 *
 * ZWEI EIGENE REGELN OHNE BACKEND-GEGENSTUECK, beide ausdruecklich:
 *
 *   `nameRequired` — `name: str` laesst auch den leeren String zu. Eine
 *      namenlose Seite waere im Baum unauffindbar.
 *   `includeKindNeedsReference` / `normalKindWhileIncluded` — „Inkludeseite" ist
 *      nach dem A0-Entscheid eine ABGELEITETE Rolle (die Seite wird irgendwo
 *      inkludiert), kein Spaltenwert. Wer sie von Hand waehlt, bekaeme sonst
 *      „Gespeichert" und nach dem Reload wieder „normal" — ein Klick ohne
 *      Wirkung. Der Editor sagt stattdessen, wo die Rolle entschieden wird.
 *
 * WO DER EDITOR BEWUSST NACHSICHTIG IST (§2.1, „bewusste Asymmetrie"): ein
 * bereits GESPEICHERTER Include-Eintrag wird nicht erneut gegen den Baum
 * geprueft. Das Backend macht es genauso (`visu.py:415,419-420`), damit eine
 * Bestandsseite mit einem verwaisten Eintrag nie dauerhaft unspeicherbar wird
 * (R17). Neue und geaenderte Eintraege bleiben streng geprueft; Selbst-Include
 * und Zyklus gelten fuer jeden Eintrag, auch fuer gespeicherte — genau wie im
 * Backend.
 *
 * Rueckgabe ist eine Liste `{ code, params }` — Daten, keine Saetze. Die Saetze
 * stehen in den Locale-Dateien (i18n-Gate), und `params` traegt, was ein Satz
 * einsetzen muss (die betroffene Ziel-ID bzw. der beanstandete Nutzername).
 */

import { supportsIncludes } from '@/utils/visuPageKind'

/** Die Codes. Jeder hat einen Schluessel unter `visuEditor.problems` in de und en. */
export const PAGE_PROBLEM = Object.freeze({
  nameRequired: 'nameRequired',
  kindOnlyForPages: 'kindOnlyForPages',
  popupOnlyForPopupKind: 'popupOnlyForPopupKind',
  globalIncludeCannotInclude: 'globalIncludeCannotInclude',
  popupCannotInclude: 'popupCannotInclude',
  selfInclude: 'selfInclude',
  includeTargetMissing: 'includeTargetMissing',
  includeTargetNotAPage: 'includeTargetNotAPage',
  includeTargetIsPopup: 'includeTargetIsPopup',
  includeCycle: 'includeCycle',
  includedPageCannotBecomePopup: 'includedPageCannotBecomePopup',
  includeKindNeedsReference: 'includeKindNeedsReference',
  normalKindWhileIncluded: 'normalKindWhileIncluded',
  pinRequiresProtected: 'pinRequiresProtected',
  audienceRequiresUserAccess: 'audienceRequiresUserAccess',
  audienceUserUnknown: 'audienceUserUnknown',
})

/** Fuehrt eine Include-Kette weiter, ohne sich in einem fremden Zyklus zu verlaufen. */
function reachesSelf(startTargets, ownId, includesById) {
  const pending = [...startTargets]
  const seen = new Set()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === ownId) return true
    if (seen.has(current)) continue
    seen.add(current)
    const next = includesById[current]
    if (Array.isArray(next)) pending.push(...next)
  }
  return false
}

/** Inkludiert eine ANDERE Seite diese hier? Das ist die Rolle „Inkludeseite". */
function isIncludedElsewhere(ownId, includesById) {
  if (!ownId) return false
  return Object.entries(includesById).some(
    ([sourceId, targets]) =>
      sourceId !== ownId && Array.isArray(targets) && targets.includes(ownId),
  )
}

/**
 * Prueft einen Seiten-Entwurf gegen das Seitentyp-Modell.
 *
 * @param {object|null} draft  `{ id, name, type, editorKind, access, pin, usernames, includes, popup }`
 * @param {object} [context]   `{ nodes: VisuNodeSummary[], includesById: Record<string,string[]>,
 *                               storedIncludes?: string[], knownUsernames?: string[]|null }`
 * @returns {Array<{code: string, params?: object}>}
 */
export function validatePage(draft, context = {}) {
  if (!draft) return []
  const nodes = Array.isArray(context.nodes) ? context.nodes : []
  const includesById = context.includesById && typeof context.includesById === 'object' ? context.includesById : {}
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const includes = Array.isArray(draft.includes) ? draft.includes : []
  const usernames = Array.isArray(draft.usernames) ? draft.usernames : []
  // Die bereits gespeicherten Eintraege: fuer sie entfaellt die Ziel-Pruefung,
  // exakt wie im Backend. Fehlt die Angabe, wird streng geprueft.
  const unchanged = new Set(Array.isArray(context.storedIncludes) ? context.storedIncludes : [])
  // Die Nutzerliste - `null`, solange sie nicht geladen ist. Dann schweigt die
  // Regel, statt eine bestehende Zielgruppe zu beanstanden, die es gibt.
  const knownUsernames = Array.isArray(context.knownUsernames) ? context.knownUsernames : null
  const problems = []
  const add = (code, params) => problems.push(params ? { code, params } : { code })

  if (!String(draft.name ?? '').trim()) add(PAGE_PROBLEM.nameRequired)

  const isPage = draft.type !== 'LOCATION'
  if (!isPage && draft.editorKind && draft.editorKind !== 'normal') {
    add(PAGE_PROBLEM.kindOnlyForPages)
  }

  if (draft.popup && draft.editorKind !== 'popup') add(PAGE_PROBLEM.popupOnlyForPopupKind)

  if (includes.length > 0) {
    if (draft.editorKind === 'globalInclude') {
      add(PAGE_PROBLEM.globalIncludeCannotInclude)
    } else if (draft.editorKind === 'popup') {
      add(PAGE_PROBLEM.popupCannotInclude)
    } else if (supportsIncludes(draft.editorKind)) {
      for (const target of includes) {
        if (target === draft.id) {
          add(PAGE_PROBLEM.selfInclude)
          continue
        }
        // Der gespeicherte Eintrag wird nicht erneut gegen den Baum geprueft.
        if (unchanged.has(target)) continue
        const node = byId.get(target)
        if (!node) {
          add(PAGE_PROBLEM.includeTargetMissing, { target })
        } else if (node.type !== 'PAGE') {
          add(PAGE_PROBLEM.includeTargetNotAPage, { target: node.name || target })
        } else if (node.kind === 'popup') {
          add(PAGE_PROBLEM.includeTargetIsPopup, { target: node.name || target })
        }
      }
      const foreign = includes.filter((target) => target !== draft.id)
      if (draft.id && reachesSelf(foreign, draft.id, includesById)) add(PAGE_PROBLEM.includeCycle)
    }
  }

  const included = isPage ? isIncludedElsewhere(draft.id, includesById) : false

  // Die abgeleitete Rolle: sie laesst sich hier nicht setzen, nur anzeigen.
  if (isPage && draft.editorKind === 'include' && !included) {
    add(PAGE_PROBLEM.includeKindNeedsReference)
  }
  if (isPage && draft.editorKind === 'normal' && included) {
    add(PAGE_PROBLEM.normalKindWhileIncluded)
  }

  if (draft.editorKind === 'popup' && included) add(PAGE_PROBLEM.includedPageCannotBecomePopup)

  if (String(draft.pin ?? '') && draft.access !== 'protected') add(PAGE_PROBLEM.pinRequiresProtected)
  if (usernames.length > 0 && draft.access !== 'user') {
    add(PAGE_PROBLEM.audienceRequiresUserAccess)
  } else if (draft.access === 'user' && knownUsernames) {
    for (const name of usernames) {
      if (!knownUsernames.includes(name)) add(PAGE_PROBLEM.audienceUserUnknown, { user: name })
    }
  }

  return problems
}
