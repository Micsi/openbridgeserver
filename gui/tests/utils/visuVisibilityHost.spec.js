import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as visibility from '@/utils/visuVisibility'
import { buildDraft } from '@/composables/useVisuEditorDraft'

/**
 * DER ZAUN UM DIE BEDINGTE SICHTBARKEIT (Messlatte **E16** und **E3**, #170).
 *
 * Die Behauptung, die hier haelt oder faellt: **Host und Editor zeigen dieselbe
 * Seite.** Die Regel steht als Daten am Widget (`config.visible_when`),
 * ausgewertet wird sie im HOST (`apps/visu/src/core/obs/mapping.ts`) - in
 * derselben Uebersetzung, aus der die ausgelieferte Visu ihre Geraete und Ebenen
 * bekommt. Der Editor filtert NICHTS.
 *
 * Warum das eine eigene Probe braucht: waere die Auswertung im Editor
 * geblieben, zeigte die Vorschau fuer geregelte Elemente etwas anderes als die
 * echte Visu - und **E3** („die Vorschau IST die Visu, 0 abweichende Pixel")
 * waere nicht bloss unerreicht, sondern aktiv unterlaufen. Genau diese
 * Abweichung misst die Probe: sie stellt beide Wege auf denselben Boden und
 * vergleicht, was am Ende auf der Seite steht.
 *
 * Gebunden wird an die ECHTE Quelle, nicht an eine Beschreibung: `mapping.ts`
 * und `compose.ts` werden als MODUL geladen (dieselbe Bauart wie
 * `visuWidgetTypesDerivation.spec.js`), nicht per Regex gelesen.
 */

const MAPPING_REL = join('apps', 'visu', 'src', 'core', 'obs', 'mapping.ts')
const COMPOSE_REL = join('apps', 'visu', 'src', 'core', 'obs', 'compose.ts')
const GUI_REL = join('gui', 'src', 'utils', 'visuVisibility.js')

/** Die Repo-Wurzel ist der Ordner, der beide Haelften traegt. */
function repoRoot() {
  let dir = resolve(process.cwd())
  for (;;) {
    if (
      existsSync(join(dir, MAPPING_REL)) &&
      existsSync(join(dir, COMPOSE_REL)) &&
      existsSync(join(dir, GUI_REL))
    ) {
      return dir
    }
    const up = dirname(dir)
    if (up === dir) throw new Error('Abbildung/Komposition der Visu nicht gefunden - Repo umgebaut?')
    dir = up
  }
}

/** Ein Export, der da sein MUSS - sonst ist der Host umbenannt, nicht gleich. */
function exported(module, name) {
  if (!(name in module)) {
    throw new Error(`Export ${name} fehlt im Host - umbenannt oder umgebaut?`)
  }
  return module[name]
}

/**
 * Die Host-Module, EINMAL je Datei geladen. Bewusst kein `vi.resetModules()`
 * und kein Import je Test: der Modulgraph ist teuer, und genau dieses Muster
 * hat unter Last schon 20-Sekunden-Zeitgrenzen gerissen.
 */
let host

beforeAll(async () => {
  const wurzel = repoRoot()
  const mapping = await import(/* @vite-ignore */ pathToFileURL(join(wurzel, MAPPING_REL)).href)
  const compose = await import(/* @vite-ignore */ pathToFileURL(join(wurzel, COMPOSE_REL)).href)
  host = {
    VISIBILITY_OPS: exported(mapping, 'VISIBILITY_OPS'),
    readVisibilityRule: exported(mapping, 'readVisibilityRule'),
    isWidgetVisible: exported(mapping, 'isWidgetVisible'),
    visibilityReads: exported(mapping, 'visibilityReads'),
    composeLayers: exported(compose, 'composeLayers'),
  }
})

const PAGE = 'node-solo'
const DP = 'dp-m5-solo'

function widget(id, extra = {}) {
  return {
    id,
    name: id,
    type: 'Toggle',
    datapoint_id: 'dp-w',
    status_datapoint_id: null,
    x: 0,
    y: 0,
    w: 3,
    h: 2,
    config: {},
    ...extra,
  }
}

/** Die Seite, wie der Server sie speichert - mit und ohne Regel. */
function serverNodes() {
  const geregelt = visibility.writeVisibilityRule(widget('w-regel'), {
    datapoint_id: DP,
    op: 'gt',
    value: '30',
  })
  return [
    {
      id: PAGE,
      parent_id: null,
      name: 'M5 Solo',
      type: 'PAGE',
      kind: 'normal',
      page_config: {
        widgets: [widget('w-frei'), geregelt],
        includes: [],
        ignore_global_includes: true,
        popup: null,
      },
    },
  ]
}

/** Welche Element-Ids stehen am Ende auf der Seite? */
function sichtbareIds(nodes, values) {
  return host
    .composeLayers(nodes, PAGE, new Map(Object.entries(values)))
    .flatMap((layer) => layer.items.map((item) => item.id))
}

