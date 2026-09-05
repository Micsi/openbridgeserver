import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

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
 * Dieses Modul haelt die Werkzeuge dafuer; die Zusicherungen stehen an vier
 * Stellen:
 *
 *   - `tests/components/visu/VisuPreviewFrame.spec.js`: der Rahmen und sein
 *     Pfad INNERHALB der Komponente, in JEDEM Zustand, den sie annehmen kann
 *     (verbunden, nicht erreichbar, abgelehnt).
 *   - `tests/components/visu/VisuEditorView.spec.js`, erster Block: derselbe
 *     Pfad in der Ansicht, die den Rahmen einbettet - und ebenfalls in jedem
 *     Zustand, den die ANSICHT annehmen kann (frisch, nach dem ersten
 *     uebernommenen Entwurf; Kritik R10, X7).
 *   - `tests/components/visu/VisuEditorView.spec.js`, zweiter Block: der Pfad
 *     in der ECHTEN Schale (`App.vue` mit der echten `AppLayout`) bis zum
 *     `<html>` DIESER MONTAGE hinauf, samt dem Inline-Stil, den `App.vue`
 *     durchreicht - und der Blattscan gegen genau diesen Pfad.
 *   - `tests/components/visu/VisuEditorView.spec.js`, dritter Block: die
 *     Leseschritte des Blattscans einzeln, und `gui/index.html` als DOKUMENT
 *     gelesen - `<html>`, `<body>` und `<div id="app">` der AUSLIEFERUNG, die
 *     in keiner Montage vorkommen (Kritik R10, X1).
 *
 * ZWEI GRENZEN, ausdruecklich, weil beide frueher hier ueberdehnt standen:
 *
 *   1. WAS DIESE WERKZEUGE NICHT LESEN: das GEBAUTE Utility-Blatt. Was Tailwind
 *      aus `rounded-lg` oder `bg-white` erzeugt, steht in keiner Quelldatei
 *      dieses Repos, und happy-dom rechnet kein CSS aus.
 *   2. DER MOUNT IST NICHT DAS AUSGELIEFERTE DOKUMENT. `matches()` kann nur
 *      entscheiden, was in DIESER Montage steht; fuer alles andere entscheidet
 *      {@link zieltAufRahmen} nach NAMEN (`iframe`, das `data-testid`, die
 *      gepinnten Klassen) - ein Selektor, dessen rechtestes Glied ein blosser
 *      Tag (`main`, `div`) oder eine erst in der Auslieferung existierende ID
 *      (`#app > div`) ist, wird deshalb als „erreicht nicht" gemeldet, obwohl er
 *      erreicht.
 *
 * Beide gehen an Teil E (Szenario E3); sie stehen im Kopf von
 * `apps/visu/src/preview/PreviewParity.spec.ts` als Stueck 1 und Stueck 4.
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
 * Der ganze Vorfahrenpfad eines Elements - vom Eltern-Element bis hinauf zum
 * WURZELKNOTEN SEINES Dokuments, nicht bis zur Komponentenwurzel. Genau dort
 * endete der Vorgaenger, und `scale-90 saturate-50` am einbettenden `<div>`
 * einer Ebene darueber ging deshalb durch die volle GUI-Suite (Kritik R9, N-A).
 *
 * „Dokument" heisst dabei das Dokument DIESER Montage, wenn ein gemountetes
 * Element hineingegeben wird - und das der Auslieferung, wenn
 * {@link dokumentPfad} das geparste `index.html` hineingibt.
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

/* ── Der Leser: aus Text werden Regeln ──────────────────────────────────────
 *
 * Der Vorgaenger war EIN regulaerer Ausdruck (`/([^{}();]*?)\{([^{}]*)\}/g`),
 * und seine Selektorgruppe durfte keine Klammer enthalten:
 * `iframe:not([hidden]) { transform: scale(.9) }` fiel damit nicht auf - es kam
 * im Scan ueberhaupt nicht an, still (Kritik R10, X3). Hier laeuft stattdessen
 * ein kleiner Leser ueber den Text, der Zeichenketten, Klammerausdruecke und
 * verschachtelte Bloecke kennt.
 */

/** Ende einer Zeichenkette, die bei `i` mit ihrem Anfuehrungszeichen beginnt. */
function zeichenkettenEnde(text, i) {
  const q = text[i]
  for (let j = i + 1; j < text.length; j += 1) {
    if (text[j] === '\\') {
      j += 1
      continue
    }
    if (text[j] === q) return j + 1
  }
  return text.length
}

