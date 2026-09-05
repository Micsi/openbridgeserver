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
 *  2. `apps/visu/src/core/obs/mapping.ts`, geladen als MODUL und mit einer
 *     mitschreibenden `config` BEFRAGT: welche Konfig-Schluessel die Abbildung
 *     fuer ein voll gebundenes Widget wirklich liest. Genau diese Schluessel
 *     muss das Formular schreiben — keinen mehr, keinen weniger.
 *  3. `frontend/src/widgets/` — die V1-Taxonomie. Ein Servertyp ist entweder
 *     einer von dort, oder er steht in {@link NEUE_SERVERTYPEN} und ist damit
 *     als NEU deklariert statt still erfunden.
 */

const MAPPING_REL = join('apps', 'visu', 'src', 'core', 'obs', 'mapping.ts')
const CONTRACT_REL = join('packages', 'contract', 'contract.schema.json')
const V1_WIDGETS_REL = join('frontend', 'src', 'widgets')
const GUI_REL = join('gui', 'src', 'utils', 'visuWidgetTypes.js')

/** Die Repo-Wurzel ist der Ordner, der alle vier Haelften traegt. */
function repoRoot() {
  let dir = resolve(process.cwd())
  for (;;) {
    if (
      existsSync(join(dir, MAPPING_REL)) &&
      existsSync(join(dir, CONTRACT_REL)) &&
      existsSync(join(dir, V1_WIDGETS_REL)) &&
      existsSync(join(dir, GUI_REL))
    ) {
      return dir
    }
    const up = dirname(dir)
    if (up === dir) throw new Error('Abbildung/Vertrag/V1-Palette nicht gefunden - Repo umgebaut?')
    dir = up
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
 * und eine `config`, die jeden Lesezugriff mitschreibt.
 *
 * Voll gebunden, weil die Abbildung Folge-Schluessel nur dann liest, wenn der
 * erste gesetzt ist (`dp_status_i` -> `label_status_i`). Eine Probe mit leerer
 * Konfig saehe die Haelfte der Formularfelder nie.
 */
function probe(type) {
  let widget = createWidget(type, { id: `probe-${type}`, name: `Probe ${type}` })
  for (const field of widgetFormFields(type)) {
    if (field.kind === 'datapoint') widget = writeField(widget, field, `dp-${field.key}`)
  }
  const gelesen = new Set()
  const config = new Proxy(widget.config, {
    get(target, key) {
      if (typeof key === 'string') gelesen.add(key)
      return target[key]
    },
  })
  return { widget: { ...widget, config }, gelesen }
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
      // Erlaubt ist, was der Vertrag fuer DIESEN Typ kennt: seine Datenfelder,
      // seine Aktionen und die Eigenschaften seines Schemas. Letztere tragen
      // `type` - und genau darauf zielt die Bauart-Auswahl von Rollladen und
      // Jalousie, die zwischen zwei Vertragstypen entscheidet.
      const ziele = new Set([
        ...Object.keys(spec.data ?? {}),
        ...Object.keys(spec.actions ?? {}),
        ...Object.keys(spec.dataSchema?.properties ?? {}),
      ])
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

    // Was JEDER Typ liest, ist nicht typ-eigen (Etikett + Link-Kachel) und
    // gehoert deshalb nicht ins Bindungsformular. Abgeleitet statt behauptet:
    // die Schnittmenge ueber alle abgebildeten Typen.
    const gelesenJeTyp = new Map()
    for (const type of CORE_WIDGET_TYPES) {
      if (!WIDGET_FORMS[type].previewMapped) continue
      const p = probe(type)
      expect(mapWidget(p.widget, 'Raum'), type).not.toBeNull()
      gelesenJeTyp.set(type, p.gelesen)
    }
    const alle = [...gelesenJeTyp.values()]
    const generisch = [...alle[0]].filter((key) => alle.every((set) => set.has(key)))
    // Etikett und Link-Ziel liest die Abbildung an JEDEM Typ; `active_indicator`
    // liest sie nur, wenn ein Link-Ziel gesetzt ist, und Link-Kacheln gehoeren
    // nicht ins Bindungsformular (C1/C2).
    expect([...generisch].sort()).toEqual(['label', 'target_node_id'])

    for (const [type, gelesen] of gelesenJeTyp) {
      const typEigen = [...gelesen].filter((key) => !generisch.includes(key)).sort()
      const deklariert = widgetFormFields(type)
        .filter((f) => f.path.startsWith('config.'))
        .map((f) => f.path.slice('config.'.length))
        .sort()
      expect([type, deklariert]).toEqual([type, typEigen])
    }
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
