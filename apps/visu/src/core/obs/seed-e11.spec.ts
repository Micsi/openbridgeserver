import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BlindDevice } from '@obs/visu-contract';

import { mapWidget, type ObsWidget } from './mapping';
import { makeCtx } from '../ctx';

/**
 * DER ZAUN UM DIE ZUSAGE VON **E11** (M5 C3, Issue #170).
 *
 * Die Zeile E11 endet mit einer einzigen, sehr konkreten Erwartung:
 *
 *   `await expect(preview.getByText('21.5')).toBeVisible()`
 *
 * Damit sie ueberhaupt erfuellbar ist, muessen DREI Dinge zusammenpassen, die in
 * drei verschiedenen Dateien stehen:
 *
 *  1. der Seed legt an `M5 Solo` einen Widget-TYP an, den die Abbildung der Visu
 *     ueberhaupt uebersetzt und der eine ZAHL zeigt (`apps/visu/e2e/seed.py` →
 *     `M5_WIDGET_TYPES`),
 *  2. er schreibt die Datenpunkt-Id an den SLOT, aus dem genau dieser Typ liest
 *     (`WIDGET_DP_SLOT`),
 *  3. und der Wert, den er setzt (`seed_value(..., 21.5)`), ist derselbe, den
 *     das Szenario sucht.
 *
 * Bis Runde 2 hing das an nichts: eine Mutationsprobe hat `M5_WIDGET_TYPES`
 * geleert, `M5 Solo` fiel auf `Toggle` zurueck - dessen Kachel kennt nur EIN/AUS,
 * die „21.5" waere unerreichbar geworden - und KEIN Gate wurde rot, weil die
 * bestehende Probe an einem handgeschriebenen Widget haengt statt am Seed.
 *
 * Diese Probe schliesst das: sie liest die drei Zusagen als DATEN aus `seed.py`
 * und aus dem Szenario, baut daraus dasselbe Widget, das `put_page` schreiben
 * wuerde, und laesst es durch die ECHTE Abbildung und den ECHTEN Kacheltext des
 * Hosts laufen. Der Vergleich ist am Ende genau der des Szenarios: steht die
 * gesuchte Zeichenfolge im Text der Kachel?
 */

const SEED_REL = join('apps', 'visu', 'e2e', 'seed.py');
const SZENARIEN_REL = join('apps', 'visu', 'e2e', 'm5-editor-matrix.spec.ts');

/** Die Repo-Wurzel ist der Ordner, der beide Haelften traegt. */
function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, SEED_REL)) && existsSync(join(dir, SZENARIEN_REL))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error('Seed/Szenarien nicht gefunden - Repo umgebaut?');
    dir = up;
  }
}

/** Ein Ausschnitt, der da sein MUSS - fehlt er, ist der Seed umgebaut, nicht gleich. */
function treffer(text: string, re: RegExp, was: string): RegExpMatchArray {
  const m = text.match(re);
  if (!m) throw new Error(`${was} nicht gefunden - Seed/Szenario umgebaut?`);
  return m;
}

/** Eine Python-Tabelle `{"a": "b", ...}` als Daten (Kommentarzeilen fallen weg). */
function pyTabelle(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, k, v] of block.matchAll(/"([\w.]+)"\s*:\s*"([\w.]+)"/g)) out[k] = v;
  return out;
}

let seed: string;
let szenarien: string;

beforeAll(() => {
  const wurzel = repoRoot();
  seed = readFileSync(join(wurzel, SEED_REL), 'utf8');
  szenarien = readFileSync(join(wurzel, SZENARIEN_REL), 'utf8');
});

/** Was der Seed an `M5 Solo` anlegt - aus seinen eigenen Tabellen gelesen. */
function seedZusage(): { typ: string; slot: string; wert: number } {
  const typen = pyTabelle(
    treffer(seed, /M5_WIDGET_TYPES: dict\[str, str\] = \{([^}]*)\}/, 'M5_WIDGET_TYPES')[1],
  );
  const slots = pyTabelle(
    treffer(seed, /WIDGET_DP_SLOT: dict\[str, str\] = \{([\s\S]*?)\n\}/, 'WIDGET_DP_SLOT')[1],
  );
  // Der Seed selbst kennt eine Vorgabe fuer Seiten ohne eigenen Eintrag.
  const typ = typen['solo'] ?? 'Toggle';
  const slot = slots[typ];
  if (!slot) throw new Error(`WIDGET_DP_SLOT kennt den Typ ${typ} nicht`);
  const wert = Number(
    treffer(seed, /seed_value\(m5_dp\[key\],\s*([\d.]+)\)/, 'seed_value der M5-Seiten')[1],
  );
  return { typ, slot, wert };
}