/** Ende eines Klammerausdrucks, der bei `i` mit `(` oder `[` beginnt. */
function klammerEnde(text, i) {
  const auf = text[i]
  const zu = auf === '(' ? ')' : ']'
  let tiefe = 0
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j]
    if (ch === '"' || ch === "'") {
      j = zeichenkettenEnde(text, j) - 1
      continue
    }
    if (ch === auf) tiefe += 1
    else if (ch === zu) {
      tiefe -= 1
      if (tiefe === 0) return j + 1
    }
  }
  return text.length
}

/** Ende eines geschweiften Blocks, der bei `i` mit `{` beginnt. */
function blockEnde(text, i) {
  let tiefe = 0
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j]
    if (ch === '"' || ch === "'") {
      j = zeichenkettenEnde(text, j) - 1
      continue
    }
    if (ch === '{') tiefe += 1
    else if (ch === '}') {
      tiefe -= 1
      if (tiefe === 0) return j + 1
    }
  }
  return text.length
}

/** Kommentare weg - ohne dabei in eine Zeichenkette zu greifen. */
function ohneKommentare(css) {
  let out = ''
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const j = zeichenkettenEnde(css, i)
      out += css.slice(i, j)
      i = j - 1
      continue
    }
    if (ch === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2)
      out += ' '
      i = e === -1 ? css.length : e + 1
      continue
    }
    out += ch
  }
  return out
}

const knapp = (text) => text.replace(/\s+/g, ' ').trim()

function scanne(css, innerhalb) {
  const rules = []
  const sonstiges = []
  let decls = ''
  let kopf = ''
  const anhaengen = (stueck) => {
    if (stueck.length === 0) return
    decls += (decls.length > 0 ? '; ' : '') + stueck
  }
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const j = zeichenkettenEnde(css, i)
      kopf += css.slice(i, j)
      i = j
      continue
    }
    if (ch === '(' || ch === '[') {
      const j = klammerEnde(css, i)
      kopf += css.slice(i, j)
      i = j
      continue
    }
    if (ch === '{') {
      const j = blockEnde(css, i)
      const rumpf = css.slice(i + 1, j - 1)
      i = j
      const sel = knapp(kopf)
      kopf = ''
      const innen = scanne(rumpf, true)
      if (innen.rules.length === 0 && innen.sonstiges.length === 0) {
        // Ein Blattblock - er enthaelt nur Deklarationen.
        if (sel.length === 0) sonstiges.push(`Block ohne Selektor { ${knapp(rumpf)} }`)
        else if (sel.startsWith('@')) sonstiges.push(`${sel} { … }`)
        else rules.push({ selector: sel, decls: knapp(rumpf) })
      } else {
        // Ein Behaelter (`@layer`, `@media`, `@supports`, `@keyframes`) oder
        // eine verschachtelte Regel: die INNEREN Regeln sind die, die ein
        // Element treffen koennen.
        rules.push(...innen.rules)
        sonstiges.push(...innen.sonstiges)
        const eigene = knapp(innen.decls)
        if (sel.length > 0 && !sel.startsWith('@') && eigene.length > 0) {
          rules.push({ selector: sel, decls: eigene })
        }
      }
      continue
    }
    if (ch === ';') {
      const stueck = knapp(kopf)
      kopf = ''
      if (innerhalb) anhaengen(stueck)
      else if (stueck.length > 0) sonstiges.push(stueck)
      i += 1
      continue
    }
    if (ch === '}') {
      // eine verirrte schliessende Klammer - der Leser haelt an ihr nicht an
      i += 1
      continue
    }
    kopf += ch
    i += 1
  }
  const rest = knapp(kopf)
  if (rest.length > 0) {
    if (innerhalb) anhaengen(rest)
    else sonstiges.push(rest)
  }
  return { rules, sonstiges, decls }
}

/**
 * Jede Regel eines CSS-Textes - und daneben JEDES Glied, das keine Regel ist.
 *
 * `sonstiges` ist die eingeloeste Zusage: was der Leser nicht als Selektor
 * versteht (`@import "tailwindcss"`, `@theme inline { … }`, ein Block ohne
 * Selektor), wird nicht still verworfen, sondern namentlich gemeldet - genauso,
 * wie `erreichendeRegeln` das mit `unlesbar` fuer die einzelnen GLIEDER tut. Bis
 * Runde 10 galt die Zusage nur fuer das Glied, nicht fuer die Regel (Kritik R10,
 * X3).
 */
export function cssRegeln(css) {
  const { rules, sonstiges } = scanne(ohneKommentare(css), false)
  return { rules, sonstiges }
}

