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
