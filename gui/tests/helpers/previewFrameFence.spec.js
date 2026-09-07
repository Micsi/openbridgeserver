import { describe, it, expect } from 'vitest'
import { writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GUI_ROOT,
  attributWert,
  spezifizierer,
  aufloesen,
  guiEinstiege,
  neuerBericht,
  cssRegeln,
  styleBloecke,
} from './previewFrameFence.js'

/**
 * Issue #182 - der Blattscan des Vorschau-Zauns liess zwei Formen STILL
 * passieren: unzitierte HTML-Attribute (H1) und `<style src="…">` im SFC
 * (H2). Beide tragen eine Regel bis in `gui_dist/assets/index-*.css`, waehrend
 * die Suite gruen bleibt (siehe Kopfkommentar von `guiEinstiege`/
 * `spezifizierer` in `previewFrameFence.js` fuer den vollen Befund).
 *
 * Die Proben hier belegen JEDE der vier im Issue genannten Formen einzeln:
 * H1, H2, und die beiden „theoretisch gleichartigen" - unzitiertes
 * `@import url()` (faellt bereits heute sichtbar in `sonstiges`, keine
 * Aenderung noetig) und ein Pfad aus `public/` (war gemeldet, aber mit
 * irrefuehrendem Grund - jetzt wird ein echtes Blatt dort gelesen wie jedes
 * andere).
 */

const FIXTURES = join(GUI_ROOT, 'tests', 'fixtures', 'previewFrameFence')

describe('previewFrameFence - attributWert()', () => {
  it('liest ein doppelt zitiertes Attribut', () => {
    expect(attributWert('<script src="./x.js">', 'src')).toBe('./x.js')
  })
  it('liest ein einfach zitiertes Attribut', () => {
    expect(attributWert("<script src='./x.js'>", 'src')).toBe('./x.js')
  })
  it('liest ein UNZITIERTES Attribut (H1)', () => {
    expect(attributWert('<script src=./x.js>', 'src')).toBe('./x.js')
    expect(attributWert('<link rel=stylesheet href=./x.css>', 'href')).toBe('./x.css')
  })
  it('liest ein unzitiertes Attribut mit weiteren Attributen dahinter', () => {
    expect(attributWert('<script src=./x.js type=module>', 'src')).toBe('./x.js')
  })
  it('liefert null ohne das Attribut', () => {
    expect(attributWert('<script type=module>', 'src')).toBeNull()
  })
  it('verwechselt `src` NICHT mit `data-src` (kein `\\b`-Fehltreffer)', () => {
    expect(attributWert('<div data-src=./decoy.js>', 'src')).toBeNull()
  })
  it('laesst sich NICHT von `src=…` innerhalb eines fremden, zitierten Attributwerts taeuschen (dritte Form, schwerer als H1/H2)', () => {
    // `data-note` steht VOR dem echten `src` und enthaelt selbst den Text
    // `src=deckname.js` - eine reine `name=`-Textsuche im ganzen Tag traf
    // diesen Text zuerst und lieferte den Deckname statt der echten Datei.
    expect(
      attributWert('<script data-note="see src=deckname.js" src="./echt.js">', 'src'),
    ).toBe('./echt.js')
    // Auch unzitiert dahinter, und mit dem Deckname in einfachen Anfuehrungszeichen.
    expect(
      attributWert("<script data-note='see src=deckname.js' src=./echt.js>", 'src'),
    ).toBe('./echt.js')
  })
  it('vergleicht den Attributnamen GROSS-/kleinschreibungs-unabhaengig (Kritik R3: ungetestete Mutation)', () => {
    // Ohne diese Probe ueberlebt eine Mutation, die `.toLowerCase()` aus dem
    // Namensvergleich entfernt: `SRC` und `src` muessen dasselbe Attribut
    // treffen, HTML kennt bei Attributnamen keine Gross-/Kleinschreibung.
    expect(attributWert('<script SRC="./x.js">', 'src')).toBe('./x.js')
    expect(attributWert('<script src="./x.js">', 'SRC')).toBe('./x.js')
    expect(attributWert('<script Src="./x.js">', 'sRc')).toBe('./x.js')
  })
})

