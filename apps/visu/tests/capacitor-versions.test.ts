// @vitest-environment node
// (reines Dateilesen — kein DOM; siehe tests/pwa-build.test.ts zur Begründung.)

// M4 · Issue #103 — die Versions-Begründung als Test statt als Commit-Text.
//
// `@capacitor/{cli,core,ios,android}` werden im Gleichschritt released, und die
// nativen Projekte werden vom CLI erzeugt: driftet ein Plattformpaket gegen das
// CLI, bricht `cap sync` erst beim nativen Build. Deshalb sind alle vier exakt
// gepinnt (kein ^/~), und das iOS-Projekt hängt über `exact:` an derselben
// Version.
//
// M4 · Issue #104 erweitert das um die PLUGINS (`@capacitor/haptics`). Die
// laufen auf einer EIGENEN Versionslinie (8.0.2 gegen Core 8.5.1) — ein
// Gleichstand wie bei den vier Kernpaketen wäre schlicht nicht erfüllbar. Was
// stattdessen gilt und hier gemessen wird:
//  1. exakt gepinnt, wie alles andere aus dem Capacitor-Umfeld;
//  2. die vom Paket SELBST deklarierte Peer-Spanne auf `@capacitor/core` deckt
//     die gepinnte Core-Version (gelesen aus dem ausgelieferten Paket in
//     node_modules, nicht aus der Doku);
//  3. das Plugin ist in BEIDEN nativen Projekten verdrahtet — ein Plugin mit
//     nativem Anteil, das nur in package.json steht, ist auf dem Gerät stumm,
//     und genau das fällt ohne Xcode/Android SDK sonst niemandem auf;
//  4. `Package.swift` ist nicht nur „enthält die richtigen Zeichenketten",
//     sondern ein von SwiftPM AUSWERTBARES Manifest mit existierenden Pfaden.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const specifiers = { ...pkg.dependencies, ...pkg.devDependencies };

const CAPACITOR_PACKAGES = ['@capacitor/cli', '@capacitor/core', '@capacitor/ios', '@capacitor/android'];
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;

/** Alles aus dem `@capacitor/`-Namensraum, das kein Kernpaket ist — die Plugins.
 *  Aus package.json abgeleitet statt aufgezählt: ein morgen hinzugefügtes Plugin
 *  fällt so automatisch unter dieselben Regeln, statt am Wächter vorbeizulaufen. */
const CAPACITOR_PLUGINS = Object.keys(specifiers)
  .filter((name) => name.startsWith('@capacitor/') && !CAPACITOR_PACKAGES.includes(name))
  .sort();

/** `@capacitor/haptics` → `capacitor-haptics` (Gradle-Modul). */
const gradleModule = (name: string): string => `capacitor-${name.slice('@capacitor/'.length)}`;
/** `@capacitor/haptics` → `CapacitorHaptics` (SPM-Paket/Produkt). */
const swiftProduct = (name: string): string =>
  'Capacitor' +
  name
    .slice('@capacitor/'.length)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** Ein `>=x.y.z` / `^x.y.z` / `x.y.z` als [major, minor, patch]. */
function rangeFloor(range: string): [number, number, number] {
  const match = range.match(/(\d+)\.(\d+)\.(\d+)/);
  expect(match, `Peer-Spanne "${range}" ist keine ausgewertete Form (>=x.y.z / ^x.y.z / x.y.z)`).not.toBeNull();
  return [Number(match![1]), Number(match![2]), Number(match![3])];
}

