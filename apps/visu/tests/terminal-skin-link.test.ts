// A5 cross-repo Linchpin: belegt, dass die App den Terminal-Skin über den Dev-Link
// (`@obs-visu-skins/terminal` → obs-visu-skins/packages/skins/terminal) auflöst.
// App und Skin leben in getrennten Repos und kennen einander nicht (ARCHITECTURE.md §1);
// beide hängen nur am Vertrag. Analog zu ionic-skin-link.test.ts prüft dieser Test die
// Form des Skin-Manifests und der Renderer-Maps des Listen-Skins.

import { describe, it, expect } from 'vitest';
import manifest from '@obs-visu-skins/terminal/manifest.json';
import { tiles, details } from '@obs-visu-skins/terminal';

describe('terminal skin dev-link (cross-repo)', () => {
  it('resolves the terminal manifest and targets the contract', () => {
    expect(manifest.name).toBe('terminal');
    expect(manifest.targetsContract).toBe('1.1');
    // terminal is the LIST skin (vs. ionic's grid).
    expect(manifest.layout.model).toBe('list');
    // Bewusste Abwahl ist Pflichtangabe, kein Vergessen (golden rule 3).
    expect(manifest.unsupported).toEqual(expect.arrayContaining(['camera', 'media']));
    // Kern-Typen sind deklariert (sonst meldet der Generator gap).
    expect(Object.keys(manifest.widgets).sort()).toEqual(['blind', 'jalousie', 'light', 'scene', 'sensor', 'switch']);
  });

  it('resolves the terminal renderer maps (full list-row renderers)', () => {
    expect(tiles).toBeTypeOf('object');
    expect(details).toBeTypeOf('object');
    // terminal ships a row renderer per core type.
    expect(Object.keys(tiles).sort()).toEqual(['blind', 'jalousie', 'light', 'scene', 'sensor', 'switch']);
  });
});
