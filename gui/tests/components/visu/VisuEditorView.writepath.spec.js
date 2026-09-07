import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import VisuEditorView from '@/views/VisuEditorView.vue'

/**
 * DER WEG, DEN E10 IM BROWSER GEHT - hier ohne Browser (Nachzug M5 C3, #170).
 *
 * Der Fund: Element im Canvas anklicken, umbenennen, Datenpunkt binden,
 * Sichtbarkeitsregel setzen, ein Widget aus der Palette holen, „Speichern" im
 * Canvas -> Quittung „Gespeichert", und `GET /visu/pages/<id>` danach byteweise
 * der alte Stand. Der Autorenteil hatte keinen Schreibweg, und die Quittung war
 * ein falscher Erfolg.
 *
 * Diese Probe faehrt genau diese Reihenfolge an der ZUSAMMENGESETZTEN Ansicht
 * (nicht an den Einzelteilen) gegen einen „Server", der wie das echte Backend
 * ablegt und wieder herausgibt. Sie ist die Vitest-Haelfte von E10; die andere
 * ist das Playwright-Szenario, das seit diesem Nachzug faehrt.
 */

const PAGE = 'node-vorlage'

const TREE = [
  { id: PAGE, parent_id: null, name: 'M5 Include Gamma', type: 'PAGE', kind: 'normal', order: 30, access: 'public' },
]

const DP = { id: 'dp-1', name: 'dp-m5-solo', data_type: 'FLOAT', unit: '°C', value: 21.5, quality: 'good' }

const WIDGET = {
  id: 'w-gamma',
  name: 'M5 Gamma Item',
  type: 'Toggle',
  datapoint_id: null,
  status_datapoint_id: null,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  config: {},
}

const BOX_DEFAULTS = { x: 0, y: 0, w: 2, h: 2 }

/** Die Ablage des Backends, nachgezogen (`obs/models/visu.py` -> `PageConfig`). */
function normalizeOnServer(config) {
  const next = JSON.parse(JSON.stringify(config ?? {}))
  next.layout_mode = ['pixel', 'responsive'].includes(next.layout_mode) ? next.layout_mode : 'pixel'
  next.grid = Math.max(1, Math.round(Number(next.grid ?? 8)) || 1)
  next.breakpoints = [...new Set((next.breakpoints ?? [480, 768, 1024]).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  )
  next.skin = (typeof next.skin === 'string' ? next.skin.trim() : '') || null
  next.includes = [...new Set(next.includes ?? [])]
  next.ignore_global_includes = next.ignore_global_includes === true
  next.popup = next.popup ?? null
  next.widgets = (next.widgets ?? []).map((w) => {
    const copy = {
      id: w.id,
      name: typeof w.name === 'string' ? w.name : '',
      type: w.type,
      datapoint_id: w.datapoint_id ?? null,
      status_datapoint_id: w.status_datapoint_id ?? null,
      config: w.config ?? {},
    }
    for (const key of ['x', 'y', 'w', 'h']) {
      copy[key] = typeof w[key] === 'number' ? w[key] : BOX_DEFAULTS[key]
    }
    return copy
  })
  return next
}

const welt = vi.hoisted(() => ({ routeParams: {}, page: null, puts: 0 }))

vi.mock('vue-router', () => ({ useRoute: () => ({ params: welt.routeParams, meta: {} }) }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isLoggedIn: true, isAdmin: true, username: 'admin', loadMe: vi.fn() }),
}))
vi.mock('@/api/visu', () => {
  const getPage = vi.fn(async (id) => {
    if (id !== PAGE) throw new Error('404')
    return { data: JSON.parse(JSON.stringify(welt.page)) }
  })
  const getTree = vi.fn(async () => ({ data: TREE }))
  const getNode = vi.fn(async (id) => ({ data: TREE.find((n) => n.id === id) }))
  return {
    visuApi: {
      tree: getTree,
      getTree,
      page: getPage,
      getPage,
      node: getNode,
      getNode,
      savePage: vi.fn(async (id, config) => {
        welt.puts += 1
        welt.page = normalizeOnServer(config)
        return { status: 204 }
      }),
      usernames: vi.fn(async () => ({ data: [] })),
      nodeUsers: vi.fn(async () => ({ data: [] })),
      pageVersions: vi.fn(async () => ({ data: [] })),
      createNode: vi.fn(),
      updateNode: vi.fn(),
      deleteNode: vi.fn(),
      moveNode: vi.fn(),
    },
  }
})
vi.mock('@/api/client', () => ({
  default: {},
  dpApi: { value: vi.fn(async () => ({ data: { value: 21.5 } })) },
  searchApi: {
    search: vi.fn(async ({ q }) => ({ data: { items: !q || DP.name.includes(q) ? [DP] : [] } })),
  },
  systemApi: { datatypes: vi.fn(async () => ({ data: [{ name: 'FLOAT' }] })) },
}))
vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => ({
    connect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onValue: () => () => {},
  }),
}))

