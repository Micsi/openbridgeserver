import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CORE_WIDGET_TYPES,
  NEUE_SERVERTYPEN,
  WIDGET_FORMS,
  createWidget,
  widgetFormFields,
  writeField,
} from '@/utils/visuWidgetTypes'

/**
 * DER ZAUN UM DIE WIDGET-FORMULARE (M5 C3, Issue #170).
 *
 * Auftrag: „Die Formulare je Typ werden aus der bestehenden Abbildung
 * abgeleitet, nicht von Hand dupliziert." Die GUI liegt nicht im
 * pnpm-Workspace der Visu und kann `mapping.ts` nicht importieren; die
 * Beschreibung in `visuWidgetTypes.js` ist also eine Kopie — und eine Kopie ist
 * nur so viel wert wie die Probe, die sie an ihre Quelle bindet. Dieselbe
 * Bauart wie `visuPreviewProtocolMirror.spec.js` (C4).
 *
 * Gebunden wird an DREI echte Quellen, keine davon per Regex ueber fremden Code:
 *
 *  1. `packages/contract/contract.schema.json` — die neun Kern-Typen sind die
 *     nicht-reservierten Widget-Schluessel des Vertrags, und jedes Formularfeld
 *     zielt auf ein `data`- oder `actions`-Feld GENAU DIESES Typs.
 *  2. `apps/visu/src/core/obs/mapping.ts`, geladen als MODUL und mit einem
 *     mitschreibenden WIDGET befragt: welche Schluessel die Abbildung fuer ein
 *     voll gebundenes Widget wirklich liest - in der `config` UND an der
 *     Wurzel (`datapoint_id`, `status_datapoint_id`). Genau diese Schluessel
 *     muss das Formular schreiben, keinen mehr, keinen weniger. Beide Ebenen,
 *     weil das Formular auf beide schreibt: eine Falle nur um `config` liesse
 *     ein erfundenes Wurzelfeld unbemerkt durch.
 *  3. `frontend/src/widgets/` — die V1-Taxonomie. Ein Servertyp ist entweder
 *     einer von dort, oder er steht in {@link NEUE_SERVERTYPEN} und ist damit
 *     als NEU deklariert statt still erfunden.
 */

const MAPPING_REL = join('apps', 'visu', 'src', 'core', 'obs', 'mapping.ts')
const CONTRACT_REL = join('packages', 'contract', 'contract.schema.json')
const V1_WIDGETS_REL = join('frontend', 'src', 'widgets')
const GUI_REL = join('gui', 'src', 'utils', 'visuWidgetTypes.js')
const MODEL_REL = join('obs', 'models', 'visu.py')

/** Die Repo-Wurzel ist der Ordner, der alle fuenf Haelften traegt. */
function repoRoot() {
  let dir = resolve(process.cwd())
  for (;;) {
    if (
      existsSync(join(dir, MAPPING_REL)) &&
      existsSync(join(dir, CONTRACT_REL)) &&
      existsSync(join(dir, V1_WIDGETS_REL)) &&
      existsSync(join(dir, GUI_REL)) &&
      existsSync(join(dir, MODEL_REL))
    ) {
      return dir
    }
    const up = dirname(dir)
    if (up === dir) {
      throw new Error('Abbildung/Vertrag/V1-Palette/Backend-Modell nicht gefunden - Repo umgebaut?')
    }
    dir = up
  }
}

/**
 * Die WURZELFELDER eines gespeicherten Widgets - aus dem Backend-Modell
 * (`obs/models/visu.py`, `class WidgetInstance`). Gelesen wird eine
 * Feld-DEKLARATION, kein Verhalten: die Namen links vom Doppelpunkt. Ein
 * Formularfeld, das an die Wurzel schreibt, muss eines davon treffen - alles
 * andere waere ein Schluessel, den der Server beim Speichern gar nicht kennt.
 */
