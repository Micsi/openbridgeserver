// M2-Foundation cross-repo Linchpin: belegt, dass die App den Ionic-Skin über den
// Dev-Link (`@obs-visu-skins/ionic` → obs-visu-skins/packages/skins/ionic) auflöst.
// App und Skin leben in getrennten Repos und kennen einander nicht (ARCHITECTURE.md §1);
// beide hängen nur am Vertrag. Dieser Test prüft die Form des Skin-Manifests und der
// (Stub-)Renderer-Maps, nicht deren Inhalt — die Renderer-Wellen füllen die Maps.

import { describe, it, expect } from 'vitest';
import { version } from '@obs/visu-contract';
import manifest from '@obs-visu-skins/ionic/manifest.json';
import { tiles, details } from '@obs-visu-skins/ionic';

describe('ionic skin dev-link (cross-repo)', () => {
  it('resolves the ionic manifest and targets the contract', () => {
    expect(manifest.name).toBe('ionic');
    // Wächter gegen cross-repo-Versionsdrift: die Skin muss exakt die App-Vertragsversion
    // targeten — kein hartcodiertes Literal, das bei jedem Contract-Bump erneut bricht.
    expect(manifest.targetsContract).toBe(version);
    expect(manifest.layout.model).toBe('grid');
    // Seit Contract 1.2 unterstützt ionic alle Kern-Typen inkl. camera/media — nichts abgewählt.
    expect(manifest.unsupported).toEqual([]);
    // Kern-Typen sind deklariert (sonst meldet der Generator gap).
    expect(Object.keys(manifest.widgets).sort()).toEqual(['blind', 'camera', 'jalousie', 'light', 'media', 'scene', 'sensor', 'switch']);
  });

  it('resolves the ionic renderer maps (typed stubs in M2)', () => {
    expect(tiles).toBeTypeOf('object');
    expect(details).toBeTypeOf('object');
  });
});
