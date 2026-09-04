import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  VISU_PREVIEW_CHANNEL,
  VISU_PREVIEW_MESSAGE,
  VISU_PREVIEW_PROTOCOL,
} from '@/composables/useVisuPreviewBridge'

/**
 * Die gespiegelte Haelfte des Vorschau-Protokolls (M5 C4, Issue #171).
 *
 * `useVisuPreviewBridge.js` haelt Kanal, Version und Nachrichtentypen als
 * bewusste Kopie von `apps/visu/src/preview/protocol.ts` — die GUI liegt nicht im
 * pnpm-Workspace der Visu und kann den Vertrag nicht importieren. Bisher band
 * kein einziger Test diese Kopie: jede Spec baut ihre Nachrichten aus genau der
 * Konstante, die sie sichern soll, also blieb ein Auseinanderlaufen in beiden
 * Suiten gruen — ausgerechnet das Risiko, das der Kopfkommentar benennt.
 *
 * Diese Spec liest deshalb den Quelltext der Visu-Seite und vergleicht ihn mit
 * den hier exportierten Werten. Die Schwesterprobe liegt in
 * `apps/visu/src/preview/protocolMirror.spec.ts`.
 */

const VISU_REL = join('apps', 'visu', 'src', 'preview', 'protocol.ts')
const GUI_REL = join('gui', 'src', 'composables', 'useVisuPreviewBridge.js')

/** Die Repo-Wurzel ist der Ordner, der beide Haelften traegt. */
function repoRoot() {
  let dir = resolve(process.cwd())
  for (;;) {
    if (existsSync(join(dir, VISU_REL)) && existsSync(join(dir, GUI_REL))) return dir
    const up = dirname(dir)
    if (up === dir) throw new Error('Vertrag der Visu-Seite nicht gefunden - Repo umgebaut?')
    dir = up
  }
}

/** Quelltext ohne Kommentare, damit Beispiele darin nichts vortaeuschen. */
const source = readFileSync(join(repoRoot(), VISU_REL), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

function constant(name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`).exec(source)
  if (!m) throw new Error(`Konstante ${name} nicht gefunden - Datei umbenannt oder umgebaut?`)
  return m[1]
}

function messageMap(name) {
  const start = source.indexOf(`export const ${name}`)
  if (start < 0) throw new Error(`Objekt ${name} nicht gefunden.`)
  const open = source.indexOf('{', start)
  const close = source.indexOf('}', open)
  const out = {}
  for (const m of source.slice(open + 1, close).matchAll(/(\w+)\s*:\s*'([^']*)'/g)) out[m[1]] = m[2]
  return out
}

describe('Vorschau-Protokoll — die Kopie in der GUI folgt der Visu', () => {
  it('nennt denselben Kanal', () => {
    expect(VISU_PREVIEW_CHANNEL).toBe(constant('PREVIEW_CHANNEL'))
  })

  it('nennt dieselbe Protokollversion', () => {
    expect(VISU_PREVIEW_PROTOCOL).toBe(constant('PREVIEW_PROTOCOL_VERSION'))
  })

  it('kennt dieselben Nachrichtentypen', () => {
    const visuMessages = messageMap('PREVIEW_MESSAGE')
    // Der Vergleich waere wertlos, wenn hier nichts gefunden wuerde.
    expect(Object.keys(visuMessages).length).toBeGreaterThanOrEqual(6)
    expect({ ...VISU_PREVIEW_MESSAGE }).toEqual(visuMessages)
  })
})
