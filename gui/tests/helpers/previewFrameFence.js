import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Der Zaun um den VORSCHAURAHMEN des Visu-Editors (M5 C4, Issue #171).
 *
 * Der Rahmen ist der „Bildschirm", auf dem die Vorschau laeuft. Er gehoert zum
 * Paritaetsnachweis der Vorschau (`apps/visu/src/preview/PreviewParity.spec.ts`,
 * Messlatte E3), laesst sich dort aber nicht messen: jene Spec liest `apps/visu`,
 * `packages` und die Skin-Pakete, nicht `gui/` - und der Vorschau-DOM weiss
 * nichts von dem Element, in dem er steckt. `transform`, `filter`, `zoom` oder
 * `opacity` am `<iframe>` ODER AN IRGENDEINEM SEINER VORFAHREN zeigen dem Autor
 * ein anderes Bild als dem Nutzer.
 *
 * Dieses Modul haelt die Werkzeuge dafuer; die Zusicherungen stehen an drei
 * Stellen, und zusammen reichen sie vom `<iframe>` bis zum `<html>`:
 *
 *   - `tests/components/visu/VisuPreviewFrame.spec.js`: der Rahmen und sein
 *     Pfad INNERHALB der Komponente, in JEDEM Zustand, den sie annehmen kann
 *     (verbunden, nicht erreichbar, abgelehnt).
 *   - `tests/components/visu/VisuEditorView.spec.js`, erster Block: derselbe
 *     Pfad in der Ansicht, die den Rahmen einbettet.
 *   - `tests/components/visu/VisuEditorView.spec.js`, zweiter Block: der Pfad
 *     in der ECHTEN Schale (`App.vue` mit der echten `AppLayout`) bis zum
 *     `<html>` hinauf, samt dem Inline-Stil, den `App.vue` durchreicht - und
 *     der Blattscan gegen genau diesen Pfad.
 *
 * WAS DIESE WERKZEUGE NICHT LESEN: das GEBAUTE Utility-Blatt. Was Tailwind aus
 * `rounded-lg` oder `bg-white` erzeugt, steht in keiner Quelldatei dieses Repos,
 * und happy-dom rechnet kein CSS aus. Das ist der Rest von E3-2, der an Teil E
 * geht.
 */

/** Die Wurzel von `gui/`. Vitest laeuft mit `gui/` als Arbeitsverzeichnis. */
export const GUI_ROOT = process.cwd()

/** Das `data-testid`, an dem der Rahmen im DOM haengt. */
export const RAHMEN_TESTID = 'visu-preview-frame'

/**
 * Ein Element als eine Zeile: Tag, Klassenliste im Wortlaut, `style`-Attribut.
 * Die Klassen werden NICHT sortiert - der Pin soll auch eine umsortierte Liste
 * melden, damit niemand versehentlich eine dazuschreibt.
 */
export const zeile = (el) =>
  [el.tagName.toLowerCase(), el.getAttribute('class') ?? '', el.getAttribute('style') ?? ''].join(
    ' | ',
  )

/**
 * Die Klassen, die Rahmen und Vorfahrenpfad heute tragen - vom `<iframe>` bis
 * hinauf in die Schale von `App.vue`. Sie sind der Suchbegriff des Blattscans
 * fuer den Fall, dass ein Selektor in diesem Mount niemanden trifft. Sie stehen
 * hier ausgeschrieben statt aus dem DOM gelesen, damit der Scan nicht
 * mitwandert, wenn jemand eine Klassenliste aendert: dann faellt zuerst der Pin,
 * und diese Liste wird bewusst nachgezogen.
 */
export const GEPINNTE_KLASSEN = [
  // der Rahmen selbst
  'w-full',
  'h-[70vh]',
  'rounded-lg',
  'border',
  'border-slate-200',
  'dark:border-slate-700/60',
  'bg-white',
  // VisuPreviewFrame und VisuEditorView
  'flex',
  'flex-col',
  'gap-2',
  'gap-4',
  'p-4',
  // die Schale darueber: <main>, die Spalte, AppLayout, App
  'flex-1',
  'overflow-y-auto',
  'p-6',
  'overflow-hidden',
  'h-screen',
  'bg-surface-900',
  'min-h-screen',
]

/**
 * Tailwinds Transform-, Filter- und Zoom-Utilities als Praefixliste - alles,
 * was das BILD im Rahmen aendert, ohne den Rahmen selbst zu beruehren.
 */
export const BILDKLASSEN =
  /^(scale|rotate|skew|translate|transform|perspective|origin|blur|saturate|grayscale|sepia|invert|hue-rotate|contrast|brightness|opacity|zoom|backdrop|mix-blend|isolate)(-|$)/

/** Dieselbe Familie als DEKLARATION, fuer den Blattscan. */
export const BILDDEKLARATIONEN =
  /(^|[;{\s])(transform|rotate|scale|translate|filter|backdrop-filter|zoom|opacity|perspective|mix-blend-mode|clip-path|mask|visibility|content-visibility)\s*:/i

/**
 * Der ganze Vorfahrenpfad des Rahmens - vom Eltern-Element bis hinauf zum
 * WURZELKNOTEN des Dokuments, nicht bis zur Komponentenwurzel. Genau dort endete
 * der Vorgaenger, und `scale-90 saturate-50` am einbettenden `<div>` einer
 * Ebene darueber ging deshalb durch die volle GUI-Suite (Kritik R9, N-A).
 */
export function vorfahrenpfad(frameEl) {
  const pfad = []
  for (let el = frameEl.parentElement; el !== null; el = el.parentElement) pfad.push(el)
  return pfad
}

/**
 * Was auf einem Pfad das Bild veraendern kann: eine Klasse aus der
 * Transform-/Filter-/Zoom-Familie oder ein Inline-Stil, der dasselbe von Hand
 * tut. Gibt jeden Fund als lesbare Zeile zurueck - leer heisst „nichts gefunden".
 */
export function bildaendernd(elemente) {
  const funde = []
  for (const el of elemente) {
    for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
      if (BILDKLASSEN.test(cls)) funde.push(`${zeile(el)} -> Klasse ${cls}`)
    }
    const style = el.getAttribute('style') ?? ''
    if (BILDDEKLARATIONEN.test(style) || /\b(transform|filter|zoom|scale|opacity|perspective)\b/i.test(style)) {
      funde.push(`${zeile(el)} -> Stil ${style}`)
    }
  }
  return funde
}

/**
 * Jede Regel jedes HANDGESCHRIEBENEN Blattes der GUI: Stylesheets und
 * `<style>`-Bloecke unter `gui/src`, dazu das ausgelieferte `index.html`.
 * `dist/` und `node_modules/` bleiben aussen vor - das eine ist das Ergebnis
 * dieser Quellen, das andere nicht unser Code.
 *
 * Was das NICHT liest, ausdruecklich: das gebaute Utility-Blatt. Was Tailwind
 * aus `rounded-lg` macht, steht in keiner dieser Dateien. Und `@import
 * "tailwindcss"` in `src/style.css` wird nicht verfolgt - genau das ist der an
 * Teil E uebergebene Anteil.
 */
export function guiRules() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (/\.(css|scss|sass|less|vue|html)$/.test(name)) files.push(path)
    }
  }
  walk(join(GUI_ROOT, 'src'))
  files.push(join(GUI_ROOT, 'index.html'))

  const rules = []
  for (const path of files) {
    const src = readFileSync(path, 'utf8')
    const css = /\.(css|scss|sass|less)$/.test(path)
      ? src
      : Array.from(src.matchAll(/^[ \t]*<style([^>]*)>([\s\S]*?)<\/style>/gm))
          .map((m) => m[2])
          .join('\n')
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}();]*?)\{([^{}]*)\}/g)) {
      const selector = m[1].trim()
      if (selector.length === 0 || selector.startsWith('@')) continue
      rules.push({
        file: relative(GUI_ROOT, path),
        selector,
        decls: m[2].replace(/\s+/g, ' ').trim(),
      })
    }
  }
  return { files: files.length, rules }
}

