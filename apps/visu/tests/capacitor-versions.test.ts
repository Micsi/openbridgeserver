// @vitest-environment node
// (reines Dateilesen — kein DOM; siehe tests/pwa-build.test.ts zur Begründung.)

// M4 · Issue #103 — die Versions-Begründung als Test statt als Commit-Text.
//
// `@capacitor/{cli,core,ios,android}` werden im Gleichschritt released, und die
// nativen Projekte werden vom CLI erzeugt: driftet ein Plattformpaket gegen das
// CLI, bricht `cap sync` erst beim nativen Build. Deshalb sind alle vier exakt
// gepinnt (kein ^/~), und das iOS-Projekt hängt über `exact:` an derselben
// Version.

import { describe, it, expect } from 'vitest';
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
