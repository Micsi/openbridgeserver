import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { writeVisibilityRule } from '@/utils/visuVisibility'

/**
 * DIE NAHT ZUM BACKEND: DARF EIN GAST DEN REGEL-DATENPUNKT ÜBERHAUPT LESEN?
 * (Messlatte **E16**, #170.)
 *
 * Die bedingte Sichtbarkeit haengt an einem Datenpunkt, den das geregelte
 * Element NICHT selbst bindet. Damit ein Gast (kein Login, nur `X-Page-Id`)
 * seinen Wert bekommt, muss der Server ihn als „Datenpunkt DIESER Seite"
 * anerkennen. Das entscheidet
 * `obs/api/v1/datapoints.py::_page_has_datapoint`, und zwar ueber
 * `collect_datapoint_ids_from_config(widget.config, ...)` -
 * `obs/api/v1/datapoint_config.py`.
 *
 * Dieser Sammler steigt rekursiv ab und erkennt einen Datenpunkt an seinem
 * SCHLUESSELNAMEN. Die bedingte Sichtbarkeit kommt heute nur deshalb durch, weil
 * das Regel-Objekt seinen Schluessel exakt `datapoint_id` nennt. Hiesse er `dp`
 * oder `datapointRef`, bekaeme jeder Gast fuer den Regel-Datenpunkt ein 403, der
 * Wert bliebe unbekannt - und das geregelte Element waere fuer Gaeste DAUERHAFT
 * verborgen, waehrend jedes Gate dieser Welle gruen bliebe, weil keines von
 * ihnen das Backend anfasst.
 *
 * Diese Probe befestigt genau das: sie leitet die Erkennungsregel des Servers
 * aus SEINER Datei ab (die Schluesseltabelle, die Praefixe, die Endungen), baut
 * die Regel mit dem ECHTEN Schreiber des Editors und mit dem ECHTEN Leser des
 * Hosts, und prueft, dass beide auf einen Schluessel zeigen, den der Sammler
 * findet.
 */

const COLLECTOR_REL = join('obs', 'api', 'v1', 'datapoint_config.py')
const MAPPING_REL = join('apps', 'visu', 'src', 'core', 'obs', 'mapping.ts')
const GUI_REL = join('gui', 'src', 'utils', 'visuVisibility.js')

/** Die Repo-Wurzel ist der Ordner, der alle drei Haelften traegt. */
function repoRoot() {
  let dir = resolve(process.cwd())
  for (;;) {
    if (
      existsSync(join(dir, COLLECTOR_REL)) &&
      existsSync(join(dir, MAPPING_REL)) &&
      existsSync(join(dir, GUI_REL))
    ) {
      return dir
    }
    const up = dirname(dir)
    if (up === dir) throw new Error('Sammler/Abbildung/Editor nicht gefunden - Repo umgebaut?')
    dir = up
  }
}

/** Ein Ausschnitt, der da sein MUSS - fehlt er, ist der Sammler umgebaut. */
function treffer(text, re, was) {
  const m = text.match(re)
  if (!m) throw new Error(`${was} nicht gefunden - obs/api/v1/datapoint_config.py umgebaut?`)
  return m
}

/**
 * Die Erkennungsregel des Servers, aus seiner eigenen Datei abgeleitet:
 * die exakte Schluesseltabelle, die Praefixe (`startswith`) und die Endungen
 * (`endswith`) aus `_is_datapoint_config_key`.
 *
 * Die vierte Regel des Servers (`key == 'id'` unterhalb von `extra_datapoints`/
 * `entities`) bleibt hier bewusst aussen vor: sie greift nur fuer Elemente einer
 * LISTE, und eine Sichtbarkeitsregel ist keine. Sie wegzulassen macht diese
 * Probe strenger, nicht schwaecher.
 */