/**
 * Die Zeichenfolge, die Szenario E11 in der Vorschau sucht.
 *
 * `test.fixme` ODER `test`: der Zaun haengt an der ZUSAGE der Zeile, nicht
 * daran, ob sie gerade laeuft. Bis zum Zusammenfuehren von Teil C3 und Teil D
 * stand hier nur `test\.fixme`, und in dem Augenblick, in dem D die Zeile
 * aktivierte, fand der Zaun sein Szenario nicht mehr und riss - ein Zaun, der
 * genau dann faellt, wenn das Bewachte zu leben anfaengt, bewacht nichts.
 */
function e11Erwartung(): string {
  const block = treffer(
    szenarien,
    /test(?:\.fixme)?\(\s*'E11[\s\S]*?\n {2}\}\);/,
    'Szenario E11',
  )[0];
  return treffer(block, /getByText\('([^']+)'\)/, "getByText von E11")[1];
}

/** Das Widget, das `put_page` fuer `M5 Solo` schreibt - Schema aus seed.py. */
function seedWidget(typ: string, slot: string, dp: string): ObsWidget {
  return {
    id: 'w-solo',
    name: 'M5 Solo Epsilon',
    type: typ,
    datapoint_id: slot === 'datapoint_id' ? dp : null,
    status_datapoint_id: null,
    x: 0,
    y: 0,
    w: 3,
    h: 2,
    config: slot === 'datapoint_id' ? {} : { [slot.slice('config.'.length)]: dp },
  } as ObsWidget;
}

describe('Seed und E11 - die „21.5" ist an M5 Solo wirklich sichtbar', () => {
  it('macht aus dem, was der Seed schreibt, eine Kachel, die den Seed-Wert ausschreibt', () => {
    const { typ, slot, wert } = seedZusage();
    const gesucht = e11Erwartung();

    // Die beiden Zahlen sind dieselbe: was der Seed setzt, sucht das Szenario.
    expect(String(wert)).toContain(gesucht);

    const dp = 'dp-m5-solo';
    const mapped = mapWidget(seedWidget(typ, slot, dp), 'M5 Solo', new Map([[dp, wert]]));
    // Ein Typ, den die Abbildung nicht uebersetzt (issue #124), waere hier null -
    // eine Kachel, die es nie auf den Bildschirm schafft.
    expect(mapped, `Servertyp ${typ} wird von der Abbildung nicht uebersetzt`).not.toBeNull();

    // Und der Kacheltext des Hosts - derselbe, den die Vorschau ausschreibt -
    // enthaelt genau die Zeichenfolge, die E11 sucht.
    const text = makeCtx().stateText(mapped!.device);
    expect(text, `Kacheltext von ${typ}`).toContain(gesucht);
  });

  it('haengt an genau dem Slot, aus dem die Abbildung fuer diesen Typ liest', () => {
    const { typ, slot, wert } = seedZusage();
    const dp = 'dp-m5-solo';

    // Gegenprobe: derselbe Wert an einem ANDEREN Slot erreicht die Kachel nicht.
    const falsch = {
      ...seedWidget(typ, slot, dp),
      datapoint_id: null,
      config: { irgendwo_anders: dp },
    } as ObsWidget;
    const ohne = mapWidget(falsch, 'M5 Solo', new Map([[dp, wert]]));
    expect(makeCtx().stateText(ohne!.device)).not.toContain(e11Erwartung());

    // Der Slot des Seeds dagegen trifft, und zwar als ZAHL, nicht als Text.
    const mapped = mapWidget(seedWidget(typ, slot, dp), 'M5 Solo', new Map([[dp, wert]]));
    expect((mapped!.device as BlindDevice).position).toBe(wert);
  });
});
