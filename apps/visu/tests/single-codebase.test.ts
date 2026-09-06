// @vitest-environment node
// (Dateisystem-Test gegen das Build-Artefakt — kein DOM nötig; unter jsdom ist
//  `import.meta.url` keine file:-URL und `fileURLToPath` schlägt fehl.)

// M4 · Issue #103 — „Ein Code-Stand für alle drei Plattformen".
//
// Das Kriterium ist keine Absichtserklärung, sondern zwei prüfbare Eigenschaften:
// (1) iOS/Android laden dasselbe Bundle, das auch die PWA ausliefert — keine
//     `server.url`, die die native Hülle auf einen anderen Stand umlenkt;
// (2) der Quellcode verzweigt nicht nach Plattform.
//
// Zu (2): Wer bewusst einen nativen Sonderweg einführt, muss diesen Wächter
// ändern — das ist gewollt. Der Test verbietet nicht Capacitor-APIs an sich,
// sondern die plattformabhängige Verzweigung im gemeinsamen Quellcode.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import capacitorConfig from '../capacitor.config';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(appRoot, 'src');

const PLATFORM_FORKS: { pattern: RegExp; hint: string }[] = [
  { pattern: /\bisNativePlatform\s*\(/, hint: 'Capacitor.isNativePlatform()' },
  { pattern: /\bgetPlatform\s*\(/, hint: 'Capacitor.getPlatform()' },
  { pattern: /\bisPlatform\s*\(\s*['"]/, hint: "Ionic isPlatform('ios'|'android')" },
  { pattern: /import\.meta\.env\.[A-Z_]*(?:IOS|ANDROID|NATIVE|CAPACITOR)/, hint: 'plattform-spezifische Vite-Env' },
  { pattern: /process\.env\.[A-Z_]*(?:IOS|ANDROID|NATIVE|CAPACITOR)/, hint: 'plattform-spezifische Node-Env' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return ['.ts', '.tsx', '.vue', '.js'].includes(extname(full)) ? [full] : [];
  });
}

describe('ein Code-Stand für PWA, iOS und Android', () => {
  it('lenkt die native Hülle nicht auf einen anderen Stand um', () => {
    // Eine gesetzte `server.url` (Live-Reload/Remote) würde bedeuten: nativ läuft
    // anderer Code als im Web-Build — genau das Gegenteil eines Code-Stands.
    expect(capacitorConfig.server?.url).toBeUndefined();
  });

  it('enthält keine plattformabhängige Verzweigung im Quellcode', () => {
    const files = sourceFiles(srcDir);
    // Leere Erhebung ist kein Gruen: verschwaende `src/`, waere `findings` leer und dieser
    // Test bestuende, ohne eine einzige Zeile gesehen zu haben.
    expect(files.length, `${relative(appRoot, srcDir)} enthaelt keine Quelldateien`).toBeGreaterThan(0);
    const findings: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const { pattern, hint } of PLATFORM_FORKS) {
        if (pattern.test(content)) findings.push(`${relative(appRoot, file)}: ${hint}`);
      }
    }
    expect(findings).toEqual([]);
  });
});