/** Nennt dieser Selektor diese Klasse? Die CSS-Escapes fallen dafuer weg. */
export function nenntKlasse(selector, cls) {
  const roh = selector.replace(/\\/g, '')
  return new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(roh)
}

/**
 * Eine Selektorliste (`a, b`) in ihre Glieder zerlegen - Kommas in Klammern und
 * in Zeichenketten trennen nicht.
 */
export function selectorList(selector) {
  const out = []
  let tiefe = 0
  let quote = null
  let cur = ''
  for (const ch of selector) {
    if (quote !== null) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(' || ch === '[') tiefe += 1
    if (ch === ')' || ch === ']') tiefe -= 1
    if (ch === ',' && tiefe === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out.filter((s) => s.length > 0)
}

/**
 * Der SCHLUESSEL-Compound eines Selektors: das rechteste Glied, also das, auf
 * das die Regel am Ende zielt (`.p-4 > iframe` -> `iframe`). Kombinatoren in
 * Klammern (`:is(a > b)`) und in Zeichenketten trennen nicht.
 */
export function keyCompound(selector) {
  let tiefe = 0
  let quote = null
  let start = 0
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[') tiefe += 1
    else if (ch === ')' || ch === ']') tiefe -= 1
    else if (tiefe === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) start = i + 1
  }
  return selector.slice(start).trim()
}

/**
 * Zielt dieses Glied dem NAMEN nach auf den Rahmen oder einen seiner Vorfahren?
 *
 * Das ist der zweite Weg neben `matches()`: ein Selektor, dessen linker Teil in
 * DIESEM Mount nicht steht (`.layout-shell .p-4 > iframe`), trifft hier
 * niemanden und wuerde vom DOM-Test stillschweigend durchgelassen - in der
 * ausgelieferten Anwendung greift er trotzdem. Gefragt wird deshalb der
 * Schluessel-Compound: nennt er den Tag `iframe`, das `data-testid` des Rahmens
 * oder eine der gepinnten Klassen, gilt die Regel als erreichend.
 */
export function zieltAufRahmen(glied) {
  const key = keyCompound(glied)
  if (key.length === 0) return false
  const roh = key.replace(/\\/g, '')
  if (/(^|[^\w-])iframe(?![\w-])/i.test(roh)) return true
  if (roh.includes(RAHMEN_TESTID)) return true
  return GEPINNTE_KLASSEN.some((cls) => nenntKlasse(key, cls))
}

/**
 * JEDE Regel, die den Rahmen oder einen seiner Vorfahren TREFFEN KANN - nicht
 * nur die, die eine bestimmte Klasse beim Namen nennt.
 *
 * Der Vorgaenger fragte ausschliesslich, ob ein Selektor eine von zehn Klassen
 * nennt. `iframe[data-testid="visu-preview-frame"] { transform: scale(.9) }` und
 * `.p-4 > iframe { opacity: .3 }` in `gui/src/style.css` - im Stil, in dem diese
 * Datei ohnehin geschrieben ist - nannten keine davon und gingen durch die volle
 * GUI-Suite (Kritik R9, N-B).
 *
 * Gefragt wird jetzt zweifach, und ein Treffer auf EINEM der beiden Wege genuegt:
 *
 *   1. `el.matches(glied)` gegen den Rahmen UND jedes Element seines
 *      Vorfahrenpfades bis zum `<html>` - das ist der echte Selektor-Abgleich,
 *      der jede Schreibweise kennt, die die Laufzeit kennt.
 *   2. der Schluessel-Compound nennt `iframe`, das `data-testid` oder eine
 *      gepinnte Klasse - fuer Selektoren, deren linker Teil in diesem Mount
 *      nicht steht (Weg 1 sagt dann faelschlich „trifft nicht").
 *
 * Ein Glied, das die Laufzeit nicht lesen kann (`::-webkit-scrollbar-thumb`),
 * wird NICHT still uebersprungen: es geht in `unlesbar` und faellt dort auf. Weg
 * 2 laeuft trotzdem ueber es.
 */
export function erreichendeRegeln(elemente, rules) {
  const treffer = []
  const unlesbar = []
  for (const rule of rules) {
    let hit = false
    for (const glied of selectorList(rule.selector)) {
      let dom = false
      try {
        dom = elemente.some((el) => el.matches(glied))
      } catch {
        unlesbar.push(`${rule.file}: ${glied}`)
      }
      if (dom || zieltAufRahmen(glied)) {
        hit = true
        break
      }
    }
    if (hit) treffer.push(rule)
  }
  return { treffer, unlesbar }
}
