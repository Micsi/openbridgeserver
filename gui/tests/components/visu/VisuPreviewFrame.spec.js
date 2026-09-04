import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import VisuPreviewFrame from '@/components/visu/VisuPreviewFrame.vue'
import {
  VISU_PREVIEW_CHANNEL,
  VISU_PREVIEW_MESSAGE,
  VISU_PREVIEW_PROTOCOL,
} from '@/composables/useVisuPreviewBridge'

/**
 * Die eingebettete Vorschau des Visu-Editors (M5 C4, Issue #171).
 *
 * Der Composable-Test pinnt die Regeln der Bruecke; hier laeuft die Verdrahtung
 * an der echten Komponente: iframe, Session aus dem Admin-Login, Entwurf, und
 * die beiden Rueckmeldungen. Wichtigster Punkt: die Session geht per
 * postMessage an den geprueften Origin und steht nie in der iframe-URL.
 *
 * Und dazu DER RAHMEN SELBST. Er gehoert zum Paritaetsnachweis der Vorschau
 * (`apps/visu/src/preview/PreviewParity.spec.ts`, Messlatte E3), laesst sich
 * dort aber nicht messen: jene Spec liest `apps/visu`, `packages` und die
 * Skin-Pakete, nicht `gui/` - und der Vorschau-DOM weiss nichts von dem
 * Element, in dem er steckt. `transform`, `filter` oder `zoom` am `<iframe>`
 * (eine Utility-Klasse `scale-90 saturate-50` genuegt) zeigen dem Autor ein
 * verkleinertes, entsaettigtes Bild derselben Seite.
 *
 * Drei Tests halten das hier fest, und zusammen decken sie DREI Wege zu genau
 * demselben Pixel:
 *
 *   1. „steht in einem gepinnten Rahmen" - Klassenliste und `style`-Attribut
 *      des `<iframe>` selbst, Zeichen fuer Zeichen.
 *   2. „haengt in einem gepinnten Vorfahrenpfad" - JEDES Element vom `<iframe>`
 *      bis zur Komponentenwurzel, dazu negativ der ganze Pfad bis zum Dokument
 *      hinauf. `transform: scale(.9)` und `filter: saturate(.5)` ERBEN auf den
 *      `<iframe>`: eine Klasse am Eltern-`<div>` wirkt Zeichen fuer Zeichen wie
 *      dieselbe Klasse am Rahmen, und Test 1 sieht sie nicht (Kritik R8, D1).
 *   3. „kein handgeschriebenes Blatt der GUI faerbt den Rahmen" - ein
 *      Quelltextscan ueber alle Stylesheets und `<style>`-Bloecke unter
 *      `gui/src` (analog zu `foreignPreviewStyles()` in der Visu-Spec): nennt
 *      eines von ihnen eine der gepinnten Klassen, steht es hier.
 *
 * WAS AUCH DIESE DREI NICHT SEHEN, und was damit als einziges an Teil E geht:
 * die BERECHNETE Deklaration aus dem GEBAUTEN Utility-Blatt. Was Tailwind aus
 * `rounded-lg` oder `bg-white` erzeugt, steht in keinem Quelltext dieses Repos,
 * und happy-dom rechnet kein CSS aus. Das ist eine echte Grenze des Verfahrens,
 * keine Testluecke - sie steht als Rest von E3-2 im Kopf von
 * `apps/visu/src/preview/PreviewParity.spec.ts`.
 */

/**
 * Die Wurzel von `gui/`. Vitest laeuft hier mit `gui/` als Arbeitsverzeichnis
 * (`vitest.config.js` liegt dort); dass das stimmt, prueft der Blattscan mit
 * einer eigenen Zusicherung nach, statt es zu glauben.
 */
const GUI_ROOT = process.cwd()

/**
 * Ein Element als eine Zeile: Tag, Klassenliste im Wortlaut, `style`-Attribut.
 * Die Klassen werden NICHT sortiert - der Pin soll auch eine umsortierte Liste
 * melden, damit niemand versehentlich eine dazuschreibt.
 */
const zeile = (el) =>
  [el.tagName.toLowerCase(), el.getAttribute('class') ?? '', el.getAttribute('style') ?? ''].join(
    ' | ',
  )

