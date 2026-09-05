import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  BILDDEKLARATIONEN,
  GEPINNTE_KLASSEN,
  GUI_ROOT,
  bildaendernd,
  blattkette,
  cssRegeln,
  dokumentPfad,
  erreichendeRegeln,
  guiEinstiege,
  guiRules,
  styleBloecke,
  unterWurzel,
  vorfahrenpfad,
  zeile,
  zieltAufRahmen,
} from '../../helpers/previewFrameFence.js'

/**
 * Admin-Gate des Visu-Editors (C4, Issue #171) - und DER VORFAHRENPFAD DES
 * VORSCHAURAHMENS, gemessen dort, wo der Rahmen wirklich eingebettet ist.
 *
 * Der Editor lebt in der Admin-GUI, weil hier die Berechtigungen ausgewertet
 * werden (§2.4). Ein Nicht-Admin sieht den Bereich nicht — weder die Vorschau
 * noch den Menuepunkt.
 *
 * Der zweite Teil gehoert zum Paritaetsnachweis der Vorschau (Messlatte E3,
 * `apps/visu/src/preview/PreviewParity.spec.ts`). Der Pin in
 * `VisuPreviewFrame.spec.js` mountet die Komponente allein und sieht deshalb nur
 * ihren eigenen Teilbaum; `scale-90 saturate-50` am einbettenden `<div>` DIESER
 * Ansicht ging durch alle GUI-Tests (Kritik R9, N-A). Hier steht der Pfad
 * deshalb bis zum `<html>` DIESER Montage hinauf, und der Blattscan laeuft gegen
 * genau diesen Pfad.
 *
 * Der dritte Block misst, was der Blattscan ueberhaupt LIEST - Klammerselektoren,
 * `<style>`-Bloecke abseits des Zeilenanfangs, Blaetter ausserhalb von `gui/src`
 * entlang der Importkette - und liest `gui/index.html` als DOKUMENT, also den
 * Teil des Vorfahrenpfades, den keine Montage hat (Kritik R10, X1/X3/X5/X8).
 */

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('@/stores/auth')
  vi.doUnmock('vue-router')
  vi.doUnmock('@/components/ui/VisuIcon.vue')
  vi.doUnmock('@/stores/websocket')
  vi.doUnmock('@/stores/navLinks')
  vi.doUnmock('@/stores/adapters')
})

async function mountEditor({ isLoggedIn = true, isAdmin = true, attachTo } = {}) {
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn, isAdmin, username: 'admin', loadMe: vi.fn() }),
  }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const { default: VisuEditorView } = await import('@/views/VisuEditorView.vue')
  const wrapper = mount(VisuEditorView, { global: { plugins: [pinia] }, attachTo })
  await flushPromises()
  return wrapper
}

/**
 * Die Zustaende, die die ANSICHT annehmen kann - und in denen ihr
 * Vorfahrenpfad deshalb gelesen werden muss.
 *
 * Die Zustandsschleife der Runde 10 lag ausschliesslich in
 * `VisuPreviewFrame.spec.js`, also INNERHALB der Rahmenkomponente; die beiden
 * Pfad-Pins hier mounteten je einmal und lasen den Pfad genau einmal.
 * `:class="{ 'scale-90': applied }"` am `<div data-testid="visu-editor">` ging
 * deshalb durch die volle Suite (Kritik R10, X7) - und `applied` ist der
 * NORMALFALL im Betrieb: es steht, sobald die Vorschau den ersten Entwurf
 * uebernommen hat.
 */
const ANSICHTSZUSTAENDE = [
  ['frisch montiert', async () => {}],
  [
    'nach dem ersten uebernommenen Entwurf',
    async (w) => {
      w.findComponent({ name: 'VisuPreviewFrame' }).vm.$emit('applied', {
        pageId: 'p1',
        widgetCount: 3,
      })
      await flushPromises()
      // Gegenprobe: der Zustand steht wirklich an - sonst liefe die Schleife
      // zweimal durch denselben Mount-Zustand.
      expect(w.find('[data-testid="visu-editor-applied"]').exists()).toBe(true)
    },
  ],
]

