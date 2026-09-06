// @vitest-environment node
// (Dateisystem-Test gegen die von Capacitor erzeugten nativen Projekte — kein DOM;
//  unter jsdom ist `import.meta.url` keine file:-URL und `fileURLToPath` schlägt fehl.)

// M4 · Issue #103, AC3 + „ein Code-Stand" — die native Hälfte, soweit sie OHNE
// Xcode-Runtime und Android SDK prüfbar ist.
//
// Der Liefergegenstand von `npx cap add ios android` sind versionierte Dateien.
// Ohne diesen Test kann das komplette native Gerüst gelöscht werden, ohne dass
// eine Suite rot wird — die PWA-Tests merken davon nichts.
//
// Drei Eigenschaften werden gemessen:
//  1. das Gerüst existiert (Xcode-Projekt, SPM-Manifest, Gradle-Modul, Manifest),
//  2. die AUSGELIEFERTE App-Identität deckt sich mit capacitor.config.ts — die
//     appId steht nach `cap add` an fünf weiteren Stellen und driftet sonst frei,
//  3. der von `cap copy` gespiegelte Web-Stand ist byte-gleich mit `dist/`; das
//     ist die Datei-Ebene der Zusage „ein Code-Stand für alle drei Plattformen".

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import capacitorConfig from '../capacitor.config';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(appRoot, 'dist');

const IOS_MIRROR = join(appRoot, 'ios/App/App/public');
const ANDROID_MIRROR = join(appRoot, 'android/app/src/main/assets/public');

// `cap copy` legt neben dem Web-Build die Cordova-Kompatibilitäts-Shims ab.
// Sie stammen aus Capacitor, nicht aus `dist/` — alles andere muss sich decken.
const MIRROR_ONLY = ['cordova.js', 'cordova_plugins.js'];

function read(relPath: string): string {
  const file = join(appRoot, relPath);
  expect(
    existsSync(file),
    `Von Capacitor erzeugte Datei fehlt: ${relPath} — \`npx cap add ios android\` nicht gelaufen?`,
  ).toBe(true);
  return readFileSync(file, 'utf-8');
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('native Plattform-Projekte (AC3)', () => {
  // Ohne diese vier Dateien gibt es kein baubares iOS-/Android-Projekt — sie sind
  // der eigentliche Liefergegenstand von `npx cap add`.
  it.each([
    'ios/App/App.xcodeproj/project.pbxproj',
    'ios/App/CapApp-SPM/Package.swift',
    'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml',
  ])('enthält %s', (relPath) => {
    expect(existsSync(join(appRoot, relPath)), `Natives Projekt unvollständig: ${relPath} fehlt`).toBe(true);
  });
});

describe('native App-Identität deckt sich mit capacitor.config.ts', () => {
  const appId = capacitorConfig.appId!;
  const appName = capacitorConfig.appName!;

  it('Android: applicationId und namespace in app/build.gradle', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle.match(/applicationId\s+"([^"]+)"/)?.[1], 'applicationId driftet gegen capacitor.config.ts').toBe(
      appId,
    );
    expect(gradle.match(/namespace\s*=\s*"([^"]+)"/)?.[1], 'namespace driftet gegen capacitor.config.ts').toBe(appId);
  });

  it('Android: package_name, custom_url_scheme und app_name in strings.xml', () => {
    const strings = read('android/app/src/main/res/values/strings.xml');
    const value = (name: string) => strings.match(new RegExp(`<string name="${name}">([^<]*)</string>`))?.[1];
    expect(value('package_name'), 'strings.xml/package_name driftet').toBe(appId);
    expect(value('custom_url_scheme'), 'strings.xml/custom_url_scheme driftet').toBe(appId);
    expect(value('app_name'), 'strings.xml/app_name driftet').toBe(appName);
    expect(value('title_activity_main'), 'strings.xml/title_activity_main driftet').toBe(appName);
  });

  it('iOS: PRODUCT_BUNDLE_IDENTIFIER in BEIDEN Build-Konfigurationen', () => {
    const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
    const ids = [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1].trim());
    // Debug und Release — eine allein gepflegt zu haben ist der klassische Drift.
    expect(ids.length, 'pbxproj: erwartet je eine Bundle-ID für Debug und Release').toBe(2);
    expect(ids).toEqual([appId, appId]);
  });

  it('iOS: CFBundleDisplayName in Info.plist', () => {
    const plist = read('ios/App/App/Info.plist');
    const displayName = plist.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
    expect(displayName, 'Info.plist/CFBundleDisplayName driftet gegen capacitor.config.ts').toBe(appName);
  });
});

describe('ein Code-Stand auf Dateiebene: die nativen Spiegel sind der Web-Build', () => {
  it.each([
    ['iOS', IOS_MIRROR],
    ['Android', ANDROID_MIRROR],
  ])('%s spiegelt dist/ byte-gleich', (_platform, mirror) => {
    expect(
      existsSync(mirror),
      `Kein gespiegelter Web-Stand unter ${relative(appRoot, mirror)} — vorher \`pnpm build && pnpm cap:sync\` ` +
        `(in visu-ci erledigt das der Step „Capacitor copy"; der Spiegel selbst ist per Capacitors .gitignore ungetrackt).`,
    ).toBe(true);

    const distFiles = filesUnder(distDir).map((f) => relative(distDir, f));
    expect(distFiles.length, 'dist/ ist leer — vorher `pnpm build`').toBeGreaterThan(0);

    const differing = distFiles.filter((rel) => {
      const mirrored = join(mirror, rel);
      return !existsSync(mirrored) || sha256(join(distDir, rel)) !== sha256(mirrored);
    });
    expect(differing, 'Spiegel weicht vom Web-Build ab — `cap sync` nachziehen').toEqual([]);

    const extra = filesUnder(mirror)
      .map((f) => relative(mirror, f))
      .filter((rel) => !distFiles.includes(rel) && !MIRROR_ONLY.includes(rel));
    expect(extra, 'Spiegel enthält Dateien, die nicht aus dist/ stammen').toEqual([]);
  });
});