function serverKeyRule() {
  const src = readFileSync(join(repoRoot(), COLLECTOR_REL), 'utf8')
  const exakt = new Set(
    [
      ...treffer(src, /_DATAPOINT_KEYS_EXACT = \{([\s\S]*?)\n\}/, 'die Schluesseltabelle')[1].matchAll(
        /"([\w]+)"/g,
      ),
    ].map((m) => m[1]),
  )
  const praefixe = [
    ...treffer(src, /key\.startswith\(([^)]*)\)/, 'die Praefix-Regel')[1].matchAll(/"([^"]+)"/g),
  ].map((m) => m[1])
  const endungen = [
    ...treffer(src, /key\.endswith\(([^)]*)\)/, 'die Endungs-Regel')[1].matchAll(/"([^"]+)"/g),
  ].map((m) => m[1])

  // Der Vergleich waere wertlos, wenn eine der drei Listen leer gelesen wuerde.
  if (exakt.size === 0 || praefixe.length === 0 || endungen.length === 0) {
    throw new Error('die Erkennungsregel des Servers wurde leer gelesen')
  }
  return {
    exakt,
    praefixe,
    endungen,
    erkennt: (key) =>
      exakt.has(key) ||
      praefixe.some((p) => key.startsWith(p)) ||
      endungen.some((e) => key.endsWith(e)),
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Der Sammler des Servers, Zeile fuer Zeile nachgebaut - aber mit SEINER
 * Erkennungsregel, nicht mit einer zweiten Kopie davon. Nur ein UUID-Wert zaehlt
 * (`is_uuid_str`), genau wie dort.
 */
function collectDatapointIds(value, rule, out = new Set()) {
  if (Array.isArray(value)) {
    for (const nested of value) collectDatapointIds(nested, rule, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string' && rule.erkennt(key) && UUID_RE.test(nested)) out.add(nested)
      collectDatapointIds(nested, rule, out)
    }
  }
  return out
}

const DP = '8cf2a421-4a1e-4d1a-9c5e-0f2b3c4d5e6f'

let host
let rule

beforeAll(async () => {
  const mapping = await import(
    /* @vite-ignore */ pathToFileURL(join(repoRoot(), MAPPING_REL)).href
  )
  if (!('readVisibilityRule' in mapping)) {
    throw new Error('Export readVisibilityRule fehlt im Host - umbenannt oder umgebaut?')
  }
  host = { readVisibilityRule: mapping.readVisibilityRule }
  rule = serverKeyRule()
})

/** Ein Widget mit Regel, geschrieben vom ECHTEN Schreiber des Editors. */
function geregeltesWidget() {
  return writeVisibilityRule(
    {
      id: 'w-regel',
      name: 'Geregelt',
      type: 'Toggle',
      datapoint_id: null,
      status_datapoint_id: null,
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      config: {},
    },
    { datapoint_id: DP, op: 'gt', value: 30 },
  )
}

describe('Bedingte Sichtbarkeit — der Gast darf den Regel-Datenpunkt lesen', () => {
  it('legt die Regel unter einem Schluessel ab, den der Server als Datenpunkt erkennt', () => {
    const widget = geregeltesWidget()

    // 1) Der HOST liest die Regel wirklich an dieser Stelle.
    expect(host.readVisibilityRule(widget)?.datapoint_id).toBe(DP)

    // 2) Und der SAMMLER des Servers findet denselben Datenpunkt in derselben
    //    Konfig - das ist die Bedingung dafuer, dass `_page_has_datapoint` die
    //    Seite als Kontext akzeptiert und der Gast statt 403 den Wert bekommt.
    expect([...collectDatapointIds(widget.config, rule)]).toEqual([DP])
  })

  it('haengt genau am Namen des Schluessels - ein Umbenennen zerstoert es', () => {
    const widget = geregeltesWidget()
    // WELCHER Schluessel traegt die Id? Der, unter dem sie in der Regel steht.
    const regel = widget.config.visible_when
    const schluessel = Object.keys(regel).find((k) => regel[k] === DP)
    expect(schluessel).toBeTruthy()
    expect(rule.erkennt(schluessel)).toBe(true)

    // Gegenprobe: derselbe Wert unter einem plausiblen anderen Namen wird NICHT
    // gefunden. Das Element bliebe fuer jeden Gast dauerhaft verborgen.
    for (const erfunden of ['dp', 'datapointRef', 'ref', 'quelle']) {
      expect([erfunden, rule.erkennt(erfunden)]).toEqual([erfunden, false])
      const umbenannt = { visible_when: { [erfunden]: DP, op: 'gt', value: 30 } }
      expect([erfunden, [...collectDatapointIds(umbenannt, rule)]]).toEqual([erfunden, []])
    }
  })

  it('braucht eine UUID als Wert - ein anderer Bezeichner kaeme nie durch', () => {
    // `is_uuid_str` im Sammler: nur ein UUID-String zaehlt. Ein Datenpunkt-Alias
    // („dp-m5-solo") stuende zwar in der Konfig, der Server saehe ihn aber nicht.
    const alias = { visible_when: { datapoint_id: 'dp-m5-solo', op: 'gt', value: 30 } }
    expect([...collectDatapointIds(alias, rule)]).toEqual([])
  })
})