describe('VisuEditorView — Admin-Gate', () => {
  it('zeigt einem Admin die Vorschau', async () => {
    const w = await mountEditor({ isAdmin: true })
    expect(w.find('[data-testid="visu-editor"]').exists()).toBe(true)
    expect(w.find('[data-testid="visu-preview-frame"]').exists()).toBe(true)
  })

  it('zeigt einem Nicht-Admin nichts vom Editor', async () => {
    const w = await mountEditor({ isLoggedIn: true, isAdmin: false })
    expect(w.find('[data-testid="visu-editor"]').exists()).toBe(false)
    expect(w.find('[data-testid="visu-preview-frame"]').exists()).toBe(false)
    expect(w.find('iframe').exists()).toBe(false)
  })

  it('zeigt einem Gast nichts vom Editor', async () => {
    const w = await mountEditor({ isLoggedIn: false, isAdmin: false })
    expect(w.find('[data-testid="visu-editor"]').exists()).toBe(false)
    expect(w.find('iframe').exists()).toBe(false)
  })

  /**
   * DER VORFAHRENPFAD DES RAHMENS, BIS ZUM DOKUMENT - und zwar in der Ansicht,
   * die den Rahmen wirklich einbettet.
   *
   * `transform`, `filter`, `zoom` und `opacity` wirken auf den ganzen Teilbaum:
   * `scale-90 saturate-50` an einem beliebigen Vorfahren des `<iframe>` zeigt
   * dem Autor Zeichen fuer Zeichen dasselbe verkleinerte, entsaettigte Bild wie
   * dieselbe Klasse am Rahmen selbst. Der Pin drueben in
   * `VisuPreviewFrame.spec.js` mountet die Komponente allein; sein Pfad endet an
   * der Komponentenwurzel, und oberhalb liegen dort nur die losgeloesten
   * Container von Vue Test Utils, die nie eine Klasse tragen. Genau eine Ebene
   * darueber - am `<div data-testid="visu-editor">` dieser Ansicht - lief der
   * Angriff durch die volle Suite (Kritik R9, N-A).
   *
   * Deshalb wird hier an `document.body` gemountet und JEDES Element vom Rahmen
   * bis zum `<html>` ausgeschrieben. Gemessen wird das ATTRIBUT, nicht der
   * gerechnete Stil - welche Deklaration ein Blatt am Ende auf `p-4` legt, sieht
   * dieser Test nicht; dafuer steht der Blattscan darunter.
   */
  it('haengt in JEDEM Zustand in einem gepinnten Vorfahrenpfad bis zum Dokument hinauf', async () => {
    for (const [name, hinfuehren] of ANSICHTSZUSTAENDE) {
      const w = await mountEditor({ isAdmin: true, attachTo: document.body })
      try {
        await hinfuehren(w)
        const frameEl = w.find('[data-testid="visu-preview-frame"]').element
        const pfad = vorfahrenpfad(frameEl)

        // 1 - der Pfad, Element fuer Element ausgeschrieben. Er endet am
        //     `<html>` DIESER Montage, nicht an der Komponentenwurzel. Das dritte
        //     `<div>` ist der Mount-Container von Vue Test Utils - es steht hier
        //     mit, damit die Liste den ganzen Pfad zeigt und nicht einen
        //     gefilterten. In der AUSLIEFERUNG steht an seiner Stelle
        //     `<div id="app">`, und darueber `body.antialiased` und `html.dark`;
        //     dieser Teil wird im dritten Block als Dokument gelesen
        //     (`dokumentPfad`), und was daran unentscheidbar bleibt, steht als
        //     Stueck 4 der Uebergabe an Teil E.
        expect([name, pfad.map(zeile)]).toEqual([
          name,
          [
            'div | flex flex-col gap-2 | ',
            'div | flex flex-col gap-4 p-4 | ',
            'div |  | ',
            'body |  | ',
            'html |  | ',
          ],
        ])

        // 2 - und negativ, mit derselben Regel, mit der auch der Blattscan sucht:
        //     kein Element auf diesem Pfad traegt eine Klasse aus der
        //     Transform-/Filter-/Zoom-Familie und keinen Inline-Stil, der dasselbe
        //     von Hand tut.
        expect([name, bildaendernd([frameEl, ...pfad])]).toEqual([name, []])

        // 3 - GEGENPROBE, und zwar eine, die FALLEN KANN: der Vorgaenger zaehlte
        //     nur die Schleifenlaenge und bewies damit, dass die Schleife
        //     weiterlaeuft - nicht, dass sie dort jemals etwas finden koennte
        //     (Kritik R9, Punkt 6.2). Hier bekommt ein echter Vorfahr - das
        //     `<body>`, drei Ebenen ueber dem Rahmen und ausserhalb der
        //     Komponente - genau die Klasse und den Stil des Angriffs, und die
        //     Pruefung muss beide namentlich melden.
        const body = document.body
        body.classList.add('scale-90')
        body.setAttribute('style', 'filter:saturate(.5)')
        try {
          expect(bildaendernd([frameEl, ...vorfahrenpfad(frameEl)])).toEqual([
            'body | scale-90 | filter:saturate(.5) -> Klasse scale-90',
            'body | scale-90 | filter:saturate(.5) -> Stil filter:saturate(.5)',
          ])
        } finally {
          body.classList.remove('scale-90')
          body.removeAttribute('style')
        }
        expect(bildaendernd([frameEl, ...vorfahrenpfad(frameEl)])).toEqual([])
      } finally {
        w.unmount()
      }
    }
  })

  it('haengt die Session nie an die iframe-URL', async () => {
    globalThis.localStorage.setItem('access_token', 'admin-token-xyz')
    const w = await mountEditor({ isAdmin: true })
    const src = w.find('[data-testid="visu-preview-frame"]').attributes('src')
    expect(src).toBeTruthy()
    expect(src).not.toContain('admin-token-xyz')
    expect(src).not.toContain('token')
    globalThis.localStorage.removeItem('access_token')
  })
})