beforeEach(() => {
  welt.routeParams = { pageId: PAGE }
  welt.puts = 0
  welt.page = normalizeOnServer({
    grid_cols: 12,
    grid_row_height: 80,
    grid_cell_width: 80,
    background: null,
    widgets: [{ ...WIDGET }],
    includes: [],
    ignore_global_includes: true,
    popup: null,
  })
})

async function mountEditor() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const w = mount(VisuEditorView, {
    global: {
      plugins: [pinia],
      stubs: { VisuPreviewFrame: { name: 'VisuPreviewFrame', props: ['draft'], template: '<div />' } },
    },
    attachTo: document.body,
  })
  await flushPromises()
  await flushPromises()
  return w
}

const canvasEls = (w) => w.findAll('.editor-canvas [data-el]')
const bindungsformular = (w) => w.find('[data-testid="visu-binding-form"]')

/** „Speichern" der Canvas-Werkzeugleiste - nicht das der Seiteneigenschaften. */
function saveCanvas(w) {
  const canvas = w.find('[data-testid="visu-editor-canvas"]')
  return canvas.findAll('button').find((b) => b.text().includes('Speichern'))
}
const canvasQuittung = (w) => w.find('[data-testid="editor-canvas-saved"]')

async function speichern(w) {
  await saveCanvas(w).trigger('click')
  await flushPromises()
  await flushPromises()
}

/** Ein Element im Canvas anklicken, so wie es ein echter Zeiger tut. */
async function klickeImCanvas(w, index = 0) {
  canvasEls(w)[index].element.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }),
  )
  await flushPromises()
}

describe('E10 ohne Browser - der Autorenteil erreicht die Spalte', () => {
  it('oeffnet das Bindungsformular des Elements, das im Canvas angeklickt wurde', async () => {
    const w = await mountEditor()
    expect(bindungsformular(w).exists()).toBe(false)

    await klickeImCanvas(w)
    expect(bindungsformular(w).exists()).toBe(true)
    expect(bindungsformular(w).find('.binding-name').element.value).toBe('M5 Gamma Item')
  })

  it('speichert einen umbenannten Namen und liest ihn nach einem Neuladen zurueck', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.binding-name').setValue('M5 Gamma Umbenannt')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets[0].name).toBe('M5 Gamma Umbenannt')

    w.unmount()
    const zweiter = await mountEditor()
    expect(canvasEls(zweiter)[0].text()).toContain('M5 Gamma Umbenannt')
  })

  it('speichert die Datenpunkt-Bindung (E11)', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.binding-field[data-field="datapoint_id"] .dp-picker-open').trigger('click')
    await flushPromises()
    await bindungsformular(w)
      .find('.binding-field[data-field="datapoint_id"] .dp-picker-search')
      .setValue('dp-m5-solo')
    await flushPromises()
    await bindungsformular(w).find('.binding-field[data-field="datapoint_id"] .dp-picker-item').trigger('click')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets[0].datapoint_id).toBe('dp-1')
  })

  it('speichert die Sichtbarkeitsregel (E16)', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.visibility-toggle').trigger('click')
    await flushPromises()
    await bindungsformular(w).find('.visibility-datapoint').setValue('dp-m5-solo')
    await flushPromises()
    await bindungsformular(w).find('.visibility-op').setValue('gt')
    await bindungsformular(w).find('.visibility-threshold').setValue('30')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets[0].config.visible_when).toEqual({
      datapoint_id: 'dp-1',
      op: 'gt',
      value: 30,
    })
  })

  it('speichert ein Element, das gerade erst aus der Palette kam', async () => {
    const w = await mountEditor()
    await w.find('.widget-palette-item[data-type="sensor"]').trigger('click')
    await flushPromises()

    await speichern(w)

    expect(canvasQuittung(w).exists()).toBe(true)
    expect(welt.page.widgets.map((x) => x.type)).toEqual(['Toggle', 'ValueDisplay'])

    w.unmount()
    const zweiter = await mountEditor()
    expect(canvasEls(zweiter)).toHaveLength(2)
  })

  it('setzt fuer die ganze Bearbeitung GENAU EINEN Schreibweg ab (#187)', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.binding-name').setValue('M5 Gamma Umbenannt')
    await flushPromises()
    await w.find('.widget-palette-item[data-type="sensor"]').trigger('click')
    await flushPromises()

    // Bis hierher ist nichts hinausgegangen - der Entwurf ist kein Schreiber.
    expect(welt.puts).toBe(0)
    await speichern(w)
    expect(welt.puts).toBe(1)
  })

  it('nimmt dem Canvas seine Lage nicht weg, wenn der Autorenteil etwas aendert', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    // Der Canvas setzt die X-Koordinate ueber sein Zahlenfeld ...
    const xFeld = w.find('#editor-canvas-x')
    expect(xFeld.exists()).toBe(true)
    await xFeld.setValue('40')
    await flushPromises()
    // ... und das Bindungsformular benennt danach um.
    await bindungsformular(w).find('.binding-name').setValue('M5 Gamma Umbenannt')
    await flushPromises()

    await speichern(w)
    expect(welt.page.widgets[0]).toMatchObject({ name: 'M5 Gamma Umbenannt', x: 40 })
  })
})