function widgetInstanceFields() {
  const src = readFileSync(join(repoRoot(), MODEL_REL), 'utf8')
  const block = src.match(/class WidgetInstance\(BaseModel\):\n([\s\S]*?)\n\n/)
  if (!block) throw new Error('class WidgetInstance nicht gefunden - Backend-Modell umgebaut?')
  return [...block[1].matchAll(/^ {4}(\w+):/gm)].map((m) => m[1])
}

/**
 * Was die V1-Palette fuer diesen Servertyp ueber seine WURZEL-Datenpunkte
 * deklariert (`frontend/src/widgets/<Typ>/index.ts`, der `WidgetRegistry.register`-
 * Eintrag): `noDatapoint` = das Widget hat gar keinen Wurzel-Datenpunkt,
 * `supportsStatusDatapoint` = es hat zusaetzlich einen Rueckmelde-Datenpunkt.
 * `null` fuer einen Typ, den V1 nicht kennt (s. {@link NEUE_SERVERTYPEN}).
 *
 * Zwei Flaggen einer Deklarationstabelle, kein Codeverhalten - deshalb genuegt
 * hier das Lesen der Datei; die drei Quellen oben bleiben Modul und JSON.
 */
function v1DatapointFlags(serverType) {
  const datei = join(repoRoot(), V1_WIDGETS_REL, serverType, 'index.ts')
  if (!existsSync(datei)) return null
  const src = readFileSync(datei, 'utf8')
  return {
    noDatapoint: /\bnoDatapoint:\s*true\b/.test(src),
    supportsStatusDatapoint: /\bsupportsStatusDatapoint:\s*true\b/.test(src),
  }
}

/** Die Abbildung der Visu, geladen wie ein Modul - nicht gelesen wie ein Text. */
async function loadMapping() {
  return await import(/* @vite-ignore */ pathToFileURL(join(repoRoot(), MAPPING_REL)).href)
}

/** Ein Export, der da sein MUSS - sonst ist die Abbildung umbenannt, nicht gleich. */
function exported(module, name) {
  if (!(name in module)) {
    throw new Error(`Export ${name} fehlt in der Abbildung der Visu - umbenannt oder umgebaut?`)
  }
  return module[name]
}

/** Der maschinenlesbare Vertrag (JSON, also ohne Uebersetzungsschritt). */
function contractSchema() {
  return JSON.parse(readFileSync(join(repoRoot(), CONTRACT_REL), 'utf8'))
}