async function mountSidebar({ isLoggedIn = true, isAdmin = true } = {}) {
  vi.doMock('vue-router', () => ({ useRoute: () => ({ path: '/', name: 'Dashboard' }) }))
  vi.doMock('@/components/ui/VisuIcon.vue', () => ({ default: { template: '<span class="visu-icon" />' } }))
  vi.doMock('@/stores/websocket', () => ({ useWebSocketStore: () => ({ connected: true }) }))
  vi.doMock('@/stores/navLinks', () => ({ useNavLinksStore: () => ({ links: [], load: vi.fn().mockResolvedValue([]) }) }))
  vi.doMock('@/stores/adapters', () => ({
    useAdapterStore: () => ({ instances: [], fetchAdapters: vi.fn().mockResolvedValue([]) }),
  }))
  vi.doMock('@/stores/auth', () => ({
    useAuthStore: () => ({ isLoggedIn, isAdmin, username: 'admin' }),
  }))

  const pinia = createPinia()
  setActivePinia(pinia)
  const { default: Sidebar } = await import('@/components/layout/Sidebar.vue')
  const wrapper = mount(Sidebar, {
    props: { collapsed: false },
    global: {
      plugins: [pinia],
      stubs: { RouterLink: { template: '<a :href="to" v-bind="$attrs"><slot /></a>', props: ['to'] } },
    },
  })
  await flushPromises()
  return wrapper
}

describe('Sidebar — Menuepunkt Visu-Editor', () => {
  it('zeigt einem Admin den Menuepunkt', async () => {
    const w = await mountSidebar({ isAdmin: true })
    expect(w.find('[data-testid="nav-visu-editor"]').exists()).toBe(true)
  })

  it('zeigt einem Nicht-Admin den Menuepunkt nicht', async () => {
    const w = await mountSidebar({ isLoggedIn: true, isAdmin: false })
    expect(w.find('[data-testid="nav-visu-editor"]').exists()).toBe(false)
  })

  it('zeigt einem Gast den Menuepunkt nicht', async () => {
    const w = await mountSidebar({ isLoggedIn: false, isAdmin: false })
    expect(w.find('[data-testid="nav-visu-editor"]').exists()).toBe(false)
  })

  it('laesst die bestehenden Menuepunkte unberuehrt', async () => {
    const w = await mountSidebar({ isAdmin: false })
    expect(w.find('[data-testid="nav-home"]').exists()).toBe(true)
    expect(w.find('[data-testid="nav-datapoints"]').exists()).toBe(true)
  })
})

/**
 * UND DER PFAD OBERHALB DER ANSICHT - die Schale, in der die Route wirklich
 * haengt.
 *
 * Der Pin darueber mountet `VisuEditorView` an den `<body>`; in der
 * ausgelieferten Anwendung liegen dazwischen aber noch vier Elemente:
 * `div.min-h-screen` aus `App.vue`, die Wurzel von `AppLayout` (die zusaetzlich
 * den INLINE-STIL `contentAreaStyle` per Attribut-Durchreichung bekommt), die
 * Spalte daneben und das `<main>`. Jedes von ihnen traegt den `<iframe>`, und
 * `transform`, `filter`, `zoom` und `opacity` erben auf ihn - eine Klasse dort
 * waere D1 vier Ebenen hoeher.
 *
 * Gemountet wird deshalb `App.vue` mit der ECHTEN `AppLayout`; nur was NEBEN dem
 * Pfad liegt (Sidebar, TopBar, HelpDrawer), ist gestubbt - ein Geschwister kann
 * den Rahmen nicht faerben. An der Stelle der Route steht die echte
 * `VisuEditorView`.
 */