/**
 * DIE DRITTE ANSICHT AUF DIESELBE SEITE (Nachzug M5 C3 Runde 2, #170/#173).
 *
 * Der Editor zeigt eine Seite dreifach: als Textdokument (E13), als Flaeche
 * (C2) und als Autorenliste mit Bindungsformular (C3). Alle drei beschreiben
 * EINEN Entwurf, und genau einer legt ihn ab.
 *
 * DER FUND, gegen den diese Proben stehen: der Nachzug zu C3 liess den
 * Autorenteil beim Speichern ueber die Liste des Canvas laufen
 * (`adoptAuthored()`), und weil der Autorenteil von einer Textaenderung nichts
 * wusste, drehte er sie vor dem `PUT` still zurueck. Der Server behielt den
 * alten Namen, und „Gespeichert" stand trotzdem da - derselbe falsche Erfolg,
 * gegen den dieser Nachzug angetreten war, nur eine Ansicht weiter. Gemessen im
 * Browser (Umbenennung im JSON-Text weg, Quittung da); hier ohne Browser.
 */
describe('E13 neben E10 - die Textansicht schreibt in denselben Entwurf', () => {
  /** In die Textansicht wechseln und ihr Dokument lesen. */
  async function textansicht(w) {
    await w.find('[data-testid="visu-editor-canvas"] [data-view="json"]').trigger('click')
    await flushPromises()
    return w.find('#editor-canvas-json')
  }

  /** Das Dokument der Textansicht ersetzen, so wie ein Tastendruck es tut. */
  async function tippe(w, config) {
    const feld = w.find('#editor-canvas-json')
    await feld.setValue(JSON.stringify(config, null, 2))
    await flushPromises()
  }

  it('speichert eine Umbenennung aus der Textansicht und liest sie zurueck', async () => {
    const w = await mountEditor()
    const feld = await textansicht(w)
    const gelesen = JSON.parse(feld.element.value)
    gelesen.widgets[0].name = 'K3 JSON Name'
    await tippe(w, gelesen)

    await speichern(w)

    expect(welt.page.widgets[0].name).toBe('K3 JSON Name')
    expect(canvasQuittung(w).exists()).toBe(true)
  })

  it('traegt eine Bindung aus der Textansicht in die Spalte', async () => {
    const w = await mountEditor()
    const feld = await textansicht(w)
    const gelesen = JSON.parse(feld.element.value)
    gelesen.widgets[0].datapoint_id = 'dp-1'
    gelesen.widgets[0].config = { invert: true }
    await tippe(w, gelesen)

    await speichern(w)

    expect(welt.page.widgets[0].datapoint_id).toBe('dp-1')
    expect(welt.page.widgets[0].config).toEqual({ invert: true })
    expect(canvasQuittung(w).exists()).toBe(true)
  })

  it('laesst ein in der Textansicht geloeschtes Element geloescht', async () => {
    const w = await mountEditor()
    const feld = await textansicht(w)
    const gelesen = JSON.parse(feld.element.value)
    gelesen.widgets = []
    await tippe(w, gelesen)

    await speichern(w)

    expect(welt.page.widgets).toEqual([])
    expect(canvasQuittung(w).exists()).toBe(true)
  })

  it('zieht die Elementliste des Autorenteils mit - drei Ansichten, ein Stand', async () => {
    const w = await mountEditor()
    const feld = await textansicht(w)
    const gelesen = JSON.parse(feld.element.value)
    gelesen.widgets[0].name = 'K3 JSON Name'
    await tippe(w, gelesen)

    expect(w.find('.editor-widget-item').text()).toBe('K3 JSON Name')

    // ... und das Bindungsformular des Elements zeigt denselben Namen.
    await klickeImCanvas(w)
    expect(bindungsformular(w).find('.binding-name').element.value).toBe('K3 JSON Name')
  })

  it('setzt auch fuer eine Textaenderung GENAU EINEN Schreibweg ab (#187)', async () => {
    const w = await mountEditor()
    const feld = await textansicht(w)
    const gelesen = JSON.parse(feld.element.value)
    gelesen.widgets[0].name = 'K3 JSON Name'
    await tippe(w, gelesen)

    expect(welt.puts).toBe(0)
    await speichern(w)
    expect(welt.puts).toBe(1)
  })
})