describe('previewFrameFence - guiEinstiege() liest unzitierte Attribute (#182, H1)', () => {
  it('folgt einem unzitierten `<script src>` UND einem unzitierten `<link href>`', () => {
    const bericht = neuerBericht()
    const index = join(FIXTURES, 'index.unquoted.html')
    const einstiege = guiEinstiege(bericht, index)
    const namen = einstiege.map((p) => p.replace(FIXTURES, '').replace(/\\/g, '/'))

    expect(namen).toContain('/unquoted-script.js')
    expect(namen).toContain('/unquoted-link.css')
    // Und nicht als „entferntes Blatt" oder sonst wie in ungelesen verirrt -
    // beide wurden WIRKLICH gelesen, nicht nur benannt.
    expect(bericht.ungelesen).toEqual([])
  })

  it('ROT gegen den unreparierten Stand: mit den alten, zitierungspflichtigen Regexen faellt das Blatt still weg', () => {
    // Reproduziert den Vorgaenger-Regex aus #182 direkt (statt den Fix zu
    // benutzen), um zu zeigen: das Fixture-HTML oben wuerde mit ihm STILL
    // durchgehen - weder gelesen noch in `ungelesen`/`fremd` gemeldet.
    const altesMuster = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi
    const src = readFileSync(join(FIXTURES, 'index.unquoted.html'), 'utf8')
    const treffer = [...src.matchAll(altesMuster)]
    expect(treffer).toHaveLength(0)
  })
})