describe('VisuEditorView - der Vorfahrenpfad in der echten Schale', () => {
  async function mountShell() {
    vi.doMock('vue-router', () => ({ useRoute: () => ({ meta: {}, name: 'VisuEditor' }) }))
    vi.doMock('@/stores/auth', () => ({
      useAuthStore: () => ({ isLoggedIn: true, isAdmin: true, username: 'admin', loadMe: vi.fn() }),
    }))
    vi.doMock('@/stores/websocket', () => ({ useWebSocketStore: () => ({ connect: vi.fn() }) }))
    vi.doMock('@/stores/settings', () => ({
      useSettingsStore: () => ({ theme: 'system', load: vi.fn(), applyTheme: vi.fn() }),
    }))
    vi.doMock('@/stores/help', () => ({
      useHelpStore: () => ({ loadIndex: vi.fn(), isOpen: false, drawerWidth: 0 }),
    }))

    const pinia = createPinia()
    setActivePinia(pinia)
    const { default: App } = await import('@/App.vue')
    const { default: VisuEditorView } = await import('@/views/VisuEditorView.vue')
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
        // NUR die Geschwister sind gestubbt. `AppLayout` - der ganze
        // Vorfahrenpfad - ist echt.
        stubs: {
          Sidebar: { template: '<div data-testid="sidebar-stub" />' },
          TopBar: { template: '<div data-testid="topbar-stub" />' },
          HelpDrawer: { template: '<div data-testid="help-drawer-stub" />' },
          RouterView: VisuEditorView,
        },
      },
    })
    await flushPromises()
    return wrapper
  }

  afterEach(() => {
    vi.doUnmock('@/stores/help')
    vi.doUnmock('@/stores/settings')
  })

  it('haengt in JEDEM Zustand auch in der echten Schale in einem gepinnten Pfad bis zum <html>', async () => {
    for (const [name, hinfuehren] of ANSICHTSZUSTAENDE) {
      const w = await mountShell()
      try {
        await hinfuehren(w)
        const frameEl = w.find('[data-testid="visu-preview-frame"]').element
        const pfad = vorfahrenpfad(frameEl)

        // Der ganze Weg, Element fuer Element - inklusive des Inline-Stils, den
        // `App.vue` per Attribut-Durchreichung auf die Layout-Wurzel legt.
        expect([name, pfad.map(zeile)]).toEqual([
          name,
          [
            'div | flex flex-col gap-2 | ',
            'div | flex flex-col gap-4 p-4 | ',
            'main | flex-1 overflow-y-auto p-6 | ',
            'div | flex-1 flex flex-col overflow-hidden | ',
            'div | flex h-screen overflow-hidden bg-surface-900 | margin-right: 0px; transition: margin-right 200ms ease;',
            'div | min-h-screen | ',
            'div |  | ',
            'body |  | ',
            'html |  | ',
          ],
        ])

        // Und negativ: nichts auf diesem Weg aendert das Bild.
        expect([name, bildaendernd([frameEl, ...pfad])]).toEqual([name, []])

        // Gegenprobe, die fallen kann: die Layout-Wurzel bekommt den Angriff.
        const layout = pfad.find((el) => el.classList.contains('h-screen'))
        layout.classList.add('scale-90')
        try {
          expect([name, bildaendernd([frameEl, ...vorfahrenpfad(frameEl)]).length]).toEqual([name, 1])
        } finally {
          layout.classList.remove('scale-90')
        }
        expect([name, bildaendernd([frameEl, ...vorfahrenpfad(frameEl)])]).toEqual([name, []])
      } finally {
        w.unmount()
      }
    }
  })

  /**
   * DER DRITTE WEG ZU DEMSELBEN PIXEL: eine Regel in einem handgeschriebenen
   * Blatt der GUI, die den Rahmen oder einen seiner Vorfahren trifft. Sie
   * beruehrt weder eine Klassenliste noch ein `style`-Attribut, und happy-dom
   * rechnet sie nicht aus - im Quelltext steht sie aber.
   *
   * Der Vorgaenger fragte ausschliesslich, ob ein Selektor eine von zehn Klassen
   * NENNT. `iframe[data-testid="visu-preview-frame"] { transform: scale(.9) }`
   * und `.p-4 > iframe { opacity: .3 }` nennen keine davon und gingen durch die
   * volle Suite (Kritik R9, N-B) - dabei ist genau das der Stil, in dem
   * `gui/src/style.css` ohnehin geschrieben ist
   * (`.table tr.ringbuffer-row-matched td span:not([class*="rounded-full"])`,
   * `* { box-sizing: border-box }`).
   *
   * Gefragt wird jetzt nach der WIRKUNG: welche Regel kann dieses `<iframe>`
   * oder eines der Elemente ueber ihm ueberhaupt treffen - per echtem
   * `matches()` gegen den ganzen Pfad, und zusaetzlich per Schluessel-Compound
   * fuer Selektoren, deren linker Teil in diesem Mount nicht steht. Was uebrig
   * bleibt, steht als Liste ausgeschrieben; wer eine Regel dazuschreibt, muss
   * sie hier bewusst nachtragen.
   */
  it('kein handgeschriebenes Blatt der GUI erreicht den Rahmen oder seinen Vorfahrenpfad', async () => {
    const w = await mountShell()
    try {
      const frameEl = w.find('[data-testid="visu-preview-frame"]').element
      const pfad = [frameEl, ...vorfahrenpfad(frameEl)]

      // Gegenprobe 0a: die Klassenliste, mit der der Schluessel-Compound-Weg
      // sucht, ist nicht veraltet - sie ist genau das, was Rahmen und
      // Vorfahrenpfad heute tragen. Wer eine Klasse dazuschreibt, faellt zuerst
      // am Pin darueber und dann hier.
      const getragen = new Set()
      for (const el of pfad) {
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
      const { files, rules, sonstiges, ungelesen, fremd } = guiRules()
      // Gegenprobe 0c: der Scanner liest ueberhaupt etwas - ein Scanner, der
      // nichts findet, weil er nichts liest, faellt an diesen zwei Zahlen auf.
      expect(files).toBeGreaterThan(20)
      expect(rules.length).toBeGreaterThan(20)

      // Und was der Leser NICHT als Regel versteht, steht namentlich da statt
      // still wegzufallen (Kritik R10, X3). Vier at-Regeln des Einstiegsblattes
      // und zwei `@reference` aus einem SFC - keine davon kann ein Element
      // treffen, und wer eine siebte dazuschreibt, traegt sie hier bewusst nach.
      expect(sonstiges).toEqual([
        'src/components/datapoints/BindingForm.vue: @reference "tailwindcss"',
        'src/components/datapoints/BindingForm.vue: @reference "tailwindcss"',
        'src/style.css: @import "tailwindcss"',
        'src/style.css: @custom-variant dark (&:where(.dark, .dark *))',
        'src/style.css: @theme inline { … }',
        'src/style.css: @theme { … }',
      ])

      // Und eine Ebene tiefer dieselbe Linie: nicht nur was in einem gelesenen
      // Text steht, sondern WELCHE DATEIEN ueberhaupt gelesen werden. Ein
      // Spezifizierer, der zu keiner gelesenen Datei fuehrt, verschwand vorher
      // kommentarlos - ein `import '../../theme-probe.css'` aus `main.js`
      // heraus landete im Bundle und skalierte den Rahmen (Kritik R11, Y2).
      // Heute stehen alle namentlich da: das entfernte Blatt des Dokuments und
      // zwoelf Sprachdateien, in denen kein CSS stehen kann. Wer einen
      // dreizehnten Weg aufmacht, traegt ihn hier bewusst nach.
      expect(ungelesen).toEqual([
        'index.html: https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap (entferntes Blatt, wird nicht geladen)',
        'src/composables/useTz.js: @/locales/de.json (keine Datei, in der CSS stehen kann)',
        'src/composables/useTz.js: @/locales/en.json (keine Datei, in der CSS stehen kann)',
        'src/composables/useTz.js: @/locales/es.json (keine Datei, in der CSS stehen kann)',
        'src/composables/useTz.js: @/locales/fr.json (keine Datei, in der CSS stehen kann)',
        'src/composables/useTz.js: @/locales/gsw.json (keine Datei, in der CSS stehen kann)',
        'src/composables/useTz.js: @/locales/it.json (keine Datei, in der CSS stehen kann)',
        'src/i18n.js: ./locales/de.json (keine Datei, in der CSS stehen kann)',
        'src/i18n.js: ./locales/en.json (keine Datei, in der CSS stehen kann)',
        'src/i18n.js: ./locales/es.json (keine Datei, in der CSS stehen kann)',
        'src/i18n.js: ./locales/fr.json (keine Datei, in der CSS stehen kann)',
        'src/i18n.js: ./locales/gsw.json (keine Datei, in der CSS stehen kann)',
        'src/i18n.js: ./locales/it.json (keine Datei, in der CSS stehen kann)',
      ])

      // Die zweite Liste: blosse NAMEN, an denen die Kette endet. Sie sind
      // fremder Code und stehen ausdruecklich in der Uebergabe an Teil E - vier
      // von ihnen sind BLAETTER, die mitausgeliefert und hier nicht gelesen
      // werden. Der Scan verschweigt das nicht, er schreibt es aus.
      expect(fremd).toEqual([
        '@floating-ui/vue',
        '@vue-flow/background',
        '@vue-flow/controls',
        '@vue-flow/controls/dist/style.css',
        '@vue-flow/core',
        '@vue-flow/core/dist/style.css',
        '@vue-flow/core/dist/theme-default.css',
        '@vue-flow/minimap',
        '@vue-flow/minimap/dist/style.css',
        '@vue-flow/node-resizer',
        '@vue-flow/node-resizer/dist/style.css',
        'axios',
        'chart.js',
        'chart.js/auto',
        'chroma-js',
        'pinia',
        'tailwindcss',
        'vue',
        'vue-draggable-plus',
        'vue-i18n',
        'vue-router',
      ])
      // Und die Grenze zwischen beiden Listen ist scharf: in `fremd` steht nie
      // etwas, das ein Pfad in dieses Repo sein koennte.
      expect(fremd.filter((spec) => /^(?:@\/|\.{1,2}\/|\/)/.test(spec))).toEqual([])

      const { treffer, unlesbar } = erreichendeRegeln(pfad, rules)

      // Gegenprobe 0d: der Abgleich TRIFFT ueberhaupt etwas - eine Regel, die
      // genau so geschrieben ist wie der Angriff, wird von beiden Wegen
      // gefunden. Ohne diese Zeile koennte der ganze Scan still danebenliegen.
      const probe = [
        { file: 'PROBE', selector: 'iframe[data-testid="visu-preview-frame"]', decls: 'transform: scale(.9)' },
        { file: 'PROBE', selector: '.p-4 > iframe', decls: 'opacity: .3' },
        { file: 'PROBE', selector: '.layout-shell .p-4 > iframe', decls: 'filter: saturate(.5)' },
        { file: 'PROBE', selector: '.rounded-lg', decls: 'transform: scale(.9)' },
        { file: 'PROBE', selector: 'body', decls: 'zoom: .9' },
      ]
      expect(erreichendeRegeln(pfad, probe).treffer).toHaveLength(probe.length)
      // Und eine Regel, die den Pfad NICHT erreicht, wird auch nicht gemeldet -
      // sonst waere „alles ist ein Treffer" die Erklaerung fuer die Liste unten.
      expect(
        erreichendeRegeln(pfad, [{ file: 'PROBE', selector: '.gibt-es-hier-nicht td', decls: 'color: red' }])
          .treffer,
      ).toEqual([])

      // Kein Glied wird still uebersprungen: was die Laufzeit nicht als Selektor
      // lesen kann, steht hier namentlich. Heute sind das genau die zwei
      // Schritte eines `@keyframes`-Blocks (der Regelscan sieht die innersten
      // Bloecke, also auch `0% { … }`) - sie koennen ueberhaupt kein Element
      // treffen. Ueber den Schluessel-Compound laufen sie trotzdem, und keiner
      // von beiden nennt den Rahmen.
      expect(unlesbar).toEqual(['src/style.css: 0%', 'src/style.css: 100%'])

      // Und die Liste selbst: was den Pfad heute ueberhaupt erreicht. Drei
      // Regeln, alle drei aus dem Einstiegsblatt und alle drei erwartbar - das
      // `:root` mit den Farbtokens (es trifft das `<html>`), der
      // Universalselektor mit dem Box-Modell und der `<body>`-Grundton. Wer eine
      // vierte dazuschreibt, muss sie hier bewusst nachtragen.
      expect(treffer.map((r) => `${r.file}: ${r.selector}`)).toEqual([
        'src/style.css: :root',
        'src/style.css: *',
        'src/style.css: body',
      ])

      // Der harte Zaun daneben, und der ist der eigentliche: keine dieser Regeln
      // aendert das BILD. Wer eine Transform-, Filter-, Zoom- oder
      // Opacity-Deklaration auf den Pfad legt, faellt hier auch dann, wenn er
      // die Liste darueber mitgezogen hat.
      expect(
        treffer
          .filter((r) => BILDDEKLARATIONEN.test(r.decls))
          .map((r) => `${r.file}: ${r.selector} { ${r.decls} }`),
      ).toEqual([])
      // Gegenprobe dazu: dieser Filter erkennt den Angriff wirklich.
      expect(BILDDEKLARATIONEN.test('transform: scale(.9)')).toBe(true)
      expect(BILDDEKLARATIONEN.test('color: red; opacity: .3')).toBe(true)
      expect(BILDDEKLARATIONEN.test('box-sizing: border-box;')).toBe(false)
    } finally {
      w.unmount()
    }
  })
})

