import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * preview/protocolMirror - die Naht zwischen den beiden Kopien (C4, Issue #171).
 *
 * Kanal, Version und Nachrichtentypen stehen ZWEIMAL: hier in
 * `preview/protocol.ts` und in `gui/src/composables/useVisuPreviewBridge.js`. Die
 * Admin-GUI liegt nicht im pnpm-Workspace der Visu, kann den Vertrag also nicht
 * importieren - die Kopie ist Absicht, das Auseinanderlaufen nicht. Genau dieses
 * Risiko benennt der Kopfkommentar beider Dateien, und genau dagegen gab es
 * bisher keine Probe: eine driftende Konstante blieb in beiden Suiten gruen,
 * weil jede Spec ihre Nachrichten aus der Konstante baut, die sie sichern soll.
 *
 * Diese Spec vergleicht deshalb die beiden Haelften miteinander. Sie liest den
 * QUELLTEXT der GUI-Seite NICHT mehr: eine Regex ueber fremden Code ist fragil in
 * die falsche Richtung - der frueheren Fassung reichte ein verschachteltes
 * Objektliteral, um die Typliste stillschweigend zu kuerzen, und doppelte
 * Anfuehrungszeichen oder ein `as const`-Umbau haetten sie ratlos gemacht.
 * Stattdessen wird das GUI-Modul zur Laufzeit als ECHTES Modul geladen und gegen
 * die hier importierten Werte gehalten - unabhaengig von Formatierung,
 * Anfuehrungszeichen und Reihenfolge. Verschiebt jemand eine Haelfte, faellt die
 * Wurzelsuche mit Klartext; benennt jemand einen Export um, faellt
 * {@link exported} - beides rot, nie still.
 *
 * Die Schwesterprobe liegt in `gui/tests/composables/visuPreviewProtocolMirror.spec.js`
 * und laeuft in der GUI-Suite, damit egal ist, wer die Konstante anfasst.
 */

import { PREVIEW_CHANNEL, PREVIEW_MESSAGE, PREVIEW_PROTOCOL_VERSION } from './protocol';

/** Beide Dateien liegen im selben Repo - die Wurzel ist der Ordner, der beide
 *  traegt. Vom Arbeitsverzeichnis aus hochlaufen statt Pfade zu raten. */
const VISU_REL = join('apps', 'visu', 'src', 'preview', 'protocol.ts');
const GUI_REL = join('gui', 'src', 'composables', 'useVisuPreviewBridge.js');

function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, VISU_REL)) && existsSync(join(dir, GUI_REL))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error('Weder Vertrag noch GUI-Kopie gefunden - Repo umgebaut?');
    dir = up;
  }
}

/** Das GUI-Modul, geladen wie ein Modul - nicht gelesen wie ein Text. */
async function loadGuiBridge(): Promise<Record<string, unknown>> {
  const href = pathToFileURL(join(repoRoot(), GUI_REL)).href;
  return (await import(/* @vite-ignore */ href)) as Record<string, unknown>;
}

/** Ein Export, der da sein MUSS - sonst ist die Kopie umbenannt, nicht gleich. */
function exported(module: Record<string, unknown>, name: string): unknown {
  if (!(name in module)) {
    throw new Error(`Export ${name} fehlt in der GUI-Kopie - umbenannt oder umgebaut?`);
  }
  return module[name];
}

describe('Vorschau-Protokoll - die GUI-Kopie darf nicht driften', () => {
  it('nennt denselben Kanal', async () => {
    const gui = await loadGuiBridge();
    // Der Vergleich waere wertlos, wenn hier zwei leere Werte staenden.
    expect(PREVIEW_CHANNEL).toMatch(/\S/);
    expect(exported(gui, 'VISU_PREVIEW_CHANNEL')).toBe(PREVIEW_CHANNEL);
  });

  it('nennt dieselbe Protokollversion', async () => {
    const gui = await loadGuiBridge();
    expect(PREVIEW_PROTOCOL_VERSION).toMatch(/^\d+\.\d+$/);
    expect(exported(gui, 'VISU_PREVIEW_PROTOCOL')).toBe(PREVIEW_PROTOCOL_VERSION);
  });

  it('kennt dieselben Nachrichtentypen', async () => {
    const gui = await loadGuiBridge();
    const visuMessages: Record<string, string> = { ...PREVIEW_MESSAGE };
    // Der Vergleich waere wertlos, wenn beide Seiten leer waeren - und eine
    // Erweiterung des Protokolls soll hier auffallen, nicht durchrutschen.
    expect(Object.keys(visuMessages).sort()).toEqual([
      'accepted',
      'draft',
      'draftApplied',
      'init',
      'ready',
      'rejected',
    ]);
    for (const value of Object.values(visuMessages)) expect(value).toMatch(/\S/);
    expect({ ...(exported(gui, 'VISU_PREVIEW_MESSAGE') as object) }).toEqual(visuMessages);
  });
});