/**
 * DER DRITTE SCHREIBER MACHT DIE ARBEIT NICHT MEHR ZUNICHTE
 * (Micsi/openbridgeserver#187, Nachzug M5 C3 Runde 2).
 *
 * Gemessen war: Element umbenennen -> „Speichern" im Canvas -> der Server
 * traegt den neuen Namen -> danach „Speichern" der Seiteneigenschaften ->
 * Quittung -> der Server traegt wieder den alten Namen. Der Speicherplan der
 * Seiteneigenschaften baute seine Nutzlast auf der Konfiguration, die der Store
 * beim AUSWAEHLEN gelesen hatte; ein Canvas-Speichern dazwischen sah er nicht.
 *
 * Aufgeloest wird das mit einem `GET`, nicht mit einem weiteren Schreiber: nach
 * jedem Canvas-Speichern liest der Store die Seite frisch, und beide Wege
 * stehen wieder auf demselben Boden.
 */
describe('Zwei Speicherwege auf einer Seite (#187)', () => {
  /** „Speichern" der SEITENEIGENSCHAFTEN - nicht das des Canvas. */
  function savePageProps(w) {
    const kasten = w.find('.visu-page-properties')
    return kasten.findAll('button').find((b) => b.text().includes('Speichern'))
  }

  it('behaelt die gespeicherte Autorenarbeit, wenn danach die Seiteneigenschaften speichern', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    await bindungsformular(w).find('.binding-name').setValue('M5 Gamma Umbenannt')
    await flushPromises()
    await speichern(w)
    expect(welt.page.widgets[0].name).toBe('M5 Gamma Umbenannt')

    const knopf = savePageProps(w)
    expect(knopf).toBeTruthy()
    await knopf.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(welt.page.widgets[0].name).toBe('M5 Gamma Umbenannt')
  })
})

/**
 * ZWEI GLEICHE BESCHRIFTUNGEN, ZWEI BENANNTE BEREICHE (Nachzug C3 Runde 2).
 *
 * Auf der Editorseite stehen zwei Knoepfe „Speichern" und zwei Felder „Name" -
 * einmal fuer die SEITE (C1), einmal fuer das ELEMENT (C3/C2). Der
 * Playwright-Harness loest das seit dem letzten Nachzug ueber drei Helfer, die
 * ausdruecklich sagen, welche Haelfte sie meinen. Im PRODUKT war es nicht
 * geloest: beide Abschnitte trugen keinen zugaenglichen Namen, wer die Seite mit
 * einem Screenreader durchtabt hoerte zweimal dasselbe Wort ohne Unterschied.
 *
 * DIE GEMESSENE FALLE, gegen die die letzte Behauptung hier steht: `getByLabel`
 * sucht TEILSTRING-genau ueber `aria-label` und ueber das Ziel von
 * `aria-labelledby`. In Teil C6 machte ein Name mit dem Wort „Seitentyp" darin
 * `getByLabel('Seitentyp')` 21-fach und riss E9 und E15
 * (`VisuPageTreeNode.vue`). Ein Bereichsname darf deshalb KEINE der
 * Beschriftungen enthalten, die die Szenarien suchen.
 */
