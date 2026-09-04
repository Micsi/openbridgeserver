import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
 * Diese Spec liest deshalb den QUELLTEXT der jeweils anderen Seite und vergleicht
 * die Werte. Sie laeuft in beiden Suiten (die Schwester liegt in
 * `gui/tests/composables/visuPreviewProtocolMirror.spec.js`), damit egal ist, wer
 * die Konstante anfasst.
 */

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

const ROOT = repoRoot();
const VISU_PROTOCOL = join(ROOT, VISU_REL);
const GUI_BRIDGE = join(ROOT, GUI_REL);

/** Kommentare heraus, damit Beispiele darin nichts vortaeuschen. */
function code(path: string): string {
  const raw = readFileSync(path, 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Der Wert einer `export const NAME = '…'`-Zeile. */
function constant(source: string, name: string): string {
  const m = new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`).exec(source);
  if (!m) throw new Error(`Konstante ${name} nicht gefunden - Datei umbenannt oder umgebaut?`);
  return m[1];
}

/** Die Eintraege eines `export const NAME = { … }`-Objektliterals. */
function messageMap(source: string, name: string): Record<string, string> {
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`Objekt ${name} nicht gefunden.`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const body = source.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*'([^']*)'/g)) out[m[1]] = m[2];
  return out;
}

describe('Vorschau-Protokoll - die GUI-Kopie darf nicht driften', () => {
  const visu = code(VISU_PROTOCOL);
  const gui = code(GUI_BRIDGE);

  it('nennt denselben Kanal', () => {
    expect(constant(gui, 'VISU_PREVIEW_CHANNEL')).toBe(constant(visu, 'PREVIEW_CHANNEL'));
  });

  it('nennt dieselbe Protokollversion', () => {
    expect(constant(gui, 'VISU_PREVIEW_PROTOCOL')).toBe(constant(visu, 'PREVIEW_PROTOCOL_VERSION'));
  });

  it('kennt dieselben Nachrichtentypen', () => {
    const visuMessages = messageMap(visu, 'PREVIEW_MESSAGE');
    // Der Vergleich waere wertlos, wenn hier nichts gefunden wuerde.
    expect(Object.keys(visuMessages).length).toBeGreaterThanOrEqual(6);
    expect(messageMap(gui, 'VISU_PREVIEW_MESSAGE')).toEqual(visuMessages);
  });
});