/** Die Typ-Schluessel der V1-Palette: ein Ordner je Widget-Typ. */
function v1WidgetTypes() {
  return readdirSync(join(repoRoot(), V1_WIDGETS_REL), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

/**
 * Ein Widget des Typs, in dem JEDE deklarierte Datenpunkt-Bindung gesetzt ist -
 * und das jeden Lesezugriff mitschreibt, an der Konfig UND an der Wurzel.
 *
 * Voll gebunden, weil die Abbildung Folge-Schluessel nur dann liest, wenn der
 * erste gesetzt ist (`dp_status_i` -> `label_status_i`). Eine Probe mit leerer
 * Konfig saehe die Haelfte der Formularfelder nie.
 *
 * BEIDE Ebenen, nicht nur `config`: das Formular schreibt auch an die WURZEL
 * (`datapoint_id`, `status_datapoint_id`), und die Abbildung liest sie dort
 * typ-abhaengig (`mapSwitch` ja, `mapLight` nein). Eine Falle nur um `config`
 * liesse ein erfundenes Wurzelfeld - ein `status_datapoint_id` am Licht etwa -
 * unbemerkt durch: deklariert, aber nirgends gelesen.
 */
function probe(type) {
  let widget = createWidget(type, { id: `probe-${type}`, name: `Probe ${type}` })
  for (const field of widgetFormFields(type)) {
    if (field.kind === 'datapoint') widget = writeField(widget, field, `dp-${field.key}`)
  }
  const gelesen = new Set()
  const wurzel = new Set()
  const config = new Proxy(widget.config, {
    get(target, key) {
      if (typeof key === 'string') gelesen.add(key)
      return target[key]
    },
  })
  const beobachtet = new Proxy(
    { ...widget, config },
    {
      get(target, key) {
        if (typeof key === 'string') wurzel.add(key)
        return target[key]
      },
    },
  )
  return { widget: beobachtet, gelesen, wurzel }
}

describe('Widget-Formulare — die neun Typen kommen aus dem Vertrag', () => {
  it('nennt genau die nicht-reservierten Widget-Typen des Vertrags', () => {
    const widgets = contractSchema().widgets
    const kern = Object.entries(widgets)
      .filter(([, spec]) => spec.reserved !== true)
      .map(([name]) => name)

    // Der Vergleich waere wertlos, wenn beide Seiten leer waeren.
    expect(kern.length).toBe(9)
    expect([...CORE_WIDGET_TYPES].sort()).toEqual([...kern].sort())
  })

  it('zielt mit jedem Feld auf ein Datenfeld oder eine Aktion GENAU DIESES Typs', () => {
    const widgets = contractSchema().widgets
    for (const type of CORE_WIDGET_TYPES) {
      const spec = widgets[type]
      // Erlaubt ist, was der Vertrag fuer DIESEN Typ kennt: seine Datenfelder
      // und seine Aktionen. Dazu genau EINE Ausnahme, ausdruecklich benannt:
      // `type`, der Diskriminator zwischen den Vertragstypen - darauf zielt die
      // Bauart-Auswahl von Rollladen und Jalousie. Das ganze
      // `dataSchema.properties` zuzulassen waere zu viel: es traegt `id`,
      // `floor`, `writable` und `presets` mit, die keine Bindungsziele sind.
      const ziele = new Set([...Object.keys(spec.data ?? {}), ...Object.keys(spec.actions ?? {})])
      if (spec.dataSchema?.properties?.type) ziele.add('type')
      // Praesentation gehoert dem Host/Skin, nicht dem Bindungsformular.
      for (const praesentation of ['room', 'label', 'accent']) ziele.delete(praesentation)
      for (const field of widgetFormFields(type)) {
        expect([type, field.key, field.target], `${type}.${field.key}`).toEqual([
          type,
          field.key,
          field.target,
        ])
        expect(ziele.has(field.target), `${type}.${field.key} -> ${field.target}`).toBe(true)
      }
    }
  })
})

describe('Widget-Formulare — die Konfig-Schluessel kommen aus der Abbildung', () => {
  it('ordnet jedem Kern-Typ den Servertyp zu, den die Abbildung zurueckuebersetzt', async () => {
    const mapping = await loadMapping()
    const obsKind = exported(mapping, 'obsKind')

    for (const type of CORE_WIDGET_TYPES) {
      const widget = createWidget(type, { id: `k-${type}` })
      const kind = obsKind(widget)
      if (WIDGET_FORMS[type].previewMapped) {
        // Die Abbildung erkennt genau den Typ wieder, den die Palette gesetzt hat.
        expect([type, kind]).toEqual([type, type])
      } else {
        // Und sie erkennt die anderen fuenf NICHT - deshalb sagt die Palette das
        // auch (issue #124: media/camera/... sind noch nicht abgebildet).
        expect([type, kind]).toEqual([type, null])
      }
    }
    // Beide Seiten der Bedingung sind besetzt, sonst pruefte der Lauf nur eine.
    const abgebildet = CORE_WIDGET_TYPES.filter((t) => WIDGET_FORMS[t].previewMapped)
    expect(abgebildet).toEqual(['light', 'switch', 'blind', 'jalousie'])
  })

  it('schreibt fuer einen abgebildeten Typ genau die Schluessel, die die Abbildung liest', async () => {
    const mapping = await loadMapping()
    const mapWidget = exported(mapping, 'mapWidget')

    // Was JEDER Typ liest, ist nicht typ-eigen (Etikett + Link-Kachel + die
    // Sichtbarkeitsregel) und gehoert deshalb nicht ins Bindungsformular.
    // Abgeleitet statt behauptet: die Schnittmenge ueber alle abgebildeten Typen.
    const gelesenJeTyp = new Map()
    const wurzelJeTyp = new Map()
    for (const type of CORE_WIDGET_TYPES) {
      if (!WIDGET_FORMS[type].previewMapped) continue
      const p = probe(type)
      expect(mapWidget(p.widget, 'Raum'), type).not.toBeNull()
      gelesenJeTyp.set(type, p.gelesen)
      wurzelJeTyp.set(type, p.wurzel)
    }
    const schnittmenge = (jeTyp) => {
      const alle = [...jeTyp.values()]
      return [...alle[0]].filter((key) => alle.every((set) => set.has(key)))
    }

    const generisch = schnittmenge(gelesenJeTyp)
    // Etikett und Link-Ziel liest die Abbildung an JEDEM Typ; `active_indicator`
    // liest sie nur, wenn ein Link-Ziel gesetzt ist, und Link-Kacheln gehoeren
    // nicht ins Bindungsformular (C1/C2). `visible_when` liest sie ebenfalls an
    // jedem Typ - die Sichtbarkeitsregel (E16) steht im Formular in ihrem
    // eigenen Abschnitt, nicht als Bindungsfeld.
    expect([...generisch].sort()).toEqual(['label', 'target_node_id', 'visible_when'])

    const wurzelGenerisch = schnittmenge(wurzelJeTyp)
    // An der Wurzel liest die Abbildung fuer jeden Typ dasselbe: die Identitaet,
    // den Servertyp, den Namen (Etikett), die Konfig und den Autorenkasten.
    expect([...wurzelGenerisch].sort()).toEqual(['config', 'h', 'id', 'name', 'type', 'w', 'x', 'y'])

    for (const [type, gelesen] of gelesenJeTyp) {
      const typEigen = [...gelesen].filter((key) => !generisch.includes(key)).sort()
      const deklariert = widgetFormFields(type)
        .filter((f) => f.path.startsWith('config.'))
        .map((f) => f.path.slice('config.'.length))
        .sort()
      expect([type, deklariert]).toEqual([type, typEigen])

      // Und dieselbe Gleichung an der WURZEL: was das Formular dorthin schreibt,
      // muss die Abbildung fuer DIESEN Typ auch dort lesen. Ohne diese Haelfte
      // bliebe ein erfundenes Wurzelfeld unbemerkt.
      const wurzelEigen = [...wurzelJeTyp.get(type)]
        .filter((key) => !wurzelGenerisch.includes(key))
        .sort()
      const wurzelDeklariert = widgetFormFields(type)
        .filter((f) => !f.path.startsWith('config.'))
        .map((f) => f.path)
        .sort()
      expect([type, wurzelDeklariert]).toEqual([type, wurzelEigen])
    }

    // Beide Seiten der Wurzel-Gleichung sind besetzt: `switch` bindet dort, die
    // anderen drei nicht - sonst pruefte der Lauf nur den leeren Fall.
    expect(
      [...wurzelJeTyp.get('switch')].filter((key) => !wurzelGenerisch.includes(key)).sort(),
    ).toEqual(['datapoint_id', 'status_datapoint_id'])
    expect([...wurzelJeTyp.get('light')].filter((key) => !wurzelGenerisch.includes(key))).toEqual([])
  })

  it('bindet den Namen so, dass die Abbildung ihn als Geraete-Etikett zeigt (E10)', async () => {
    const mapping = await loadMapping()
    const mapWidget = exported(mapping, 'mapWidget')

    // E10 benennt ein Element auf der Include-Seite um und erwartet den neuen
    // Namen in der Vorschau. Das traegt nur, wenn das Formular den Namen an das
    // Feld schreibt, aus dem die Abbildung ihr Etikett zieht.
    const widget = { ...createWidget('switch', { id: 'w', name: 'M5 Gamma Item' }), datapoint_id: 'dp' }
    expect(mapWidget(widget, 'Raum').device.label).toBe('M5 Gamma Item')
    expect(mapWidget({ ...widget, name: 'M5 Gamma Umbenannt' }, 'Raum').device.label).toBe(
      'M5 Gamma Umbenannt',
    )
  })

  it('liest fuer einen nicht abgebildeten Typ ueberhaupt keinen Konfig-Schluessel', async () => {
    const mapping = await loadMapping()
    const mapWidget = exported(mapping, 'mapWidget')

    for (const type of CORE_WIDGET_TYPES) {
      if (WIDGET_FORMS[type].previewMapped) continue
      const p = probe(type)
      // Kein Geraet, also auch kein gelesener Schluessel: die Palette darf fuer
      // diese fuenf keine Abbildung behaupten, die es nicht gibt.
      expect([type, mapWidget(p.widget, 'Raum')]).toEqual([type, null])
      expect([type, [...p.gelesen]]).toEqual([type, []])
      // Auch an der Wurzel bleibt es bei der einen Frage „welcher Servertyp?" -
      // die Abbildung faellt vor jeder Bindung aus.
      expect([type, [...p.wurzel]]).toEqual([type, ['type']])
      expect([type, WIDGET_FORMS[type].previewMapped]).toEqual([type, false])
    }
  })
})

describe('Widget-Formulare — die Servertypen kommen aus der V1-Taxonomie', () => {
  it('benutzt einen V1-Typ oder deklariert den Typ als neu', () => {
    const v1 = new Set(v1WidgetTypes())
    // Der Vergleich waere wertlos, wenn das Verzeichnis leer gelesen wuerde.
    expect(v1.size).toBeGreaterThan(10)

    for (const type of CORE_WIDGET_TYPES) {
      const serverType = WIDGET_FORMS[type].serverType
      const bekannt = v1.has(serverType)
      const neu = NEUE_SERVERTYPEN.includes(serverType)
      expect([type, serverType, bekannt || neu]).toEqual([type, serverType, true])
      // Genau eines von beidem: ein „neuer" Typ, den V1 laengst kennt, waere ein
      // stiller zweiter Name fuer dieselbe Sache.
      expect([type, bekannt && neu]).toEqual([type, false])
    }
  })

  it('erklaert genau die Typen fuer neu, die V1 wirklich nicht kennt', () => {
    const v1 = new Set(v1WidgetTypes())
    for (const serverType of NEUE_SERVERTYPEN) {
      expect([serverType, v1.has(serverType)]).toEqual([serverType, false])
    }
    // Und keiner steht dort ungenutzt herum.
    const benutzt = new Set(CORE_WIDGET_TYPES.map((t) => WIDGET_FORMS[t].serverType))
    for (const serverType of NEUE_SERVERTYPEN) {
      expect([serverType, benutzt.has(serverType)]).toEqual([serverType, true])
    }
  })
})

/**
 * DIE WURZELFELDER - AUCH DER FUENF NICHT ABGEBILDETEN TYPEN.
 *
 * Die Gleichung „deklariert == gelesen" oben laeuft ueber die Abbildung der Visu
 * und deckt deshalb nur die vier Typen ab, die sie heute uebersetzt. Fuer die
 * anderen fuenf (issue #124) liest die Abbildung gar nichts - ein erfundenes
 * WURZELFELD an einem `sensor` blieb dort unbemerkt.
 *
 * Diese Proben schliessen die Luecke ueber zwei Quellen, die fuer ALLE Typen
 * gelten:
 *
 *  - das Backend-MODELL (`obs/models/visu.py`): welche Wurzelfelder ein
 *    gespeichertes Widget ueberhaupt hat. Ein Formularfeld auf einen anderen
 *    Wurzelschluessel schreibt an eine Stelle, die der Server nicht kennt.
 *  - die V1-PALETTE (`frontend/src/widgets/<Typ>/index.ts`): ob dieser Servertyp
 *    einen Wurzel-Datenpunkt hat (`noDatapoint`) und ob er zusaetzlich einen
 *    Rueckmelde-Datenpunkt kennt (`supportsStatusDatapoint`). Das ist dieselbe
 *    Taxonomie, aus der die Palette schon ihren `serverType` bezieht.
 *
 * WAS SIE NICHT SCHLIESSEN, ausdruecklich: `scene` und `media` tragen einen
 * Servertyp, den V1 NICHT kennt ({@link NEUE_SERVERTYPEN}) und den die Visu
 * nicht abbildet. Fuer diese beiden gibt es im ganzen Repo keine zweite Stelle,
 * die ihre Wurzel-Datenpunkte deklariert - dort haelt nur noch das Modell (kein
 * erfundener Schluessel), nicht die Zuordnung. Das ist der Rest, und er ist auf
 * zwei Typen und zwei Modellfelder eingegrenzt.
 */
describe('Widget-Formulare — die Wurzelfelder kommen aus Modell und V1-Palette', () => {
  it('schreibt an die Wurzel nur Felder, die das gespeicherte Widget wirklich hat', () => {
    const felder = new Set(widgetInstanceFields())
    // Der Vergleich waere wertlos, wenn das Modell leer gelesen wuerde.
    expect(felder.has('datapoint_id') && felder.has('config') && felder.has('type')).toBe(true)

    for (const type of CORE_WIDGET_TYPES) {
      for (const field of widgetFormFields(type)) {
        if (field.path.startsWith('config.')) continue
        expect([type, field.path, felder.has(field.path)]).toEqual([type, field.path, true])
      }
    }
  })

  it('bindet die beiden Wurzel-Datenpunkte an die Deklaration der V1-Palette', () => {
    let mitDp = 0
    let ohneDp = 0
    let mitStatus = 0
    let ohneStatus = 0

    for (const type of CORE_WIDGET_TYPES) {
      const serverType = WIDGET_FORMS[type].serverType
      const flags = v1DatapointFlags(serverType)
      if (!flags) {
        // Kein V1-Widget - dann MUSS der Typ als neu deklariert sein, sonst
        // faende die Probe hier still gar nichts mehr vor.
        expect([type, serverType, NEUE_SERVERTYPEN.includes(serverType)]).toEqual([
          type,
          serverType,
          true,
        ])
        continue
      }
      const wurzel = widgetFormFields(type)
        .filter((f) => !f.path.startsWith('config.'))
        .map((f) => f.path)

      // Ein Widget ohne Wurzel-Datenpunkt darf im Formular auch keinen haben -
      // genau der Fall, an dem die Sonde aus Runde 1 haengt (`status_datapoint_id`
      // am Licht), und derselbe Satz gilt jetzt auch fuer Kamera und Sensor.
      expect([type, 'datapoint_id', wurzel.includes('datapoint_id')]).toEqual([
        type,
        'datapoint_id',
        !flags.noDatapoint,
      ])
      expect([type, 'status_datapoint_id', wurzel.includes('status_datapoint_id')]).toEqual([
        type,
        'status_datapoint_id',
        flags.supportsStatusDatapoint,
      ])

      if (flags.noDatapoint) ohneDp += 1
      else mitDp += 1
      if (flags.supportsStatusDatapoint) mitStatus += 1
      else ohneStatus += 1
    }

    // Alle vier Faelle sind besetzt, sonst pruefte der Lauf nur einen davon.
    expect([mitDp > 0, ohneDp > 0, mitStatus > 0, ohneStatus > 0]).toEqual([true, true, true, true])
  })
})