/**
 * Die Klassen, die der Rahmen UND sein Vorfahrenpfad heute tragen - der
 * Suchbegriff des Blattscans. Sie stehen hier ausgeschrieben statt aus dem DOM
 * gelesen, damit der Scan nicht mitwandert, wenn jemand die Klassenliste
 * aendert: dann faellt zuerst der Pin, und diese Liste wird bewusst nachgezogen.
 */
const GEPINNTE_KLASSEN = [
  'flex',
  'flex-col',
  'gap-2',
  'w-full',
  'h-[70vh]',
  'rounded-lg',
  'border',
  'border-slate-200',
  'dark:border-slate-700/60',
  'bg-white',
]

/**
 * Tailwinds Transform-, Filter- und Zoom-Utilities als Praefixliste - alles,
 * was das BILD im Rahmen aendert, ohne den Rahmen selbst zu beruehren.
 */
const BILDKLASSEN =
  /^(scale|rotate|skew|translate|transform|perspective|origin|blur|saturate|grayscale|sepia|invert|hue-rotate|contrast|brightness|opacity|zoom|backdrop|mix-blend|isolate)(-|$)/

/**
 * Jede Regel jedes HANDGESCHRIEBENEN Blattes der GUI: Stylesheets und
 * `<style>`-Bloecke unter `gui/src`, dazu das ausgelieferte `index.html`.
 * `dist/` und `node_modules/` bleiben aussen vor - das eine ist das Ergebnis
 * dieser Quellen, das andere nicht unser Code.
 *
 * Was das NICHT liest, ausdruecklich: das gebaute Utility-Blatt. Was Tailwind
 * aus `rounded-lg` macht, steht in keiner dieser Dateien.
 */
function guiRules() {
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
function nenntKlasse(selector, cls) {
  const roh = selector.replace(/\\/g, '')
  return new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(roh)
}

const PREVIEW_ORIGIN = window.location.origin
const EVIL_ORIGIN = 'https://evil.example'
const TOKEN = 'gui-admin-token-4c2f'

const DRAFT = {
  skin: 'edomi',
  pageId: 'p1',
  nodes: [{ id: 'p1', parent_id: null, name: 'W', type: 'PAGE', kind: 'normal', page_config: { widgets: [] } }],
}

/**
 * Das Fenster-Doppel des iframes dieser Montage. Es ist die einzige Quelle, von
 * der die Bruecke etwas annimmt - genau wie im Browser `iframe.contentWindow`.
 */
let frameWindow = null

/** Ein `message`-Ereignis von Hand einspeisen (happy-dom laesst kein fremdes source zu). */
function emit(data, origin = PREVIEW_ORIGIN, source = frameWindow) {
  window.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }))
}

const message = (type, extra = {}) => ({
  channel: VISU_PREVIEW_CHANNEL,
  type,
  protocol: VISU_PREVIEW_PROTOCOL,
  ...extra,
})

