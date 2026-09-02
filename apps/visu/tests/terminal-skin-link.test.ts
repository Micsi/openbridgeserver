// A5 cross-repo Linchpin: belegt, dass die App den Terminal-Skin über den Dev-Link
// (`@obs-visu-skins/terminal` → obs-visu-skins/packages/skins/terminal) auflöst.
// App und Skin leben in getrennten Repos und kennen einander nicht (ARCHITECTURE.md §1);
// beide hängen nur am Vertrag. Analog zu ionic-skin-link.test.ts prüft dieser Test die
// Form des Skin-Manifests und der Renderer-Maps des Listen-Skins.
//
// WARUM HIER NICHTS MEHR GETIPPT WIRD: die frühere Fassung hatte `targetsContract`
// als Literal `'1.1'` und die Kern-Typen als handgeschriebene Listen. Damit war der
// Wächter blind für genau das, wofür er da ist:
//   • Die Vertragsdivergenz lief NEUN Minor-Versionen mit (Vertrag 1.10 gegen
//     Skin 1.1), ohne je rot zu werden.
//   • Die getippten Listen prüfen nur, was jemand hingeschrieben hat. Führt der
//     Vertrag einen neuen Kern-Typ ein, den der Skin gar nicht kennt, bleibt der
//     Test grün — es gibt keine Kopplung an den Vertrag, die ihn rot machen könnte.
//   • `unsupported` wurde mit `arrayContaining` geprüft, also einer Teilmengen-
//     Aussage, die beliebigen weiteren Inhalt durchgehen liess.
// (Der `climate`-Renderer fehlte dem alten Skin zwar, war aber korrekt als
// `unsupported` deklariert — das war kein Loch, sondern eine bewusste Abwahl.)
// Ein Wächter, der eine getippte Wahrheit wiederholt statt sie abzuleiten, hört
// auf, eine Aussage zu sein. Deshalb kommt hier jede Erwartung aus dem VERTRAG
// oder aus dem MANIFEST.

import { describe, it, expect } from 'vitest';
import { schema, version } from '@obs/visu-contract';
import manifest from '@obs-visu-skins/terminal/manifest.json';
import { tiles, details } from '@obs-visu-skins/terminal';

/** Ein Widget-Eintrag der Vertrags-Schema-Datei; `reserved` markiert die noch
 *  nicht ausgeführten Tablet/Desktop-Typen (weather · energy · chart · alarm). */
interface SchemaWidget {
  readonly reserved?: boolean;
}

/**
 * Die KERN-Widget-Typen, aus dem Vertrag abgeleitet: alles in `schema.widgets`,
 * was nicht `reserved` ist. Das ist dieselbe Menge wie der Typ `CoreWidgetType`,
 * nur zur Laufzeit — und sie wächst automatisch mit, wenn der Vertrag einen
 * reservierten Typ ausführt. Genau dann soll dieser Test rot werden, bis der
 * Skin den Typ rendert oder ihn bewusst als `unsupported` deklariert
 * (Goldene Regel 3: „nicht unterstützt" ist Pflichtangabe, kein Vergessen).
 */
const CORE_TYPES: readonly string[] = Object.entries(
  (schema as unknown as { widgets: Record<string, SchemaWidget> }).widgets,
)
  .filter(([, spec]) => spec.reserved !== true)
  .map(([type]) => type)
  .sort();

describe('terminal skin dev-link (cross-repo)', () => {
  it('resolves the terminal manifest and targets the contract', () => {
    expect(manifest.name).toBe('terminal');
    // Wächter gegen cross-repo-Versionsdrift: die Skin muss exakt die App-Vertragsversion
    // targeten — kein hartcodiertes Literal, das die Divergenz wieder verschluckt.
    expect(manifest.targetsContract).toBe(version);
    // terminal is the LIST skin (vs. ionic's grid).
    expect(manifest.layout.model).toBe('list');
  });

  it('covers every core widget type — rendered or declared unsupported', () => {
    const declared = Object.keys(manifest.widgets).sort();
    // Widen explicitly: a manifest with `"unsupported": []` infers as `never[]`
    // from JSON, which would make every comparison below a type error.
    const unsupported = ([...manifest.unsupported] as string[]).sort();

    // Bewusste Abwahl ist Pflichtangabe, kein Vergessen (Goldene Regel 3) — und
    // sie muss echte Kern-Typen benennen, keine Tippfehler oder Altlasten.
    for (const type of unsupported) expect(CORE_TYPES).toContain(type);
    // Ein Typ ist entweder deklariert ODER abgewählt, nie beides.
    expect(declared.filter((t) => unsupported.includes(t))).toEqual([]);
    // Und zusammen decken sie den Vertrag lückenlos ab: kein Kern-Typ fällt
    // stillschweigend hinten runter, wenn der Vertrag wächst.
    expect([...declared, ...unsupported].sort()).toEqual([...CORE_TYPES]);
  });

  it('resolves the terminal renderer maps (full list-row renderers)', () => {
    expect(tiles).toBeTypeOf('object');
    expect(details).toBeTypeOf('object');
    // Der Skin rendert genau das, was sein Manifest deklariert — eine Zeile pro
    // deklariertem Typ, nichts Undeklariertes, nichts Fehlendes.
    expect(Object.keys(tiles).sort()).toEqual(Object.keys(manifest.widgets).sort());
  });
});