describe('previewFrameFence - guiEinstiege() laesst sich nicht von einem Decoy-Attribut taeuschen (#182, dritte Form)', () => {
  // Der gefaehrlichste der drei Funde: `attributWert()` suchte `name=…` als
  // reine Textsuche im GANZEN Tag. Ein vorangehendes Attribut, dessen
  // zitierter Wert selbst `src=…` enthaelt, gewann das Match - die echte
  // `src`-Datei verschwand spurlos, UND `ungelesen`/`fremd` blieben leer, weil
  // der Deckname selbst zu einer echten, lesbaren Datei aufloeste. Der Zaun
  // meldete also nicht „unbekannt", sondern „alles gelesen" - eine falsche
  // Vollstaendigkeit, schwerer als H1/H2 (die immerhin sichtbar blieben).
  it('liest das ECHTE `src`-Blatt, nicht den Deckname in einem vorangehenden Attribut', () => {
    const bericht = neuerBericht()
    const index = join(FIXTURES, 'index.decoyAttribute.html')
    const einstiege = guiEinstiege(bericht, index)
    const namen = einstiege.map((p) => p.replace(FIXTURES, '').replace(/\\/g, '/'))

    expect(namen).toContain('/realAttribute.js')
    expect(namen).not.toContain('/decoyAttribute.js')
    // Und keine falsche Vollstaendigkeit: waere die echte Datei uebersehen
    // worden, MUESSTE das hier auftauchen statt in stillem Schweigen zu enden.
    expect(bericht.ungelesen).toEqual([])
    expect([...bericht.fremd]).toEqual([])
  })

  it('ROT gegen den unreparierten Stand: die alte `name=`-Textsuche liest den Deckname statt der echten Datei', () => {
    // Reproduziert den Vorgaenger-Regex aus #182/Runde 1 direkt (das negative
    // Lookbehind statt eines Attribut-Tokenizers) - exakt die Fassung, die auf
    // dem HEAD dieser Welle vor diesem Fix stand.
    function altesAttributWert(tag, name) {
      const re = new RegExp(`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i')
      const m = tag.match(re)
      if (m === null) return null
      return m[1] ?? m[2] ?? m[3] ?? null
    }
    const tag = '<script data-note="see src=deckname.js" src="./echt.js">'
    expect(altesAttributWert(tag, 'src')).toBe('deckname.js')
    expect(altesAttributWert(tag, 'src')).not.toBe('./echt.js')
  })
})

describe('previewFrameFence - die aeussere Tag-Grenze kennt Anfuehrungszeichen (#182, vierte Form)', () => {
  // Der Tokenizer aus der dritten Form liest EIN Attribut richtig - aber die
  // AEUSSERE Tag-Grenze in `guiEinstiege()`/`spezifizierer()` schnitt den
  // Tag-Text weiterhin mit `[^>]*` heraus, und dieses Muster kennt selbst
  // keine Anfuehrungszeichen. Ein zitiertes `>` in einem FREMDEN Attribut VOR
  // dem echten `src`/`href` (`data-note="a > b"`) riss die Tag-Grenze schon
  // DORT ab - das echte Attribut kam im (verstuemmelten) Tag-Text gar nicht
  // mehr vor. `attributWert()` fand folgerichtig nichts, aber `wert === null`
  // sieht dort wie „kein Attribut" aus, nicht wie „Tag abgeschnitten" - das
  // Blatt verschwand spurlos, UND `ungelesen`/`fremd` blieben BEIDE leer.
  // Genau die falsche Vollstaendigkeit, die die dritte Form so gefaehrlich
  // machte - nur eine Ebene hoeher.
  it('folgt `<script src>` UND `<link href>`, auch wenn ein vorangehendes Attribut ein zitiertes `>` enthaelt', () => {
    const bericht = neuerBericht()
    const index = join(FIXTURES, 'index.tagBoundary.html')
    const einstiege = guiEinstiege(bericht, index)
    const namen = einstiege.map((p) => p.replace(FIXTURES, '').replace(/\\/g, '/'))

    expect(namen).toContain('/tagBoundaryScript.js')
    expect(namen).toContain('/tagBoundaryLink.css')
    // Keine falsche Vollstaendigkeit: waeren die Blaetter uebersehen worden,
    // MUESSTE das hier stehen statt in stillem Schweigen zu enden.
    expect(bericht.ungelesen).toEqual([])
    expect([...bericht.fremd]).toEqual([])
  })

  it('spezifizierer() findet ein `<style src>`, auch wenn der `<style>`-Tag selbst ein zitiertes `>` traegt', () => {
    const src = '<style data-note="a > b" src="./real.css"></style>'
    expect(spezifizierer(src)).toContain('./real.css')
  })

  /**
   * MEHRERE `<style>`-Bloecke waren ungeprueft: eine Mutation von
   * `querySelectorAll` auf `querySelector` (nur der erste Block) blieb gruen.
   * Vue-SFCs tragen regelmaessig zwei Bloecke - einen `scoped` und einen
   * globalen -, und ausgerechnet der globale ist der, der bis in die Vorschau
   * durchschlagen kann. Der `src`-Block bleibt dabei aussen vor (H2): sein
   * Inhalt steht in einer eigenen Datei, die der Verfolger separat liest.
   */
  it('styleBloecke() liefert JEDEN Block, nicht nur den ersten', () => {
    const src = [
      '<template><div /></template>',
      '<style scoped>.a{color:red}</style>',
      '<style src="./extern.css"></style>',
      '<style lang="css">.b{color:blue}</style>',
    ].join('\n')

    expect(styleBloecke(src)).toEqual(['.a{color:red}', '.b{color:blue}'])
  })

  it('styleBloecke() findet den Rumpf, auch wenn der `<style>`-Tag selbst ein zitiertes `>` traegt', () => {
    const src = '<style data-note="a > b">.x{color:red}</style>'
    expect(styleBloecke(src)).toEqual(['.x{color:red}'])
  })

  it('die `rel=stylesheet`-Erkennung liest jetzt das ECHTE `rel`-Attribut, statt den ganzen Tag nach dem Wort zu durchsuchen', () => {
    // Solange die Klassifizierung eine reine Textsuche im ganzen Tag war,
    // konnte ein vorangehendes Attribut mit dem TEXT `stylesheet` einen
    // `<link>` faelschlich als Stylesheet einstufen, dessen echtes `rel`
    // etwas anderes sagt (Deckname `data-note="stylesheet"` VOR
    // `rel="preload"`) - eine andere Form desselben Fehlers: hier eine
    // FALSCHE Bejahung statt eines stillen Verschwindens.
    const bericht = neuerBericht()
    const index = join(FIXTURES, 'index.relDecoy.html')
    const einstiege = guiEinstiege(bericht, index)
    const namen = einstiege.map((p) => p.replace(FIXTURES, '').replace(/\\/g, '/'))

    expect(namen).not.toContain('/nicht-lesen.css')
    // Und direkt an der Klassifizierung: `rel` ist "preload", nicht
    // "stylesheet" - unabhaengig vom Deckname im Tag-Text.
    // Unzitiert, wie im Fixture: `[^"'>]*` (die alte Klassifizierung) kennt
    // keine Attributgrenzen und liess sich genau hier taeuschen.
    const falscherPositivTag = '<link rel=preload data-note=stylesheet href="./nicht-lesen.css">'
    expect(attributWert(falscherPositivTag, 'rel')).toBe('preload')
  })

  it('ROT gegen den unreparierten Stand (Commit 94e82143): `[^>]*` reisst die Tag-Grenze am zitierten `>` ab, das echte Blatt verschwindet spurlos', () => {
    // Reproduziert exakt die Regexe aus Runde 2 (`guiEinstiege()`), die auf
    // dem HEAD dieser Welle vor diesem Fix standen.
    const src = readFileSync(join(FIXTURES, 'index.tagBoundary.html'), 'utf8')
    const scriptTreffer = [...src.matchAll(/<script\b[^>]*>/gi)]
    expect(scriptTreffer).toHaveLength(1)
    // Der "Tag", den die alte Regex liefert, endet VOR dem echten `src`.
    expect(scriptTreffer[0][0]).toBe('<script data-note="a >')
    expect(attributWert(scriptTreffer[0][0], 'src')).toBeNull()

    const linkTreffer = [...src.matchAll(/<link\b[^>]*>/gi)]
    expect(linkTreffer).toHaveLength(1)
    expect(linkTreffer[0][0]).toBe('<link data-note="x >')
    expect(attributWert(linkTreffer[0][0], 'href')).toBeNull()
  })
})

describe('previewFrameFence - ein misslungenes Vorkommen bricht nicht die GANZE Suche ab (#182, fuenfte Form)', () => {
  // `tags()` bricht bei EINEM Vorkommen, das `tagEnde()` nicht schliessen
  // kann, mit `break` die Suche fuer den GANZEN Tag-Namen ab - nicht nur fuer
  // dieses eine Vorkommen. Ein HTML-Kommentar mit einem unbalancierten
  // Anfuehrungszeichen (`<!-- alt: <script data-note="disabled -->`) laesst
  // `tagEnde()` bis zum naechsten ECHTEN Anfuehrungszeichen weiterlaufen -
  // das kann das der naechsten, WIRKLICHEN `<script>`-Attribute sein, und
  // dann findet `tagEnde()` gar keine schliessende `>` mehr. Mit `break`
  // verschwindet dadurch JEDES echte `<script>` DANACH im selben Dokument -
  // spurlos, ohne `ungelesen`/`fremd`. Derselbe Fehler wie die vorigen: eine
  // Textsuche, die Kommentare/Anfuehrungszeichen nicht kennt, bestimmt
  // Struktur falsch.
  it('folgt einem echten `<script src>` NACH einem HTML-Kommentar mit unbalanciertem Anfuehrungszeichen', () => {
    const bericht = neuerBericht()
    const index = join(FIXTURES, 'index.commentBreak.html')
    const einstiege = guiEinstiege(bericht, index)
    const namen = einstiege.map((p) => p.replace(FIXTURES, '').replace(/\\/g, '/'))

    expect(namen).toContain('/realScript.js')
    expect(bericht.ungelesen).toEqual([])
    expect([...bericht.fremd]).toEqual([])
  })

  it('ROT gegen den unreparierten Stand (Commit 442bf34c): `break` gibt die Suche nach dem ersten misslungenen Vorkommen komplett auf', () => {
    // Reproduziert exakt `tags()` aus Runde 3, die auf dem HEAD dieser Welle
    // vor diesem Fix stand: `break` statt `continue`.
    function tagEndeAlt(src, offen) {
      let zitat = null
      for (let i = offen; i < src.length; i += 1) {
        const ch = src[i]
        if (zitat !== null) {
          if (ch === zitat) zitat = null
        } else if (ch === '"' || ch === "'") {
          zitat = ch
        } else if (ch === '>') {
          return i
        }
      }
      return -1
    }
    function tagsAlt(src, name) {
      const out = []
      const oeffner = new RegExp(`<${name}\\b`, 'gi')
      let m
      while ((m = oeffner.exec(src)) !== null) {
        const ende = tagEndeAlt(src, m.index)
        if (ende === -1) break // <- der Fehler aus Runde 3
        out.push({ text: src.slice(m.index, ende + 1), start: m.index, ende: ende + 1 })
        oeffner.lastIndex = ende + 1
      }
      return out
    }
    const src = readFileSync(join(FIXTURES, 'index.commentBreak.html'), 'utf8')
    expect(tagsAlt(src, 'script')).toEqual([])
    // Zum Vergleich: die REPARIERTE `guiEinstiege()` findet das echte Script
    // sehr wohl (siehe erste Probe dieses Blocks).
  })
})

describe('previewFrameFence - styleBloecke() parst echt statt nachzubauen (#182, sechste/siebte/achte Form -> Runde 5 Umbau)', () => {
  // GESCHICHTE, damit die Kurskorrektur nachvollziehbar bleibt: Runde 4 baute
  // `styleRumpfEnde()` - eine eigene Anfuehrungszeichen-/Kommentar-Buchhaltung
  // fuer die Suche nach dem SCHLIESSENDEN `</style>`, weil eine rohe
  // `/<\/style\s*>/`-Textsuche auch ein `</style>` traf, das nur als TEXT in
  // einem CSS-String stand (`content: "</style>";`). Diese Buchhaltung selbst
  // brachte danach ZWEI NEUE Faelle mit (Runde 5, siebte/achte Form): ein
  // `</style>` in einer UNZITIERTEN `url(...)` (die Buchhaltung kennt nur
  // Anfuehrungszeichen) schnitt trotzdem mittendrin ab, und ein einzelnes
  // UNBALANCIERTES Anfuehrungszeichen liess `zeichenkettenEnde()` bis ans Ende
  // der GANZEN Quelldatei laufen - der KOMPLETTE Block verschwand dann
  // spurlos, nicht einmal `ungelesen`/`fremd` sahen ihn. Vier Formen an EINER
  // Stelle (H2, vierte, sechste, jetzt siebte/achte) sind kein Einzelfall mehr.
  //
  // GEMESSEN statt angenommen, bevor ersetzt wurde: `<style>` ist ein HTML5
  // RAW-TEXT-Element wie `<script>` - sein Rumpf endet beim ERSTEN woertlichen
  // `</style>`, PUNKT, UNABHAENGIG von jedem CSS-Anfuehrungszeichen, -Klammer
  // oder -Kommentar darin. Das ist keine Vereinfachung, sondern die
  // Spezifikation - nachgemessen gegen den ECHTEN `@vue/compiler-sfc`, den
  // Vite selbst benutzt: fuer `content: "</style>"` UND fuer `url(</style>)`
  // liefert er exakt denselben abgeschnittenen Rumpf UND einen Compile-Fehler
  // ("Invalid end tag") - eine Datei mit so einem Text baut also gar nicht
  // erst, kein stiller Verlust im ausgelieferten Bundle. `styleBloecke()`
  // nutzt jetzt denselben `DOMParser` wie {@link dokumentPfad} und erbt diese
  // Regel, ohne sie selbst nachzubauen - die ersten beiden Proben hier
  // bestaetigen exakt diese Deckungsgleichheit mit dem echten Compiler.
  it('schneidet den Rumpf am ersten woertlichen `</style>` ab, das in einem CSS-String steht - wie der echte Compiler', () => {
    // Nachgemessen gegen `@vue/compiler-sfc`: `parse(...).descriptor.styles[0].content`
    // liefert fuer dieselbe Eingabe ebenfalls `.decoy{content: "` UND einen
    // Fehler „Invalid end tag" - die Datei baut in Wirklichkeit gar nicht.
    const src =
      '<style>.decoy{content: "</style>"} iframe[data-testid="visu-preview-frame"]{opacity:.3}</style>'
    expect(styleBloecke(src)).toEqual(['.decoy{content: "'])
  })

  it('schneidet den Rumpf auch an einem `</style>` ab, das in einem CSS-Kommentar steht', () => {
    const src =
      '<style>/* alt: </style> */ iframe[data-testid="visu-preview-frame"]{opacity:.4}</style>'
    expect(styleBloecke(src)).toEqual(['/* alt: '])
  })

  it('schneidet den Rumpf auch an einem `</style>` ab, das in einer UNZITIERTEN url(...) steht (Runde 5, siebte Form)', () => {
    // Nachgemessen gegen `@vue/compiler-sfc`: identischer abgeschnittener
    // Rumpf UND „Invalid end tag" fuer dieselbe Eingabe - auch dieser Fall
    // ist kein stiller Bundle-Verlust, sondern ein roter Build.
    const src =
      '<style>.decoy{background:url(</style>)} iframe[data-testid="visu-preview-frame"]{opacity:.3}</style>'
    expect(styleBloecke(src)).toEqual(['.decoy{background:url('])
  })

  it('verliert NICHTS, wenn irgendwo im Rumpf ein einzelnes unbalanciertes Anfuehrungszeichen steht, ohne dass `</style>` je woertlich vorkommt (Runde 5, achte Form)', () => {
    // Der Nachbau aus Runde 4 liess `zeichenkettenEnde()` in diesem Fall bis
    // zum Ende der GANZEN Quelldatei laufen und fand dann gar kein Schluss-Tag
    // mehr - der KOMPLETTE Block verschwand. Ein Raw-Text-Element kennt keine
    // Anfuehrungszeichen-Buchhaltung und ist von einem unbalancierten Zitat
    // darin unbeeindruckt: der Rumpf kommt VOLLSTAENDIG an, woertlich bis zum
    // echten Schluss-Tag.
    const src =
      '<style>.decoy{content: "unbalanced} iframe[data-testid="visu-preview-frame"]{opacity:.4}</style>'
    const bloecke = styleBloecke(src)
    expect(bloecke).toHaveLength(1)
    expect(bloecke[0]).toBe('.decoy{content: "unbalanced} iframe[data-testid="visu-preview-frame"]{opacity:.4}')
    // Das unbalancierte Zitat ist danach eine Aufgabe von `cssRegeln()`, nicht
    // mehr von `styleBloecke()` - und `cssRegeln()` verwirft auch dabei nichts
    // still: die Textstelle bleibt sichtbar in den Deklarationen der einen
    // Regel, die der eigene Scanner daraus macht (Kritik #182, dritte/vierte
    // Form: eine unlesbare Stelle wird nie zu einem leeren Ergebnis).
    const { rules } = cssRegeln(bloecke[0])
    expect(rules.some((r) => r.decls.includes('visu-preview-frame'))).toBe(true)
  })

  it('ROT gegen den unreparierten Stand (Commit eed1341f, Runde 4): die eigene Anfuehrungszeichen-Buchhaltung verliert den KOMPLETTEN Block bei einem unbalancierten Zitat', () => {
    // Reproduziert exakt `styleRumpfEnde()`/`styleBloecke()` aus Runde 4, die
    // auf dem HEAD dieser Welle vor diesem Umbau standen.
    function zeichenkettenEndeAlt(text, i) {
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
    function styleRumpfEndeAlt(src, ab) {
      let i = ab
      while (i < src.length) {
        const ch = src[i]
        if (ch === '"' || ch === "'") {
          i = zeichenkettenEndeAlt(src, i)
          continue
        }
        if (ch === '/' && src[i + 1] === '*') {
          const e = src.indexOf('*/', i + 2)
          i = e === -1 ? src.length : e + 2
          continue
        }
        if (/^<\/style\s*>/i.test(src.slice(i))) return i
        i += 1
      }
      return -1
    }
    const src =
      '<style>.decoy{content: "unbalanced} iframe[data-testid="visu-preview-frame"]{opacity:.4}</style>'
    const oeffnung = /<style\b[^>]*>/i.exec(src)
    const ende = oeffnung.index + oeffnung[0].length
    expect(styleRumpfEndeAlt(src, ende)).toBe(-1)
    // Zum Vergleich: die REPARIERTE `styleBloecke()` verliert hier nichts
    // (siehe vorige Probe).
  })

  it('`<style src="…">` bleibt uebersprungen - kein Rumpf zu melden (H2 bleibt Aufgabe von spezifizierer())', () => {
    expect(styleBloecke('<style src="./x.css"></style>')).toEqual([])
  })
})

describe('previewFrameFence - spezifizierer() folgt <style src="…"> (#182, H2)', () => {
  it('findet ein zitiertes `<style src="…">`', () => {
    const src = readFileSync(join(FIXTURES, 'Component.styleSrc.vue'), 'utf8')
    expect(spezifizierer(src)).toContain('./styleSrc.css')
  })

  it('findet auch ein UNZITIERTES `<style src=…>`', () => {
    expect(spezifizierer('<style src=./x.css></style>')).toContain('./x.css')
  })

  it('ROT gegen den unreparierten Stand: der Vorgaenger-Regex (nur import/from/@import) kennt kein `<style src>`', () => {
    const altesMuster =
      /(?:\bimport\s*\(\s*|\bfrom\s+|\bimport\s+|@import\s+(?:url\s*\(\s*)?)['"]([^'"\n]+)['"]/g
    const src = readFileSync(join(FIXTURES, 'Component.styleSrc.vue'), 'utf8')
    const treffer = [...src.matchAll(altesMuster)]
    expect(treffer).toHaveLength(0)
  })

  it('aufloesen() findet das externe Blatt eines <style src> wirklich - keine Regel geht mehr still verloren', () => {
    const bericht = neuerBericht()
    const von = join(FIXTURES, 'Component.styleSrc.vue')
    const ziel = aufloesen('./styleSrc.css', von, bericht)
    expect(ziel).toBe(join(FIXTURES, 'styleSrc.css'))
    const css = readFileSync(ziel, 'utf8')
    const { rules } = cssRegeln(css)
    expect(rules).toHaveLength(1)
    expect(rules[0].selector).toContain('visu-preview-frame')
  })
})

describe('previewFrameFence - theoretisch gleichartige Formen (#182, selbst nachgeprueft)', () => {
  it('unzitiertes `@import url(...)` faellt NICHT still weg - es landet sichtbar in `sonstiges`', () => {
    const css = '@import url(./ohne-anfuehrungszeichen.css);\n.a { color: red; }'
    const { rules, sonstiges } = cssRegeln(css)
    expect(rules).toHaveLength(1)
    expect(sonstiges.some((s) => s.includes('@import') && s.includes('ohne-anfuehrungszeichen.css'))).toBe(true)
  })

  it('ein Pfad aus gui/public/ wird gefunden UND gelesen, statt "nicht gefunden" zu melden', () => {
    const probeName = '__previewFrameFence_probe.css'
    const publicPath = join(GUI_ROOT, 'public', probeName)
    writeFileSync(publicPath, 'iframe[data-testid="visu-preview-frame"]{opacity:.3}\n')
    try {
      const bericht = neuerBericht()
      const irgendeineDateiUnterGuiRoot = join(GUI_ROOT, 'index.html')
      const ziel = aufloesen(`/${probeName}`, irgendeineDateiUnterGuiRoot, bericht)
      expect(ziel).toBe(publicPath)
      expect(bericht.ungelesen).toEqual([])
      const { rules } = cssRegeln(readFileSync(ziel, 'utf8'))
      expect(rules).toHaveLength(1)
    } finally {
      rmSync(publicPath, { force: true })
    }
    expect(existsSync(publicPath)).toBe(false)
  })

  it('ROT gegen den unreparierten Stand: `join(GUI_ROOT, spec)` allein findet die Datei unter public/ nicht - "nicht gefunden" waere irrefuehrend', () => {
    const probeName = '__previewFrameFence_probe_alt.css'
    const publicPath = join(GUI_ROOT, 'public', probeName)
    writeFileSync(publicPath, '.probe{color:red}\n')
    try {
      // Exakt der alte Kandidat: `join(GUI_ROOT, spec)`, ohne den `public/`-Weg.
      const alterKandidat = join(GUI_ROOT, probeName)
      expect(existsSync(alterKandidat)).toBe(false)
      expect(existsSync(publicPath)).toBe(true)
    } finally {
      rmSync(publicPath, { force: true })
    }
  })
})