describe('VisuPreviewFrame — die Bruecke an der echten Komponente', () => {
  /** Die ausgehenden Nachrichten DIESER Montage - jede Montage hat ihre eigene
   *  Ablage, sonst wuerde eine noch haengende Vorgaengerin mitzaehlen. */
  let sent
  const mounted = []

  async function mountFrame(props = { draft: DRAFT }) {
    setActivePinia(createPinia())
    const wrapper = mount(VisuPreviewFrame, { props })
    mounted.push(wrapper)
    await flushPromises()
    // Das iframe-Fenster durch ein Doppel ersetzen, damit die ausgehenden
    // Nachrichten pruefbar sind.
    const box = []
    sent = box
    frameWindow = {
      postMessage: (msgObj, targetOrigin) => box.push({ message: msgObj, targetOrigin }),
    }
    Object.defineProperty(wrapper.find('iframe').element, 'contentWindow', {
      configurable: true,
      value: frameWindow,
    })
    return wrapper
  }

  beforeEach(() => {
    globalThis.localStorage.setItem('access_token', TOKEN)
  })
  afterEach(() => {
    // Ohne Ausbauen bleibt der `message`-Zuhoerer jeder Montage am Fenster
    // haengen und der naechste Test misst zwei Bruecken statt einer.
    for (const w of mounted.splice(0)) {
      try {
        w.unmount()
      } catch {
        /* schon ausgebaut (der Ausbau-Test macht es selbst) */
      }
    }
    globalThis.localStorage.removeItem('access_token')
  })

  it('zeigt das iframe, ohne die Session an die URL zu haengen', async () => {
    const wrapper = await mountFrame()
    const src = wrapper.find('[data-testid="visu-preview-frame"]').attributes('src')
    expect(src).toBeTruthy()
    expect(src).not.toContain(TOKEN)
    expect(src).not.toContain('?')
  })

  /**
   * DER RAHMEN, GEPINNT. Was hier steht, ist der „Bildschirm", auf dem die
   * Vorschau laeuft: eine Klasse mehr - `scale-90`, `saturate-50`, `blur-sm`,
   * `zoom-90` - und der Autor sieht ein anderes Bild als der Nutzer, ohne dass
   * die Paritaets-Spec der Visu etwas davon merken koennte (sie liest `gui/`
   * nicht). Deshalb steht die Klassenliste hier ausgeschrieben statt als
   * `toContain`, und das `style`-Attribut muss fehlen.
   *
   * Gemessen wird das ATTRIBUT, nicht der gerechnete Stil: welche Deklaration
   * ein Blatt der GUI am Ende auf `rounded-lg` legt, sieht dieser Test nicht.
   */
  it('steht in einem gepinnten Rahmen - Klassenliste und style-Attribut', async () => {
    const wrapper = await mountFrame()
    const frameEl = wrapper.find('[data-testid="visu-preview-frame"]')
    expect(frameEl.classes()).toEqual([
      'w-full',
      'h-[70vh]',
      'rounded-lg',
      'border',
      'border-slate-200',
      'dark:border-slate-700/60',
      'bg-white',
    ])
    // Kein Inline-Stil: `transform`, `filter` und `zoom` kaemen sonst auch auf
    // diesem Weg an den Rahmen, ohne die Klassenliste zu beruehren.
    expect(frameEl.attributes('style')).toBeUndefined()
  })

  /**
   * DER VORFAHRENPFAD, GEPINNT. `transform` und `filter` erben auf den
   * `<iframe>`: `scale-90 saturate-50` am umgebenden `<div>` wirkt Zeichen fuer
   * Zeichen wie dieselbe Klasse am Rahmen - und der Pin darueber liest nur das
   * Element selbst, also ging genau das durch die volle GUI-Suite (Kritik R8,
   * D1). Gepinnt wird deshalb JEDES Element vom Rahmen bis zur
   * Komponentenwurzel, und darueber hinaus negativ bis zum Dokument.
   */
  it('haengt in einem gepinnten Vorfahrenpfad - auch ein Eltern-<div> aendert das Bild nicht', async () => {
    const wrapper = await mountFrame()
    const frameEl = wrapper.find('[data-testid="visu-preview-frame"]').element

    // 1 - der Pfad INNERHALB der Komponente, Zeile fuer Zeile ausgeschrieben.
    const pfad = []
    for (let el = frameEl.parentElement; el !== null && wrapper.element.contains(el); el = el.parentElement) {
      pfad.push(zeile(el))
    }
    expect(pfad).toEqual(['div | flex flex-col gap-2 | '])
    // Gegenprobe: der Pfad ist nicht deshalb kurz, weil die Schleife nichts
    // findet - sie endet an der Komponentenwurzel, und die ist der Rahmen-Vater.
    expect(frameEl.parentElement).toBe(wrapper.element)

    // 2 - und der GANZE Pfad bis zum Wurzelknoten dieses Mounts hinauf,
    //     negativ: kein Vorfahr traegt eine Klasse aus der
    //     Transform-/Filter-/Zoom-Familie und keinen Inline-Stil, der dasselbe
    //     von Hand tut.
    const verdaechtig = []
    for (let el = frameEl.parentElement; el !== null; el = el.parentElement) {
      for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
        if (BILDKLASSEN.test(cls)) verdaechtig.push(`${zeile(el)} -> Klasse ${cls}`)
      }
      const style = el.getAttribute('style') ?? ''
      if (/transform|filter|zoom|scale|opacity|perspective/i.test(style)) {
        verdaechtig.push(`${zeile(el)} -> Stil ${style}`)
      }
    }
    expect(verdaechtig).toEqual([])
    // Gegenprobe: diese zweite Schleife endet NICHT an der Komponentenwurzel -
    // sie laeuft bis zum Wurzelknoten des Mounts durch (Vue Test Utils haengt
    // ihn in einen losgeloesten Knoten, nicht ans Dokument).
    let hoehe = 0
    for (let el = frameEl.parentElement; el !== null; el = el.parentElement) hoehe += 1
    expect(hoehe).toBeGreaterThan(pfad.length)
  })

  /**
   * DER DRITTE WEG: eine Deklaration, die ein handgeschriebenes Blatt der GUI
   * auf eine der gepinnten Klassen legt (`.rounded-lg { transform: scale(.9) }`).
   * Sie beruehrt weder die Klassenliste noch den Vorfahrenpfad, und happy-dom
   * rechnet sie nicht aus - im Quelltext steht sie aber, genau wie die
   * Vorschau-Griffe in `foreignPreviewStyles()` der Visu-Spec.
   *
   * Was das NICHT abdeckt und was damit als einziges an Teil E geht: die
   * BERECHNETE Deklaration aus dem gebauten Utility-Blatt (was Tailwind selbst
   * aus `rounded-lg` erzeugt) - die steht in keinem Quelltext.
   */
  it('kein handgeschriebenes Blatt der GUI faerbt den Rahmen oder seinen Vorfahrenpfad', async () => {
    // Gegenprobe 0a: die Suchliste ist nicht veraltet - sie ist genau das, was
    // Rahmen und Vorfahrenpfad heute tragen. Wer eine Klasse dazuschreibt,
    // faellt zuerst am Pin darueber und dann hier.
    const wrapper = await mountFrame()
    const frameEl = wrapper.find('[data-testid="visu-preview-frame"]').element
    const getragen = new Set()
    for (let el = frameEl; el !== null && wrapper.element.contains(el); el = el.parentElement) {
      for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
        getragen.add(cls)
      }
    }
    expect([...getragen].sort()).toEqual([...GEPINNTE_KLASSEN].sort())

    // Gegenprobe 0b: der Scan liest wirklich `gui/` - ein falsches
    // Arbeitsverzeichnis wuerde ihn sonst still auf null Treffer bringen.
    expect(existsSync(join(GUI_ROOT, 'src', 'components', 'visu', 'VisuPreviewFrame.vue'))).toBe(
      true,
    )
    const { files, rules } = guiRules()
    // Gegenprobe: der Scanner liest ueberhaupt etwas - ein Scanner, der nichts
    // findet, weil er nichts liest, faellt an diesen zwei Zahlen auf.
    expect(files).toBeGreaterThan(20)
    expect(rules.length).toBeGreaterThan(20)

    const treffer = []
    for (const rule of rules) {
      for (const cls of GEPINNTE_KLASSEN) {
        if (nenntKlasse(rule.selector, cls)) {
          treffer.push(`${rule.file}: ${rule.selector} { ${rule.decls} }`)
        }
      }
    }
    expect(treffer).toEqual([])
  })

  it('schickt die Admin-Session erst auf preview/ready und nur an den geprueften Origin', async () => {
    await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    await flushPromises()

    expect(sent).toHaveLength(1)
    expect(sent[0].targetOrigin).toBe(PREVIEW_ORIGIN)
    expect(sent[0].message).toMatchObject({
      type: VISU_PREVIEW_MESSAGE.init,
      protocol: VISU_PREVIEW_PROTOCOL,
      session: { accessToken: TOKEN },
    })
  })

  it('schickt ohne Admin-Session gar nichts', async () => {
    globalThis.localStorage.removeItem('access_token')
    await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    await flushPromises()
    expect(sent).toHaveLength(0)
  })

  it('schickt den Entwurf nach der Bestaetigung und bei jeder Aenderung erneut', async () => {
    const wrapper = await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    emit(message(VISU_PREVIEW_MESSAGE.accepted))
    await flushPromises()

    const first = sent.filter((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)
    expect(first).toHaveLength(1)
    expect(first[0].message.draft).toEqual(DRAFT)

    await wrapper.setProps({ draft: { ...DRAFT, pageId: 'p2' } })
    await flushPromises()
    const all = sent.filter((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)
    expect(all).toHaveLength(2)
    expect(all[1].message.draft.pageId).toBe('p2')
  })

  it('meldet den gerenderten Entwurf nach oben', async () => {
    const wrapper = await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.draftApplied, { pageId: 'p1', widgetCount: 4 }))
    await flushPromises()

    expect(wrapper.emitted('applied')).toBeTruthy()
    expect(wrapper.emitted('applied')[0][0]).toEqual({ pageId: 'p1', widgetCount: 4 })
  })

  it('zeigt eine Ablehnung sichtbar an, statt sie zu verschlucken', async () => {
    const wrapper = await mountFrame()
    expect(wrapper.find('[data-testid="visu-preview-rejected"]').exists()).toBe(false)

    emit(message(VISU_PREVIEW_MESSAGE.rejected, { reason: 'protocol' }))
    await flushPromises()

    expect(wrapper.emitted('rejected')[0]).toEqual(['protocol'])
    expect(wrapper.find('[data-testid="visu-preview-rejected"]').exists()).toBe(true)
  })

  it('reagiert auf eine fremde Herkunft gar nicht', async () => {
    const wrapper = await mountFrame()
    emit(message(VISU_PREVIEW_MESSAGE.ready), EVIL_ORIGIN)
    emit(message(VISU_PREVIEW_MESSAGE.draftApplied, { pageId: 'p1', widgetCount: 4 }), EVIL_ORIGIN)
    await flushPromises()

    expect(sent).toHaveLength(0)
    expect(wrapper.emitted('applied')).toBeFalsy()
  })

  it('glaubt einem fremden Fenster nichts, auch nicht bei passender Herkunft', async () => {
    const wrapper = await mountFrame()
    const fremdesFenster = { postMessage: () => {} }

    emit(message(VISU_PREVIEW_MESSAGE.ready), PREVIEW_ORIGIN, fremdesFenster)
    emit(message(VISU_PREVIEW_MESSAGE.draftApplied, { pageId: 'p1', widgetCount: 4 }), PREVIEW_ORIGIN, fremdesFenster)
    emit(message(VISU_PREVIEW_MESSAGE.rejected, { reason: 'protocol' }), PREVIEW_ORIGIN, fremdesFenster)
    await flushPromises()

    expect(sent).toHaveLength(0)
    expect(wrapper.emitted('applied')).toBeFalsy()
    expect(wrapper.find('[data-testid="visu-preview-rejected"]').exists()).toBe(false)
  })

  it('sagt es, wenn im Rahmen ueberhaupt keine Vorschau antwortet', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountFrame()
      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(false)

      // Der Rahmen laedt etwas anderes (heute: die Admin-GUI ueber den
      // SPA-404-Fallback) und meldet sich nie. Ohne Frist bliebe das stumm.
      await vi.advanceTimersByTimeAsync(30000)
      await flushPromises()

      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('zeigt den Hinweis nicht, wenn die Vorschau sich meldet', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountFrame()
      emit(message(VISU_PREVIEW_MESSAGE.ready))
      emit(message(VISU_PREVIEW_MESSAGE.accepted))
      await flushPromises()
      await vi.advanceTimersByTimeAsync(30000)
      await flushPromises()

      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('nimmt den Hinweis zurueck, wenn sich die Vorschau doch noch meldet', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountFrame()
      await vi.advanceTimersByTimeAsync(30000)
      await flushPromises()
      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(true)

      // Ein langsam ladendes Visu-Bundle meldet sich nach der Frist. Der
      // Handshake steht damit; der Hinweis behauptet ab jetzt etwas Falsches.
      // Auf einen `draft-applied` zu warten hilft nicht: solange der Editor
      // keinen Entwurf hat, kommt keiner.
      emit(message(VISU_PREVIEW_MESSAGE.ready))
      emit(message(VISU_PREVIEW_MESSAGE.accepted))
      await flushPromises()

      expect(wrapper.find('[data-testid="visu-preview-unreachable"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hoert nach dem Ausbauen nicht mehr zu', async () => {
    const wrapper = await mountFrame()
    wrapper.unmount()
    emit(message(VISU_PREVIEW_MESSAGE.ready))
    await flushPromises()
    expect(sent).toHaveLength(0)
  })
})