/**
 * Die `<style>`-Bloecke eines HTML- oder SFC-Textes.
 *
 * OHNE Zeilenanker: der Vorgaenger verlangte, dass vor `<style` nur Leerraum
 * steht, und ein `<style>` hinter `<title>` auf derselben Zeile blieb deshalb
 * ungelesen (Kritik R10, X5).
 */
export function styleBloecke(src) {
  return Array.from(src.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style\s*>/gi)).map((m) => m[2])
}

/** Dateien, in denen ueberhaupt CSS stehen kann. */
const BLATT = /\.(css|scss|sass|less|vue|html)$/
/** Dateien, denen der Verfolger weiter folgt. */
const MODUL = /\.(css|scss|sass|less|vue|html|js|mjs|cjs|ts|mts|tsx|jsx)$/

/** Jeder Spezifizierer, den eine Quelldatei nennt - statisch, dynamisch, `@import`. */
function spezifizierer(src) {
  const out = []
  const re =
    /(?:\bimport\s*\(\s*|\bfrom\s+|\bimport\s+|@import\s+(?:url\s*\(\s*)?)['"]([^'"\n]+)['"]/g
  for (const m of src.matchAll(re)) out.push(m[1])
  return out
}

/**
 * Einen Spezifizierer zu einer Datei DIESES Repos aufloesen - oder zu `null`.
 *
 * Ein blosser Name (`vue`, `tailwindcss`) ist fremder Code und wird nicht
 * verfolgt: die `@import "tailwindcss"`-Kette ist genau der an Teil E
 * uebergebene Anteil.
 */
function aufloesen(spec, dir) {
  let basis
  if (spec.startsWith('@/')) basis = join(GUI_ROOT, 'src', spec.slice(2))
  else if (spec.startsWith('./') || spec.startsWith('../')) basis = resolve(dir, spec)
  else if (spec.startsWith('/')) basis = join(GUI_ROOT, spec)
  else return null
  const kandidaten = [
    basis,
    ...['.js', '.mjs', '.ts', '.vue', '.css'].map((e) => basis + e),
    ...['index.js', 'index.ts', 'index.vue'].map((n) => join(basis, n)),
  ]
  for (const kandidat of kandidaten) {
    if (!kandidat.startsWith(GUI_ROOT)) continue
    if (kandidat.includes('node_modules')) continue
    if (!MODUL.test(kandidat)) continue
    if (existsSync(kandidat) && statSync(kandidat).isFile()) return kandidat
  }
  return null
}

/** Die Einstiegspunkte der AUSGELIEFERTEN Anwendung: `index.html` und seine Module. */
export function guiEinstiege() {
  const index = join(GUI_ROOT, 'index.html')
  const einstiege = [index]
  for (const m of readFileSync(index, 'utf8').matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const ziel = aufloesen(m[1], GUI_ROOT)
    if (ziel !== null) einstiege.push(ziel)
  }
  return einstiege
}

/**
 * Alle Blaetter, die von diesen Einstiegen aus ERREICHBAR sind - den Importen
 * nach, nicht dem Verzeichnis nach.
 *
 * Der Vorgaenger lief `gui/src` ab. Ein handgeschriebenes Blatt DANEBEN
 * (`gui/theme-extra.css`), von `main.js` importiert, landete woertlich im
 * gebauten Blatt und wurde nie gelesen (Kritik R10, X8). Verfolgt werden
 * statische und dynamische `import`-Spezifizierer und `@import`-Pfade; ein
 * blosser Name endet die Kette.
 */
export function blattkette(einstiege = guiEinstiege()) {
  const gesehen = new Set()
  const blaetter = new Set()
  const offen = [...einstiege]
  while (offen.length > 0) {
    const pfad = offen.pop()
    if (gesehen.has(pfad)) continue
    gesehen.add(pfad)
    if (BLATT.test(pfad)) blaetter.add(pfad)
    let src
    try {
      src = readFileSync(pfad, 'utf8')
    } catch {
      continue
    }
    for (const spec of spezifizierer(src)) {
      const ziel = aufloesen(spec, dirname(pfad))
      if (ziel !== null && !gesehen.has(ziel)) offen.push(ziel)
    }
  }
  return [...blaetter].sort()
}

/**
 * Das gesamte Quellverzeichnis - der zweite Weg neben der Importkette. Er
 * bleibt, damit auch ein Blatt gelesen wird, das heute (noch) niemand
 * importiert; `dist/` und `node_modules/` bleiben aussen vor.
 */
function quellverzeichnis() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (BLATT.test(name)) files.push(path)
    }
  }
  walk(join(GUI_ROOT, 'src'))
  return files
}