describe('Die beiden „Speichern" und die beiden „Name" sind unterscheidbar', () => {
  /**
   * Jede Beschriftung unter `wurzel` mit dem Element, das sie benennt -
   * dieselben drei Quellen, aus denen auch `getByLabel` liest.
   *
   * Gesucht wird AUSDRUECKLICH nur unter der frisch montierten Ansicht und nicht
   * im ganzen Dokument: die Proben dieser Datei haengen sich an `document.body`
   * und raeumen nicht ab, im Dokument stehen also mehrere Editoren
   * uebereinander. Eine Zaehlung darueber misst die Probe, nicht die Ansicht.
   */
  function beschriftungen(wurzel) {
    const nach = (id) => (id ? wurzel.querySelector(`[id="${id}"]`) : null)
    const treffer = []
    for (const el of wurzel.querySelectorAll('*')) {
      const ariaLabel = el.getAttribute('aria-label')
      if (ariaLabel) treffer.push({ el, text: ariaLabel })
      const quelle = nach(el.getAttribute('aria-labelledby'))
      if (quelle) treffer.push({ el, text: quelle.textContent.trim() })
      if (el.tagName === 'LABEL') {
        const ziel = nach(el.getAttribute('for'))
        if (ziel) treffer.push({ el: ziel, text: el.textContent.trim() })
      }
    }
    return treffer
  }

  /** Der Name des naechsten Vorfahren, der ein benannter Bereich ist. */
  function bereichUm(wurzel, el) {
    for (let k = el; k && k !== wurzel.parentElement; k = k.parentElement) {
      // `section` UND `form`: beide werden erst mit einem zugaenglichen Namen
      // zum Landmark, und je eine Haelfte jedes Paares steht in einem `form`.
      if (k.tagName !== 'SECTION' && k.tagName !== 'FORM') continue
      const beschriftet = wurzel.querySelector(`[id="${k.getAttribute('aria-labelledby')}"]`)
      const name = k.getAttribute('aria-label') || beschriftet?.textContent?.trim()
      if (name) return name
    }
    return null
  }

  /** Die Namen aller benannten Bereiche unter `wurzel`. */
  function bereichsnamen(wurzel) {
    return [...wurzel.querySelectorAll('section, form')]
      .map((k) => {
        const beschriftet = wurzel.querySelector(`[id="${k.getAttribute('aria-labelledby')}"]`)
        return k.getAttribute('aria-label') || beschriftet?.textContent?.trim() || null
      })
      .filter(Boolean)
  }

  it('traegt „Name" und „Speichern" weiterhin genau zweimal - und jedes in einem eigenen Bereich', async () => {
    const w = await mountEditor()
    await klickeImCanvas(w)
    expect(bindungsformular(w).exists()).toBe(true)
    const wurzel = w.element

    const namensfelder = beschriftungen(wurzel).filter((t) => t.text === 'Name')
    expect(namensfelder).toHaveLength(2)
    const speichern = [...wurzel.querySelectorAll('button')].filter(
      (b) => b.textContent.trim() === 'Speichern',
    )
    expect(speichern).toHaveLength(2)

    // Die Zahl bleibt zwei; NEU ist, dass jede Haelfte in einem benannten
    // Bereich steht und die beiden Namen verschieden sind.
    const namensbereiche = namensfelder.map((t) => bereichUm(wurzel, t.el))
    const speicherbereiche = speichern.map((b) => bereichUm(wurzel, b))
    for (const name of [...namensbereiche, ...speicherbereiche]) expect(name).toBeTruthy()
    expect(new Set(namensbereiche).size).toBe(2)
    expect(new Set(speicherbereiche).size).toBe(2)
  })

  it('legt mit den Bereichsnamen KEINE neue Mehrdeutigkeit fuer den Harness an', async () => {
    // Jede Beschriftung, die `apps/visu/e2e` ueber `getByLabel` sucht - ohne die
    // beiden, die dort ausdruecklich `exact: true` tragen („X", „Y").
    const gesucht = [
      'Ausgeblendet', 'Automatisch schließen (ms)', 'Bedingung', 'Benutzername',
      'Breakpoints', 'Breite', 'Datei', 'Datenpunkt', 'Datenpunkt suchen',
      'Enter PIN', 'Exklusiv öffnen', 'Gesperrt', 'Höhe', 'Layout-Modus', 'Name',
      'Nutzer hinzufügen', 'Password', 'Passwort', 'PIN', 'Rasterweite',
      'Schlagschatten', 'Schwelle', 'Seitentyp', 'Skin', 'Username',
      'Vom Elternknoten erben', 'Vorschau-Breite', 'Zielgruppe', 'Zugriff',
    ]
    const w = await mountEditor()
    await klickeImCanvas(w)

    const namen = bereichsnamen(w.element)
    expect(namen).toContain('Zeichenfläche der Seite')
    expect(namen).toContain('Bindung des Elements')
    expect(namen).toContain('Seiteneigenschaften')

    const kollisionen = []
    for (const name of namen) {
      for (const nadel of gesucht) {
        if (name.includes(nadel)) kollisionen.push(`${name} => getByLabel('${nadel}')`)
      }
    }
    expect(kollisionen).toEqual([])
  })
})