describe('Capacitor-Versionen im Gleichschritt', () => {
  it.each(CAPACITOR_PACKAGES)('%s ist exakt gepinnt, nicht als Range', (name) => {
    const specifier = specifiers[name];
    expect(specifier, `${name} fehlt in package.json`).toBeTruthy();
    expect(specifier, `${name} als Range (${specifier}) lässt CLI und Plattformpaket auseinanderlaufen`).toMatch(
      EXACT_SEMVER,
    );
  });

  it('alle vier Pakete stehen auf derselben Version', () => {
    const pinned = Object.fromEntries(CAPACITOR_PACKAGES.map((name) => [name, specifiers[name]]));
    const distinct = [...new Set(Object.values(pinned))];
    expect(distinct, `Versionsdrift zwischen CLI und Plattformpaketen: ${JSON.stringify(pinned)}`).toHaveLength(1);
  });

  it('das iOS-Projekt hängt exakt an derselben Capacitor-Version', () => {
    const file = join(appRoot, 'ios/App/CapApp-SPM/Package.swift');
    expect(existsSync(file), 'Kein iOS-SPM-Manifest — `npx cap add ios` nicht gelaufen?').toBe(true);
    const packageSwift = readFileSync(file, 'utf-8');
    const match = packageSwift.match(/capacitor-swift-pm\.git",\s*exact:\s*"([^"]+)"/);
    expect(match, 'Package.swift pinnt capacitor-swift-pm nicht per `exact:`').not.toBeNull();
    expect(match![1], 'Swift-Paket driftet gegen die npm-Pakete').toBe(specifiers['@capacitor/core']);
  });
});

describe('Capacitor-Plugins hängen am selben Core und sind nativ verdrahtet (#104)', () => {
  // Leere Erhebung ist kein Grün: ohne dieses Gegenlager würde die ganze
  // describe-Gruppe still bestehen, sobald das letzte Plugin verschwindet.
  it('es gibt überhaupt Plugins zu prüfen', () => {
    expect(CAPACITOR_PLUGINS, 'kein @capacitor/*-Plugin in package.json gefunden').not.toHaveLength(0);
  });

  it.each(CAPACITOR_PLUGINS)('%s ist exakt gepinnt, nicht als Range', (name) => {
    expect(specifiers[name], `${name} als Range (${specifiers[name]}) lässt Plugin und Core auseinanderlaufen`).toMatch(
      EXACT_SEMVER,
    );
  });

  it.each(CAPACITOR_PLUGINS)('%s deklariert eine Peer-Spanne, die die gepinnte Core-Version deckt', (name) => {
    const pluginPkg = JSON.parse(readFileSync(join(appRoot, 'node_modules', name, 'package.json'), 'utf-8')) as {
      version: string;
      peerDependencies?: Record<string, string>;
    };

    // Gemessen wird das AUSGELIEFERTE Paket, nicht der Wunsch in package.json.
    expect(pluginPkg.version, `${name}: installierte Version weicht vom Pin ab`).toBe(specifiers[name]);

    const peer = pluginPkg.peerDependencies?.['@capacitor/core'];
    expect(peer, `${name} deklariert keinen Peer auf @capacitor/core`).toBeTruthy();

    const core = specifiers['@capacitor/core'];
    const [pMajor, pMinor, pPatch] = rangeFloor(peer!);
    const [cMajor, cMinor, cPatch] = rangeFloor(core);
    expect(cMajor, `${name} will Core-Major ${pMajor}, gepinnt ist ${core}`).toBe(pMajor);
    expect(
      cMinor * 1e6 + cPatch,
      `${name} verlangt mindestens ${pMajor}.${pMinor}.${pPatch}, gepinnt ist ${core}`,
    ).toBeGreaterThanOrEqual(pMinor * 1e6 + pPatch);
  });

  it.each(CAPACITOR_PLUGINS)('%s ist im Android-Projekt als Gradle-Modul eingebunden', (name) => {
    const settings = readFileSync(join(appRoot, 'android/capacitor.settings.gradle'), 'utf-8');
    const build = readFileSync(join(appRoot, 'android/app/capacitor.build.gradle'), 'utf-8');
    const module = gradleModule(name);
    expect(settings, `${name} fehlt in capacitor.settings.gradle — \`cap sync android\` nachziehen`).toContain(
      `include ':${module}'`,
    );
    expect(build, `${name} ist kein Gradle-Dependency der App — \`cap sync android\` nachziehen`).toContain(
      `implementation project(':${module}')`,
    );
  });

  it.each(CAPACITOR_PLUGINS)('%s ist im iOS-Projekt als SPM-Produkt eingebunden', (name) => {
    const packageSwift = readFileSync(join(appRoot, 'ios/App/CapApp-SPM/Package.swift'), 'utf-8');
    const product = swiftProduct(name);
    expect(packageSwift, `${name} fehlt als SPM-Paket in Package.swift — \`cap sync ios\` nachziehen`).toContain(
      `.package(name: "${product}"`,
    );
    expect(packageSwift, `${name} ist kein Target-Dependency in Package.swift — \`cap sync ios\` nachziehen`).toContain(
      `.product(name: "${product}", package: "${product}")`,
    );
  });
});

/**
 * Ist SwiftPM auf dieser Maschine da? `swift package dump-package` braucht
 * WEDER Xcode noch eine iOS-Plattformkomponente — die blossen Command Line Tools
 * genügen, es legt keine Artefakte an und läuft in unter einer Sekunde. Auf dem
 * Linux-Runner der visu-CI gibt es aber kein `swift`, dort wird der Test
 * übersprungen; die grep-Prüfungen oben laufen überall.
 */
const swift = (() => {
  try {
    execFileSync('swift', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!swift)('Package.swift ist ein auswertbares SwiftPM-Manifest, nicht nur passender Text (#104)', () => {
  interface DumpedPackage {
    dependencies: {
      fileSystem?: { identity: string; nameForTargetDependencyResolutionOnly: string; path: string }[];
    }[];
    targets: { name: string; dependencies: { product?: (string | null)[] }[] }[];
  }

  /**
   * Einmal auswerten lassen — ein kaputtes Manifest wirft hier, nicht erst in
   * Xcode. Das Ergebnis wird gemerkt: der erste Aufruf kompiliert das Manifest
   * (~25 s, einschliesslich Auflösen der git-Abhängigkeit; danach aus SwiftPMs
   * Cache), jeder weitere wäre reine Wartezeit.
   */
  let cache: DumpedPackage | null = null;
  const dumped = (): DumpedPackage => {
    if (cache) return cache;
    const out = execFileSync('swift', ['package', 'dump-package'], {
      cwd: join(appRoot, 'ios/App/CapApp-SPM'),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cache = JSON.parse(out) as DumpedPackage;
    return cache;
  };

  it('SwiftPM kann das Manifest überhaupt auswerten', () => {
    // Ein `Package.swift`, das die richtigen Zeichenketten enthält, aber nicht
    // kompiliert, kommt durch jede grep-Prüfung — und fällt erst beim nativen
    // Build auf, den diese Maschine nicht fahren kann.
    expect(() => dumped()).not.toThrow();
    expect(dumped().targets.map((t) => t.name)).toContain('CapApp-SPM');
  });

  it.each(CAPACITOR_PLUGINS)('%s ist ein Pfad-Abhängiger mit EXISTIERENDEM Verzeichnis', (name) => {
    const product = swiftProduct(name);
    const local = dumped()
      .dependencies.flatMap((d) => d.fileSystem ?? [])
      .find((d) => d.nameForTargetDependencyResolutionOnly === product);

    expect(local, `${product} ist in Package.swift kein Pfad-Abhängiger — \`cap sync ios\` nachziehen`).toBeTruthy();
    // Der Pfad ist der Teil, den ein Tippfehler still kaputt macht: die Datei
    // bleibt gültig, `cap doctor` bleibt grün, und erst Xcode findet nichts.
    expect(existsSync(local!.path), `${product}: Pfad zeigt ins Leere (${local!.path})`).toBe(true);
    expect(
      existsSync(join(local!.path, 'Package.swift')),
      `${product}: unter ${local!.path} liegt kein Swift-Paket`,
    ).toBe(true);
  });

  it.each(CAPACITOR_PLUGINS)('%s hängt als Produkt am App-Target', (name) => {
    const product = swiftProduct(name);
    const target = dumped().targets.find((t) => t.name === 'CapApp-SPM')!;
    const products = target.dependencies.flatMap((d) => (d.product ? [d.product.slice(0, 2)] : []));
    expect(products, `${product} ist kein Target-Dependency`).toContainEqual([product, product]);
  });
});
