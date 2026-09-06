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
// `visu-ci` baut vor dem Testschritt (`pnpm -r build` → `pnpm -r test`), dort ist
// `dist/` also vorhanden. Lokal vorher `pnpm build` (oder `pnpm exec vite build`)
// in `apps/visu` laufen lassen.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

/** Löst einen URL-Pfad aus dem Bundle (base `/`) auf eine Datei in `dist/` auf. */
function distPath(urlPath: string): string {
  return join(distDir, urlPath.replace(/^\//, ''));
}

/** Liest die echten Pixelmasse aus dem PNG-IHDR-Chunk — ohne Bild-Bibliothek. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(signature), `${file} ist kein PNG`).toBe(true);
  expect(buf.subarray(12, 16).toString('ascii'), `${file} hat keinen IHDR-Chunk`).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let indexHtml: string;

beforeAll(() => {
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
});

interface WebAppManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
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

  it('deklariert die von Android/Chrome geforderten 192er- und 512er-Icons', () => {
    const sizes = (loadManifest().icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('nennt nur Icons, die im Build existieren und die angegebene Grösse wirklich haben', () => {
    for (const icon of loadManifest().icons ?? []) {
      const file = distPath(icon.src);
      expect(existsSync(file), `Manifest-Icon zeigt ins Leere: ${icon.src}`).toBe(true);
      if (/^\d+x\d+$/.test(icon.sizes ?? '')) {
        const [width, height] = icon.sizes!.split('x').map(Number);
        expect(pngSize(file), `${icon.src} deklariert ${icon.sizes}`).toEqual({ width, height });
      }
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
