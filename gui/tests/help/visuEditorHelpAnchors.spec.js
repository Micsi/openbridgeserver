import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/**
 * Doku-Gate des V2-Editors (M5 Teil D, Issue #174, Doku-Gate #1183).
 *
 * Ein `help-id` ist keine Beschriftung, sondern ein VERSPRECHEN: der
 * Hilfe-Knopf oeffnet die Schublade, die Schublade schlaegt die Id in
 * `help-index.json` nach, und der Index kennt nur Ueberschriften, die als
 * `{#id}` in `help/**\/*.md` stehen. Fehlt der Anker in einer Sprache, zeigt
 * die Schublade dort „keine Hilfe verfuegbar" - und zwar STILL: der Generator
 * warnt nur (nicht blockierend), der Build laeuft durch.
 *
 * Dieser Test macht daraus eine Schranke. Er liest die Quellen, nicht den
 * gebauten Index: der Index entsteht erst beim Hilfe-Build und waere hier gar
 * nicht da.
 */

/** Vitest laeuft mit `gui/` als Arbeitsverzeichnis. */
const GUI_SRC = resolve(process.cwd(), 'src')
const HELP_ROOT = resolve(process.cwd(), '..', 'help')

/** Wie `help/scripts/generate-help-index.mjs` es liest: `en/` ist `en`, alles andere `de`. */
const EXCLUDED_TOP_LEVEL = new Set(['.vitepress', 'public', 'node_modules', 'scripts'])
const HEADING_RE = /^#{1,6}\s+.*\{#([A-Za-z][\w-]*)\}\s*$/gm

function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (dir === base && EXCLUDED_TOP_LEVEL.has(entry)) continue
      if (entry === 'node_modules') continue
      walk(full, base, acc)
    } else {
      acc.push(full)
    }
  }
  return acc
}

/** Alle `help-id="…"`, die im Template irgendeiner Vue-Datei stehen. */
function helpIdsInSources() {
  const found = new Map()
  for (const file of walk(GUI_SRC).filter((f) => f.endsWith('.vue'))) {
    for (const m of readFileSync(file, 'utf-8').matchAll(/help-id="([^"]+)"/g)) {
      if (!found.has(m[1])) found.set(m[1], [])
      found.get(m[1]).push(relative(GUI_SRC, file))
    }
  }
  return found
}

/** Die Anker je Sprache, exakt nach der Regel des Generators. */
function anchorsByLocale() {
  const byLocale = { de: new Set(), en: new Set() }
  for (const file of walk(HELP_ROOT).filter((f) => f.endsWith('.md'))) {
    const rel = relative(HELP_ROOT, file)
    const locale = rel.split(sep)[0] === 'en' ? 'en' : 'de'
    for (const m of readFileSync(file, 'utf-8').matchAll(HEADING_RE)) {
      byLocale[locale].add(m[1])
    }
  }
  return byLocale
}

/**
 * Die neuen Oberflaechen des V2-Editors und der Anker, den jede tragen muss.
 * Die Tabelle ist die Anforderung „jede neue Oberflaeche braucht einen
 * Hilfe-Anker" in pruefbarer Form.
 */
const OBERFLAECHEN = [
  ['views/VisuEditorView.vue', 'visu-editor'],
  ['components/visu/VisuPageTree.vue', 'visu-page-tree'],
  ['components/visu/VisuPageProperties.vue', 'visu-page-kinds'],
  ['components/visu/VisuEditorCanvas.vue', 'visu-editor-canvas'],
  ['components/visu/VisuWidgetPalette.vue', 'visu-widget-palette'],
  ['components/visu/VisuWidgetBindingForm.vue', 'visu-datapoint-binding'],
  ['components/visu/VisuPageHistory.vue', 'visu-versions'],
  ['components/visu/VisuPageTransfer.vue', 'visu-transfer'],
  ['components/visu/VisuPreviewFrame.vue', 'visu-editor-preview'],
]

/**
 * Die Themen, die Teil D dokumentieren muss (Auftrag #174 Punkt 3). Sie haengen
 * nicht alle an einem eigenen Knopf - ein Popup-Parameter steht im selben
 * Formular wie der Seitentyp -, aber die Hilfe muss sie als eigene, verlinkbare
 * Ueberschrift fuehren. Sonst „gibt es Hilfe", und trotzdem findet niemand die
 * Regel, die er sucht.
 */
const PFLICHTTHEMEN = [
  'visu-page-kinds',
  'visu-page-popup',
  'visu-page-includes',
  'visu-page-global-includes',
  'visu-page-access',
  'visu-layout-modes',
  'visu-datapoint-binding',
  'visu-visibility-rule',
  'visu-versions',
  'visu-json-view',
  'visu-transfer',
  'visu-editor-preview',
]

describe('Doku-Gate — jede neue Oberflaeche traegt ihren Hilfe-Anker', () => {
  const quellen = helpIdsInSources()

  it.each(OBERFLAECHEN)('%s traegt help-id="%s"', (datei, id) => {
    expect(quellen.get(id) ?? [], `help-id "${id}" fehlt`).toContain(datei)
  })

  it.each(OBERFLAECHEN)('%s importiert HelpButton, statt ein unbekanntes Element zu schreiben', (datei) => {
    const quelle = readFileSync(join(GUI_SRC, datei), 'utf-8')
    expect(quelle).toContain("@/components/ui/HelpButton.vue")
  })

  it('vergibt jede dieser Ids genau einmal — zwei Knoepfe, eine Schublade waere ein Irrtum', () => {
    const doppelt = OBERFLAECHEN.filter(([, id]) => (quellen.get(id) ?? []).length > 1).map(
      ([, id]) => id,
    )
    expect(doppelt).toEqual([])
  })
})

describe('Doku-Gate — jeder Anker existiert in beiden Sprachen', () => {
  const anker = anchorsByLocale()

  it('deckt jede im GUI verwendete help-id in de UND en ab', () => {
    const fehlend = []
    for (const [id, dateien] of helpIdsInSources()) {
      for (const locale of ['de', 'en']) {
        if (!anker[locale].has(id)) fehlend.push(`${id} (${locale}) — verwendet in ${dateien.join(', ')}`)
      }
    }
    expect(fehlend).toEqual([])
  })

  it.each(PFLICHTTHEMEN)('fuehrt das Pflichtthema "%s" als Ueberschrift in de und en', (id) => {
    expect([anker.de.has(id), anker.en.has(id)]).toEqual([true, true])
  })

  it('haelt die beiden Sprachen deckungsgleich — kein Anker nur auf einer Seite', () => {
    const nurDe = [...anker.de].filter((id) => !anker.en.has(id)).sort()
    const nurEn = [...anker.en].filter((id) => !anker.de.has(id)).sort()
    expect({ nurDe, nurEn }).toEqual({ nurDe: [], nurEn: [] })
  })
})