describe('Bedingte Sichtbarkeit - die Auswertung gehoert dem Host', () => {
  it('bietet im Formular genau die Vergleiche an, die der Host kennt', () => {
    // Der Vergleich waere wertlos, wenn eine Seite leer waere.
    expect(visibility.VISIBILITY_OPS.length).toBe(8)
    expect([...visibility.VISIBILITY_OPS].sort()).toEqual([...host.VISIBILITY_OPS].sort())
  })

  it('schreibt die Regel in der Form, die der Host wieder einliest', () => {
    // Jede Zeile: was der Autor tippt -> was gespeichert wird -> was der Host
    // daraus macht. Die mittlere Spalte ist die Naht zwischen beiden Haelften.
    const faelle = [
      { datapoint_id: DP, op: 'gt', value: '30' },
      { datapoint_id: DP, op: 'eq', value: 30 },
      { datapoint_id: DP, op: 'eq', value: 'auf' },
      { datapoint_id: DP, op: 'truthy' },
      { datapoint_id: `  ${DP}  `, op: 'falsy' },
    ]
    for (const roh of faelle) {
      const gespeichert = visibility.writeVisibilityRule(widget('w'), roh)
      const imEditor = visibility.readVisibilityRule(gespeichert)
      const imHost = host.readVisibilityRule(gespeichert)
      expect([roh.op, imHost]).toEqual([roh.op, imEditor])
      expect(imHost, roh.op).not.toBeNull()
    }

    // Und die Gegenrichtung: was der Editor als HALBE Regel verwirft, haelt auch
    // der Host fuer keine - sonst verbaerge der Host etwas, was der Autor nie
    // beschlossen hat.
    for (const halb of [
      { op: 'gt', value: 30 },
      { datapoint_id: DP, op: 'gt' },
      { datapoint_id: DP, op: 'zwischen', value: 1 },
    ]) {
      const gespeichert = { ...widget('w'), config: { visible_when: halb } }
      expect([halb.op, visibility.readVisibilityRule(gespeichert)]).toEqual([halb.op, null])
      expect([halb.op, host.readVisibilityRule(gespeichert)]).toEqual([halb.op, null])
    }
  })

  it('wertet die Regel im Host aus - schon an der gespeicherten Seite', () => {
    const nodes = serverNodes()
    // Die ausgelieferte Visu bekommt die Seite so vom Server. Ohne jeden Editor
    // dazwischen entscheidet der Host, wer zu sehen ist.
    expect(sichtbareIds(nodes, { [DP]: 21.5 })).toEqual(['w-frei'])
    expect(sichtbareIds(nodes, { [DP]: 42 })).toEqual(['w-frei', 'w-regel'])
  })

  it('gibt dem Host JEDES Element weiter - der Editor filtert nicht', () => {
    const nodes = serverNodes()
    for (const values of [{}, { [DP]: 21.5 }, { [DP]: 42 }]) {
      const entwurf = buildDraft({ pageId: PAGE, nodes, skin: 'edomi' })
      const ids = entwurf.nodes
        .find((n) => n.id === PAGE)
        .page_config.widgets.map((w) => w.id)
      // Auch bei unerfuellter Regel (21.5 gegen „> 30") steht das Element im
      // Entwurf: entschieden wird drueben, nicht hier.
      expect([JSON.stringify(values), ids]).toEqual([JSON.stringify(values), ['w-frei', 'w-regel']])
      // Und die Regel reist als DATEN mit, nicht als Ergebnis.
      expect(host.readVisibilityRule(entwurf.nodes[0].page_config.widgets[1])).toEqual({
        datapoint_id: DP,
        op: 'gt',
        value: 30,
      })
    }
  })

  it('zeigt in der Vorschau exakt dieselbe Seite wie in der Visu (E3)', () => {
    const nodes = serverNodes()
    for (const wert of [undefined, 21.5, 30, 42, 'on']) {
      const values = wert === undefined ? {} : { [DP]: wert }
      const live = sichtbareIds(nodes, values)
      const vorschau = sichtbareIds(buildDraft({ pageId: PAGE, nodes, skin: 'edomi' }).nodes, values)
      expect([String(wert), vorschau]).toEqual([String(wert), live])
    }
    // Der Vergleich waere wertlos, wenn beide Seiten immer dasselbe zeigten:
    // die Regel muss ueberhaupt etwas bewegen.
    expect(sichtbareIds(nodes, { [DP]: 21.5 })).not.toEqual(sichtbareIds(nodes, { [DP]: 42 }))
  })

  it('haelt die Regel-Datenpunkte im Lesesatz, auch wenn das Element verborgen ist', () => {
    // Sonst waere die Regel eine Falle: verborgen -> kein Geraet -> niemand
    // liest den Datenpunkt -> nie wieder sichtbar.
    const nodes = serverNodes()
    expect(host.visibilityReads(nodes)).toEqual([{ pageId: PAGE, dp: DP }])
    expect(host.isWidgetVisible(nodes[0].page_config.widgets[1], new Map([[DP, 21.5]]))).toBe(false)
    expect(host.isWidgetVisible(nodes[0].page_config.widgets[1], new Map([[DP, 42]]))).toBe(true)
  })

  it('haelt im Editor keine zweite Auswertung vor', () => {
    // Ein zweiter Auswerter waere ein zweiter Renderer: er koennte abweichen,
    // ohne dass es jemandem auffiele. Die GUI schreibt und liest die Regel -
    // mehr nicht.
    expect(Object.keys(visibility).sort()).toEqual([
      'VISIBILITY_OPS',
      'normalizeRule',
      'readVisibilityRule',
      'visibilityDatapointIds',
      'writeVisibilityRule',
    ])
  })
})
