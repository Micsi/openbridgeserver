// @vitest-environment node
// (Dateisystem-Test gegen das Build-Artefakt — kein DOM nötig; unter jsdom ist
//  `import.meta.url` keine file:-URL und `fileURLToPath` schlägt fehl.)

// M4 · Issue #103 — PWA-Abnahme, gemessen am echten Build-Artefakt.
//
// Diese Datei liest bewusst `dist/` und nicht die Vite-/PWA-Konfiguration: ein
// Manifest, das in `vite.config.ts` richtig aussieht, aber nie im Bundle landet —
// oder auf ein Icon zeigt, das nie emittiert wurde — ist der klassische stille
// PWA-Fehler. Genau den soll dieser Test fangen.
//
// Ausgabeverzeichnis UND `base` werden aus der echten Vite-Konfiguration erhoben
// (`resolveConfig`), nicht als Literal behauptet. Sonst prüft der Test nur den
// Sonderfall `base: '/'` und wird irreführend, sobald die Visu unter einem
// Unterpfad ausgeliefert wird (heute serviert obs die Visu unter `/visu`).
//
// `visu-ci` baut vor dem Testschritt (`pnpm -r build` → `pnpm -r test`), dort ist
// `dist/` also vorhanden. Lokal vorher `pnpm build` (oder `pnpm exec vite build`)
// in `apps/visu` laufen lassen.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { resolveConfig } from 'vite';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

let distDir: string;
let base: string;
let indexHtml: string;

// `resolveConfig` lädt und transpiliert die echte vite.config.ts — auf
// ausgelasteten Maschinen mehrere Sekunden. Einmal im Hook, mit grosszügigem
// Timeout statt vitests 5s-Default.
beforeAll(async () => {
  const config = await resolveConfig({ configFile: resolve(appRoot, 'vite.config.ts'), root: appRoot }, 'build');
  distDir = resolve(appRoot, config.build.outDir);
  base = config.base;

  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(
      `Kein Build-Artefakt unter ${indexPath}. Vor der Testsuite \`pnpm build\` in apps/visu ausführen ` +
        `(visu-ci baut vor dem Testschritt).`,
    );
  }
  // HTML-Kommentare raus: sonst würde auskommentiertes Markup als echte
  // Verlinkung durchgehen.
  indexHtml = readFileSync(indexPath, 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
}, 120_000);

/**
 * Löst einen URL-Pfad aus dem Bundle auf eine Datei in `dist/` auf.
 * Absolute URLs müssen unter der Build-`base` liegen — der Präfix wird
 * abgeschnitten, weil er im Ausgabeverzeichnis nicht existiert.
 */
function distPath(urlPath: string): string {
  if (urlPath.startsWith('/')) {
    expect(
      urlPath.startsWith(base),
      `"${urlPath}" liegt nicht unter der Build-base "${base}" — im Auslieferungspfad läuft das ins Leere`,
    ).toBe(true);
    return join(distDir, urlPath.slice(base.length));
  }
  return join(distDir, urlPath);
}

