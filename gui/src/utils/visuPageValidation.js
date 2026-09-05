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
 *
 * Auch die REIHENFOLGE ist uebernommen: sobald der Seitentyp jeden Include
 * verbietet, prueft das Backend gar kein Ziel mehr — der Editor sagt dann
 * denselben einen Satz und redet nicht ueber Ziele, die nicht zur Debatte stehen.
 *
 * `nameRequired` hat KEIN Gegenstueck im Backend (`name: str` laesst auch den
 * leeren String zu). Es steht trotzdem hier, weil eine namenlose Seite im Baum
 * unauffindbar waere — das ist ausdruecklich eine Editor-Regel, keine
 * vorweggenommene Ablehnung.
 *
 * Rueckgabe ist eine Liste `{ code, params }` — Daten, keine Saetze. Die Saetze
 * stehen in den Locale-Dateien (i18n-Gate), und `params` traegt, was ein Satz
 * einsetzen muss (heute: die betroffene Ziel-ID).
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
  pinRequiresProtected: 'pinRequiresProtected',
  audienceRequiresUserAccess: 'audienceRequiresUserAccess',
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

/**
 * Prueft einen Seiten-Entwurf gegen das Seitentyp-Modell.
 *
 * @param {object|null} draft  `{ id, name, type, editorKind, access, pin, usernames, includes, popup }`
 * @param {object} [context]   `{ nodes: VisuNodeSummary[], includesById: Record<string,string[]> }`
 * @returns {Array<{code: string, params?: object}>}
 */
export function validatePage(draft, context = {}) {
  if (!draft) return []
  const nodes = Array.isArray(context.nodes) ? context.nodes : []
  const includesById = context.includesById && typeof context.includesById === 'object' ? context.includesById : {}
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const includes = Array.isArray(draft.includes) ? draft.includes : []
  const usernames = Array.isArray(draft.usernames) ? draft.usernames : []
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

  if (draft.editorKind === 'popup' && draft.id) {
    const includedElsewhere = Object.entries(includesById).some(
      ([sourceId, targets]) =>
        sourceId !== draft.id && Array.isArray(targets) && targets.includes(draft.id),
    )
    if (includedElsewhere) add(PAGE_PROBLEM.includedPageCannotBecomePopup)
  }

  if (String(draft.pin ?? '') && draft.access !== 'protected') add(PAGE_PROBLEM.pinRequiresProtected)
  if (usernames.length > 0 && draft.access !== 'user') add(PAGE_PROBLEM.audienceRequiresUserAccess)

  return problems
}