/**
 * `<html>`, `<body>` und der Mount-Knoten des AUSGELIEFERTEN Dokuments.
 *
 * Der Vorfahrenpfad jeder Montage endet am `<html>` DIESER Montage, und dessen
 * `<body>` traegt nie etwas. In der Auslieferung liegt ueber `div.min-h-screen`
 * aber noch `div#app`, `body.antialiased` und - nach dem Inline-Skript in
 * `index.html` - `html.dark`. `<body class="scale-90 saturate-50">` dort wird
 * von Tailwind zu echten Utilities und skaliert die ganze Anwendung samt Rahmen
 * (Kritik R10, X1). Deshalb wird `index.html` hier als DOKUMENT gelesen, nicht
 * nur als `<style>`-Behaelter.
 */
export function dokumentPfad() {
  const src = readFileSync(join(GUI_ROOT, 'index.html'), 'utf8')
  const doc = new DOMParser().parseFromString(src, 'text/html')
  const app = doc.querySelector('#app')
  if (app === null) {
    throw new Error('gui/index.html hat kein #app - der Mount-Punkt hat sich bewegt')
  }
  return { app, pfad: vorfahrenpfad(app) }
}

/**
 * Jede Regel jedes HANDGESCHRIEBENEN Blattes der GUI: Stylesheets und
 * `<style>`-Bloecke unter `gui/src`, dazu alles, was vom ausgelieferten
 * `index.html` aus ueber die Importe erreichbar ist - auch ausserhalb von
 * `gui/src`.
 *
 * Was das NICHT liest, ausdruecklich: das gebaute Utility-Blatt. Was Tailwind
 * aus `rounded-lg` macht, steht in keiner dieser Dateien, und `@import
 * "tailwindcss"` wird nicht verfolgt - genau das ist der an Teil E uebergebene
 * Anteil. Alles andere, was der Leser nicht als Regel versteht, steht in
 * `sonstiges` und wird nicht still verworfen.
 */
export function guiRules() {
  const files = [...new Set([...quellverzeichnis(), ...blattkette()])].sort()

  const rules = []
  const sonstiges = []
  for (const path of files) {
    const src = readFileSync(path, 'utf8')
    const css = /\.(css|scss|sass|less)$/.test(path) ? src : styleBloecke(src).join('\n')
    const gelesen = cssRegeln(css)
    const datei = relative(GUI_ROOT, path).replace(/\\/g, '/')
    for (const rule of gelesen.rules) rules.push({ file: datei, ...rule })
    for (const glied of gelesen.sonstiges) sonstiges.push(`${datei}: ${glied}`)
  }
  return { files: files.length, rules, sonstiges }
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
 *
 * DIE GRENZE DIESES WEGES, ausdruecklich: er entscheidet nach NAMEN. Ein
 * Selektor, dessen rechtestes Glied ein blosser Tag (`.dark main`,
 * `aside + div main`) oder eine erst in der Auslieferung existierende ID
 * (`#app > div`) ist, wird als „erreicht nicht" gemeldet, obwohl er in der
 * ausgelieferten Seite erreicht (Kritik R10, X2/X4/X6). Das ist Stueck 4 der
 * Uebergabe an Teil E.
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
 * JEDE Regel, die den Rahmen oder einen seiner Vorfahren TREFFEN KANN, soweit
 * das ohne Browser entscheidbar ist - nicht nur die, die eine bestimmte Klasse
 * beim Namen nennt.
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
 *      Vorfahrenpfades bis zum `<html>` DIESER MONTAGE - das ist der echte
 *      Selektor-Abgleich, der jede Schreibweise kennt, die die Laufzeit kennt.
 *   2. der Schluessel-Compound nennt `iframe`, das `data-testid` oder eine
 *      gepinnte Klasse - fuer Selektoren, deren linker Teil in diesem Mount
 *      nicht steht (Weg 1 sagt dann faelschlich „trifft nicht").
 *
 * Ein Glied, das die Laufzeit nicht lesen kann (`::-webkit-scrollbar-thumb`),
 * wird NICHT still uebersprungen: es geht in `unlesbar` und faellt dort auf. Weg
 * 2 laeuft trotzdem ueber es. Dasselbe gilt eine Ebene darueber fuer die REGEL:
 * was {@link cssRegeln} nicht als Selektor versteht, steht dort in `sonstiges`.
 *
 * WAS BEIDE WEGE NICHT KOENNEN: entscheiden, ob ein Selektor in der
 * AUSGELIEFERTEN Seite trifft. Weg 1 kennt nur diese Montage, Weg 2 nur eine
 * Namensliste - `#app > div`, `.dark main` und `aside + div main` treffen dort
 * und werden hier nicht gemeldet (Kritik R10, X2/X4/X6). Das entscheidet der
 * Pixel-Diff in Teil E.
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