/** Liest die echten Pixelmasse aus dem PNG-IHDR-Chunk — ohne Bild-Bibliothek. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(signature), `${file} ist kein PNG`).toBe(true);
  expect(buf.subarray(12, 16).toString('ascii'), `${file} hat keinen IHDR-Chunk`).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

interface WebAppManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  icons?: { src: string; sizes?: string; type?: string; purpose?: string }[];
}

/** Findet das Manifest über den `<link rel="manifest">` der gebauten index.html. */
function loadManifest(): WebAppManifest {
  const link = indexHtml.match(/<link[^>]+rel="manifest"[^>]*>/i);
  expect(link, 'gebaute index.html verlinkt kein Web-App-Manifest').not.toBeNull();
  const href = link![0].match(/href="([^"]+)"/i);
  expect(href, `<link rel="manifest"> ohne href: ${link![0]}`).not.toBeNull();
  const file = distPath(href![1]);
  expect(existsSync(file), `Manifest verlinkt, aber nicht gebaut: ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, 'utf-8')) as WebAppManifest;
}

/** Alle `<link rel="…icon…">` der gebauten Seite als {href, sizes}. */
function iconLinks(): { tag: string; href: string; sizes?: string }[] {
  return [...indexHtml.matchAll(/<link[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel="[^"]*icon[^"]*"/i.test(tag))
    .map((tag) => ({
      tag,
      href: tag.match(/href="([^"]+)"/i)?.[1] ?? '',
      sizes: tag.match(/sizes="([^"]+)"/i)?.[1],
    }));
}

/** Prüft eine Icon-Datei: existiert sie, und hat sie die Grösse, die sie behauptet? */
function assertIconFile(src: string, declaredSizes: string | undefined, origin: string): void {
  const file = distPath(src);
  expect(existsSync(file), `${origin} zeigt ins Leere: ${src}`).toBe(true);
  if (!file.endsWith('.png')) return;
  const actual = pngSize(file);
  if (/^\d+x\d+$/.test(declaredSizes ?? '')) {
    const [width, height] = declaredSizes!.split('x').map(Number);
    expect(actual, `${src} deklariert ${declaredSizes}`).toEqual({ width, height });
  } else {
    // Ohne deklarierte Grösse bleibt prüfbar, dass es ein dekodierbares,
    // quadratisches Icon ist — ein 0-Byte- oder verstümmeltes PNG fällt auf.
    expect(actual.width, `${src} hat keine Breite`).toBeGreaterThan(0);
    expect(actual.width, `${src} ist nicht quadratisch (${actual.width}x${actual.height})`).toBe(actual.height);
  }
}

describe('PWA-Manifest (Build-Artefakt)', () => {
  it('ist aus der gebauten index.html verlinkt und ist gültiges JSON', () => {
    expect(loadManifest()).toBeTypeOf('object');
  });

  it('trägt die Pflichtfelder für Installierbarkeit', () => {
    const manifest = loadManifest();
    expect(manifest.name, 'manifest.name fehlt').toBeTruthy();
    expect(manifest.short_name, 'manifest.short_name fehlt').toBeTruthy();
    expect(manifest.start_url, 'manifest.start_url fehlt').toBeTruthy();
    expect(manifest.display, 'manifest.display fehlt').toBeTruthy();
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
    expect(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest.icons ist leer').toBe(true);
  });

  it('verankert start_url, scope und Icon-Pfade unter der Build-base', () => {
    // Die base steuert index.html, Asset-URLs und die SW-Registrierung
    // automatisch — die Manifest-Felder schreiben WIR. Laufen sie auseinander,
    // installiert der Browser eine App mit falschem Scope und toten Icons,
    // ohne dass irgendetwas 404 wirft.
    const manifest = loadManifest();
    const underBase = (value: string | undefined, what: string) =>
      expect(value?.startsWith(base), `${what} = "${value}" liegt nicht unter der Build-base "${base}"`).toBe(true);

    underBase(manifest.start_url, 'manifest.start_url');
    underBase(manifest.scope, 'manifest.scope');
    for (const icon of manifest.icons ?? []) underBase(icon.src, `manifest.icons[].src`);
  });

  it('deklariert die von Android/Chrome geforderten 192er- und 512er-Icons', () => {
    const sizes = (loadManifest().icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('nennt nur Icons, die im Build existieren und die angegebene Grösse wirklich haben', () => {
    for (const icon of loadManifest().icons ?? []) assertIconFile(icon.src, icon.sizes, 'Manifest-Icon');
  });
});

describe('Icons aus der gebauten index.html', () => {
  // Favicon und apple-touch-icon stehen NICHT im Manifest — iOS liest den
  // apple-touch-icon-Link. Ohne diesen Test können beide Dateien verschwinden,
  // ohne dass eine Suite rot wird.
  it('verlinkt mindestens Favicon und apple-touch-icon', () => {
    const rels = iconLinks().map((link) => link.tag.match(/rel="([^"]+)"/i)?.[1]);
    expect(rels, 'gebaute index.html verlinkt kein Favicon').toContain('icon');
    expect(rels, 'gebaute index.html verlinkt kein apple-touch-icon (iOS-Homescreen)').toContain('apple-touch-icon');
  });

  it('löst jeden Icon-Link auf eine existierende Datei der behaupteten Grösse auf', () => {
    const links = iconLinks();
    expect(links.length, 'keine Icon-Links in der gebauten index.html').toBeGreaterThan(0);
    for (const link of links) {
      expect(link.href, `Icon-Link ohne href: ${link.tag}`).toBeTruthy();
      assertIconFile(link.href, link.sizes, 'Icon-Link der index.html');
    }
  });
});

describe('Service Worker (Build-Artefakt)', () => {
  /** Der SW-Pfad, wie ihn die gebaute Seite tatsächlich registriert. */
  function registeredServiceWorker(): string {
    // injectRegister 'script'/'script-defer' → externes registerSW.js;
    // injectRegister 'inline' → Registrierung steht direkt in der index.html.
    const external = indexHtml.match(/<script[^>]+src="([^"]*registerSW[^"]*\.js)"/i);
    const source = external ? readFileSync(distPath(external[1]), 'utf-8') : indexHtml;
    const registration = source.match(/serviceWorker\s*\.\s*register\(\s*['"]([^'"]+)['"]/);
    expect(registration, 'die gebaute Seite registriert keinen Service Worker').not.toBeNull();
    return registration![1];
  }

  it('registriert einen Service Worker aus der gebauten index.html', () => {
    expect(registeredServiceWorker()).toBeTruthy();
  });

  it('emittiert die Service-Worker-Datei, auf die die Registrierung zeigt', () => {
    const file = distPath(registeredServiceWorker());
    expect(existsSync(file), `Registrierter Service Worker fehlt im Build: ${file}`).toBe(true);
    // Ein Workbox-Precache-Manifest belegt, dass der SW den App-Shell wirklich cached.
    expect(readFileSync(file, 'utf-8')).toMatch(/precach/i);
  });
});
