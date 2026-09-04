import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
 * Diese Spec laedt deshalb den Vertrag der Visu-Seite zur Laufzeit als ECHTES
 * Modul und vergleicht ihn mit den hier exportierten Werten. Sie liest seinen
 * Quelltext nicht mehr: eine Regex ueber fremden Code haengt an Formatierung,
 * Anfuehrungszeichen und Verschachtelung und kann still danebenliegen — der
 * Modul-Import kann das nicht. Verschiebt jemand eine Haelfte, faellt die
 * Wurzelsuche mit Klartext; benennt jemand einen Export um, faellt die
 * Existenzpruefung. Die Schwesterprobe liegt in
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

/** Der Vertrag der Visu-Seite, geladen wie ein Modul - nicht gelesen wie ein Text. */
async function loadVisuProtocol() {
  const href = pathToFileURL(join(repoRoot(), VISU_REL)).href
  return await import(/* @vite-ignore */ href)
}

/** Ein Export, der da sein MUSS - sonst ist der Vertrag umbenannt, nicht gleich. */
function exported(module, name) {
  if (!(name in module)) {
    throw new Error(`Export ${name} fehlt im Vertrag der Visu-Seite - umbenannt oder umgebaut?`)
  }
  return module[name]
}

describe('Vorschau-Protokoll — die Kopie in der GUI folgt der Visu', () => {
  it('nennt denselben Kanal', async () => {
    const visu = await loadVisuProtocol()
    // Der Vergleich waere wertlos, wenn hier zwei leere Werte staenden.
    expect(VISU_PREVIEW_CHANNEL).toMatch(/\S/)
    expect(VISU_PREVIEW_CHANNEL).toBe(exported(visu, 'PREVIEW_CHANNEL'))
  })

  it('nennt dieselbe Protokollversion', async () => {
    const visu = await loadVisuProtocol()
    expect(VISU_PREVIEW_PROTOCOL).toMatch(/^\d+\.\d+$/)
    expect(VISU_PREVIEW_PROTOCOL).toBe(exported(visu, 'PREVIEW_PROTOCOL_VERSION'))
  })

  it('kennt dieselben Nachrichtentypen', async () => {
    const visu = await loadVisuProtocol()
    // Der Vergleich waere wertlos, wenn beide Seiten leer waeren - und eine
    // Erweiterung des Protokolls soll hier auffallen, nicht durchrutschen.
    expect(Object.keys(VISU_PREVIEW_MESSAGE).sort()).toEqual([
      'accepted',
      'draft',
      'draftApplied',
      'init',
      'ready',
      'rejected',
    ])
    for (const value of Object.values(VISU_PREVIEW_MESSAGE)) expect(value).toMatch(/\S/)
    expect({ ...VISU_PREVIEW_MESSAGE }).toEqual({ ...exported(visu, 'PREVIEW_MESSAGE') })
  })
})