/**
 * DER BLATTSCAN SELBST - was er liest, und was er MELDET statt es zu verwerfen.
 *
 * Der Scan ist der dritte Weg zu demselben Pixel (siehe den Block darueber): er
 * sucht im Quelltext der GUI nach Regeln, die den Rahmen oder seinen
 * Vorfahrenpfad treffen. Ein Scan taugt aber nur so viel wie das, was er
 * ueberhaupt zu Gesicht bekommt - und genau dort lagen vier Angriffe der Kritik
 * R10, alle vier im gebauten Blatt nachgewiesen:
 *
 *   X3  `iframe:not([hidden]) { transform: scale(.9) }` - der Regelscanner
 *       verwarf JEDEN Selektor mit Klammer still (Selektorgruppe `[^{}();]*?`).
 *   X5  `<title>…</title><style>…</style>` - der `<style>`-Anker verlangte
 *       Zeilenanfang; ein Block auf derselben Zeile wie sein Vorgaenger blieb
 *       ungelesen.
 *   X8  ein handgeschriebenes Blatt NEBEN dem Quellverzeichnis, per `main.js`
 *       importiert - der Scan lief ein VERZEICHNIS ab statt den Importen zu
 *       folgen.
 *   X1  `<body class="scale-90 saturate-50" style="filter:hue-rotate(90deg)">`
 *       in `index.html` - die Datei wurde als `<style>`-Behaelter gelesen, nie
 *       als Dokument.
 *
 * Die Tests hier messen die drei Leseschritte einzeln, damit ein Rueckfall an
 * der Ursache auffaellt und nicht erst an einer Trefferliste.
 */
