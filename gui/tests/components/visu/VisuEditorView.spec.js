import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  BILDDEKLARATIONEN,
  GEPINNTE_KLASSEN,
  GUI_ROOT,
  bildaendernd,
  erreichendeRegeln,
  guiRules,
  vorfahrenpfad,
  zeile,
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
 * deshalb bis zum `<html>` hinauf, und der Blattscan laeuft gegen genau diesen
 * Pfad.
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
  it('haengt in einem gepinnten Vorfahrenpfad bis zum Dokument hinauf', async () => {
    const w = await mountEditor({ isAdmin: true, attachTo: document.body })
    try {
      const frameEl = w.find('[data-testid="visu-preview-frame"]').element
      const pfad = vorfahrenpfad(frameEl)

      // 1 - der Pfad, Element fuer Element ausgeschrieben. Er endet am `<html>`,
      //     nicht an der Komponentenwurzel. Das dritte `<div>` ist der
      //     Mount-Container von Vue Test Utils - es steht hier mit, damit die
      //     Liste den ECHTEN Pfad zeigt und nicht einen gefilterten.
      expect(pfad.map(zeile)).toEqual([
        'div | flex flex-col gap-2 | ',
        'div | flex flex-col gap-4 p-4 | ',
        'div |  | ',
        'body |  | ',
        'html |  | ',
      ])

      // 2 - und negativ, mit derselben Regel, mit der auch der Blattscan sucht:
      //     kein Element auf diesem Pfad traegt eine Klasse aus der
      //     Transform-/Filter-/Zoom-Familie und keinen Inline-Stil, der dasselbe
      //     von Hand tut.
      expect(bildaendernd([frameEl, ...pfad])).toEqual([])

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

  it('haengt auch in der echten Schale in einem gepinnten Pfad bis zum <html>', async () => {
    const w = await mountShell()
    try {
      const frameEl = w.find('[data-testid="visu-preview-frame"]').element
      const pfad = vorfahrenpfad(frameEl)

      // Der ganze Weg, Element fuer Element - inklusive des Inline-Stils, den
      // `App.vue` per Attribut-Durchreichung auf die Layout-Wurzel legt.
      expect(pfad.map(zeile)).toEqual([
        'div | flex flex-col gap-2 | ',
        'div | flex flex-col gap-4 p-4 | ',
        'main | flex-1 overflow-y-auto p-6 | ',
        'div | flex-1 flex flex-col overflow-hidden | ',
        'div | flex h-screen overflow-hidden bg-surface-900 | margin-right: 0px; transition: margin-right 200ms ease;',
        'div | min-h-screen | ',
        'div |  | ',
        'body |  | ',
        'html |  | ',
      ])

      // Und negativ: nichts auf diesem Weg aendert das Bild.
      expect(bildaendernd([frameEl, ...pfad])).toEqual([])

      // Gegenprobe, die fallen kann: die Layout-Wurzel bekommt den Angriff.
      const layout = pfad.find((el) => el.classList.contains('h-screen'))
      layout.classList.add('scale-90')
      try {
        expect(bildaendernd([frameEl, ...vorfahrenpfad(frameEl)]).length).toBe(1)
      } finally {
        layout.classList.remove('scale-90')
      }
      expect(bildaendernd([frameEl, ...vorfahrenpfad(frameEl)])).toEqual([])
    } finally {
      w.unmount()
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
      const { files, rules } = guiRules()
      // Gegenprobe 0c: der Scanner liest ueberhaupt etwas - ein Scanner, der
      // nichts findet, weil er nichts liest, faellt an diesen zwei Zahlen auf.
      expect(files).toBeGreaterThan(20)
      expect(rules.length).toBeGreaterThan(20)

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