describe('Der Blattscan des Vorschaurahmens - was er liest', () => {
  it('liest Selektoren mit Klammern, statt sie still zu verwerfen (R10, X3)', () => {
    const faelle = [
      ['iframe:not([hidden]) { transform: scale(.9); filter: saturate(.5) }', 'iframe:not([hidden])'],
      ['.p-4 > iframe:not([hidden]) { opacity: .3 }', '.p-4 > iframe:not([hidden])'],
      [':is(.p-4) iframe { zoom: .9 }', ':is(.p-4) iframe'],
      ['iframe:where(.a, .b) { filter: invert(1) }', 'iframe:where(.a, .b)'],
      ['.b:hover iframe { transform: scale(.9) }', '.b:hover iframe'],
      ['input:not([type="hidden"]) + iframe { opacity: .3 }', 'input:not([type="hidden"]) + iframe'],
    ]
    for (const [css, selector] of faelle) {
      expect([css, cssRegeln(css).rules.map((r) => r.selector)]).toEqual([css, [selector]])
    }

    // Und die Deklarationen kommen vollstaendig mit - sonst liefe der harte
    // Zaun (BILDDEKLARATIONEN) auf einer halben Zeile.
    expect(cssRegeln('iframe:not([hidden]) { transform: scale(.9); filter: saturate(.5) }').rules[0].decls)
      .toBe('transform: scale(.9); filter: saturate(.5)')

    // Gegenprobe: der Scanner erfindet keine Regel, wo keine steht.
    expect(cssRegeln('/* nur ein Kommentar mit { und } darin */').rules).toEqual([])
  })

  it('meldet jedes Glied, das kein Selektor ist, statt es still zu verwerfen (R10, X3)', () => {
    const css = [
      '@import "tailwindcss";',
      '@custom-variant dark (&:where(.dark, .dark *));',
      '@theme inline { --color-surface-900: var(--surface-900); }',
      '@layer base { * { box-sizing: border-box } }',
      '@media (max-width: 700px) { iframe { transform: scale(.9) } }',
      '@keyframes flash { 0% { filter: brightness(1.25) } }',
      '.c { color: red }',
    ].join('\n')
    const { rules, sonstiges } = cssRegeln(css)

    // Was ein Element treffen KANN, kommt als Regel an - auch aus dem Inneren
    // eines `@layer`, `@media` oder `@keyframes`.
    expect(rules.map((r) => r.selector)).toEqual(['*', 'iframe', '0%', '.c'])

    // Und was keines treffen kann, steht namentlich da. Die Zusage „nichts wird
    // still uebersprungen" gilt ab jetzt fuer die REGEL, nicht nur fuer das
    // einzelne Glied (Kritik R10, §4.4).
    expect(sonstiges).toEqual([
      '@import "tailwindcss"',
      '@custom-variant dark (&:where(.dark, .dark *))',
      '@theme inline { … }',
    ])
  })

  it('liest ein <style>, das nicht am Zeilenanfang steht (R10, X5)', () => {
    expect(
      styleBloecke('<title>open bridge server</title><style>iframe { transform: scale(.9) }</style>'),
    ).toEqual(['iframe { transform: scale(.9) }'])

    // Die bisher schon gelesenen Formen bleiben gelesen: am Zeilenanfang,
    // eingerueckt, mit Attributen, ueber mehrere Zeilen.
    expect(styleBloecke('<style>a{color:red}</style>')).toEqual(['a{color:red}'])
    expect(styleBloecke('  <style scoped>\n a{color:red}\n</style>')).toEqual(['\n a{color:red}\n'])
    expect(styleBloecke('<div><style type="text/css">a{color:red}</style></div>')).toEqual([
      'a{color:red}',
    ])

    // Gegenprobe: ein Element, das nur SO HEISST, ist kein Stilblock.
    expect(styleBloecke('<style-guide>a{color:red}</style-guide>')).toEqual([])
  })

  it('folgt den Importen des Einstiegs auch aus dem Quellverzeichnis heraus (R10, X8)', () => {
    const fixture = join(GUI_ROOT, 'tests', 'fixtures', 'previewFrameFence', 'eintrag.js')
    const kette = blattkette([fixture]).map((p) => relative(GUI_ROOT, p).replace(/\\/g, '/'))

    // Beide Blaetter liegen ausserhalb von `src` - eines direkt am Einstieg,
    // eines zwei Spruenge entfernt hinter einem JS-Modul. Genau so lag
    // `gui/theme-extra.css` im Angriff.
    expect(kette).toContain('tests/fixtures/previewFrameFence/nebenblatt.css')
    expect(kette).toContain('tests/fixtures/previewFrameFence/tiefes-blatt.css')

    // Und sie kommen nicht nur an, sie werden auch gelesen und als erreichend
    // erkannt - sonst waere der Weg gefunden und der Fund trotzdem stumm.
    const selektoren = kette
      .filter((p) => p.endsWith('.css'))
      .flatMap((p) => cssRegeln(readFileSync(join(GUI_ROOT, p), 'utf8')).rules.map((r) => r.selector))
    expect(selektoren).toEqual(['iframe[data-testid="visu-preview-frame"]', '.p-4 > iframe'])
    expect(selektoren.every((sel) => zieltAufRahmen(sel))).toBe(true)

    // Gegenprobe: der Verfolger laeuft nicht ins Leere und nicht in fremden
    // Code. `@import "tailwindcss"` ist ein blosser Name, kein Pfad; die
    // Tailwind-Kette bleibt der an Teil E uebergebene Anteil.
    expect(kette.some((p) => p.includes('node_modules'))).toBe(false)
    expect(kette.some((p) => p === 'tailwindcss')).toBe(false)
  })

  it('folgt vom ausgelieferten Einstieg aus in das Quellverzeichnis hinein (R10, X8)', () => {
    const kette = blattkette().map((p) => relative(GUI_ROOT, p).replace(/\\/g, '/'))
    expect(kette).toContain('index.html')
    expect(kette).toContain('src/style.css')
    expect(kette).toContain('src/App.vue')
    expect(kette).toContain('src/components/visu/VisuPreviewFrame.vue')
    expect(kette).toContain('src/views/VisuEditorView.vue')
    // Und keine Datei doppelt - sonst zaehlte eine Regel zweimal.
    expect(new Set(kette).size).toBe(kette.length)
  })

  it('liest gui/index.html als DOKUMENT, nicht nur als <style>-Behaelter (R10, X1)', () => {
    // Der Mount-Punkt der Anwendung, aus der Quelle gelesen: was `main.js`
    // montiert, ist der Knoten, ueber dem in der AUSLIEFERUNG noch `<body>` und
    // `<html>` liegen. Faellt diese Zeile, zeigt der Pin darunter auf nichts.
    expect(readFileSync(join(GUI_ROOT, 'src', 'main.js'), 'utf8')).toContain("mount('#app')")

    const { app, pfad } = dokumentPfad()
    expect(app.getAttribute('id')).toBe('app')

    // Der Pfad des ausgelieferten Dokuments, Element fuer Element - Tag,
    // Klassenliste im Wortlaut, `style`-Attribut. `<body class="antialiased">`
    // steht hier ausgeschrieben; wer `scale-90` dazuschreibt, faellt an dieser
    // Zeile (Kritik R10, X1).
    expect([zeile(app), ...pfad.map(zeile)]).toEqual([
      'div |  | ',
      'body | antialiased | ',
      'html |  | ',
    ])

    // Und negativ, mit derselben Regel wie am Mount-Pfad.
    expect(bildaendernd([app, ...pfad])).toEqual([])

    // GEGENPROBE, die fallen kann: der `<body>` des ausgelieferten Dokuments
    // bekommt genau Klasse und Stil des Angriffs.
    const body = pfad.find((el) => el.tagName.toLowerCase() === 'body')
    body.classList.add('scale-90')
    body.setAttribute('style', 'filter:hue-rotate(90deg)')
    expect(bildaendernd([app, ...pfad])).toEqual([
      'body | antialiased scale-90 | filter:hue-rotate(90deg) -> Klasse scale-90',
      'body | antialiased scale-90 | filter:hue-rotate(90deg) -> Stil filter:hue-rotate(90deg)',
    ])
    // Die naechste Lesung parst frisch - die Probe bleibt nicht haengen.
    expect(bildaendernd([dokumentPfad().app, ...dokumentPfad().pfad])).toEqual([])
  })

  it('folgt auch einem <link rel="stylesheet"> des Einstiegs (R11, Y1)', () => {
    // Ein Blatt kann auf ZWEI Wegen am ausgelieferten Dokument haengen: hinter
    // einem Modul (`<script src>`) und direkt (`<link rel="stylesheet">`). Der
    // Scan folgte nur dem ersten; ein Blatt am zweiten ging woertlich ins
    // Bundle und durch alle GUI-Tests (Kritik R11, Y1).
    const bericht = { ungelesen: [], fremd: new Set() }
    const index = join(GUI_ROOT, 'tests', 'fixtures', 'previewFrameFence', 'index-mit-link.html')
    const einstiege = guiEinstiege(bericht, index).map((p) =>
      relative(GUI_ROOT, p).replace(/\\/g, '/'),
    )

    expect(einstiege).toContain('tests/fixtures/previewFrameFence/index-mit-link.html')
    expect(einstiege).toContain('tests/fixtures/previewFrameFence/nebenblatt.css')
    expect(einstiege).toContain('tests/fixtures/previewFrameFence/zwischenmodul.js')
    // Ein `<link>`, das kein Stilblatt ist, wird nicht verfolgt.
    expect(einstiege.some((p) => p.endsWith('favicon.svg'))).toBe(false)
    // Und das ENTFERNTE Blatt kann dieser Lauf nicht lesen - es faellt deshalb
    // nicht weg, sondern steht namentlich da.
    expect(bericht.ungelesen).toEqual([
      'tests/fixtures/previewFrameFence/index-mit-link.html: https://fonts.example/css2?family=Inter (entferntes Blatt, wird nicht geladen)',
    ])

    // Und am ECHTEN Einstieg: `gui/index.html` traegt heute ein entferntes
    // Blatt (Google Fonts). Auch das steht jetzt in der Liste statt still zu
    // verschwinden.
    const echt = { ungelesen: [], fremd: new Set() }
    guiEinstiege(echt)
    expect(echt.ungelesen.filter((z) => z.includes('fonts.googleapis.com'))).toHaveLength(1)
  })

  it('meldet jeden Spezifizierer, den es nicht liest, statt ihn still zu verwerfen (R11, Y2)', () => {
    // Dieselbe Linie wie bei `sonstiges` und `unlesbar`, eine Ebene tiefer: bei
    // der Frage, WELCHE DATEIEN der Scan ueberhaupt zu Gesicht bekommt. Ein
    // `import '../../theme-probe.css'` aus `gui/src/main.js` heraus wurde von
    // `aufloesen` kommentarlos verworfen - das Blatt landete im Bundle und
    // skalierte den Rahmen (Kritik R11, Y2).
    const bericht = { ungelesen: [], fremd: new Set() }
    const fixture = join(GUI_ROOT, 'tests', 'fixtures', 'previewFrameFence', 'aussen-eintrag.js')
    blattkette([fixture], bericht)

    expect(bericht.ungelesen).toEqual([
      'tests/fixtures/previewFrameFence/aussen-eintrag.js: ../../../../eslint.config.js (liegt ausserhalb von gui/)',
      'tests/fixtures/previewFrameFence/aussen-eintrag.js: ./gibt-es-nicht.css (nicht gefunden)',
    ])
    // Ein blosser Name ist kein Pfad und kann kein Blatt dieses Repos sein; er
    // steht in der zweiten Liste, nicht im Papierkorb.
    expect([...bericht.fremd]).toEqual(['tailwindcss'])
  })

  it('zieht die Wurzelgrenze als Pfadvergleich, nicht als Namensvergleich (R11)', () => {
    // `startsWith(GUI_ROOT)` ist ein Zeichenkettenvergleich. Eine Datei NEBEN
    // `gui/`, deren Name mit `gui` anfaengt, kam damit versehentlich durch.
    const nachbar = `${GUI_ROOT}-extra-probe.css`
    expect(nachbar.startsWith(GUI_ROOT)).toBe(true)
    expect(unterWurzel(nachbar)).toBe(false)

    expect(unterWurzel(join(GUI_ROOT, 'index.html'))).toBe(true)
    expect(unterWurzel(join(GUI_ROOT, 'src', 'style.css'))).toBe(true)
    expect(unterWurzel(resolve(GUI_ROOT, '..', 'theme-probe.css'))).toBe(false)
    // Die Wurzel selbst ist keine Datei UNTER der Wurzel.
    expect(unterWurzel(GUI_ROOT)).toBe(false)
  })
})
